import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocxAgentPanel } from "./DocxAgentPanel";
import { LocaleProvider } from "../i18n";
import { officecli } from "../bridge";
import { waitForAgentRun } from "../agentRuntime";

vi.mock("../bridge", () => ({ officecli: { startAgentRun: vi.fn(), cancelAgentRun: vi.fn() } }));
vi.mock("../agentRuntime", () => ({ waitForAgentRun: vi.fn(), unwrapAgentRunResult: (run: { result: unknown }) => run.result }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

function setup(locale: "en" | "zh" = "en", filePath?: string) {
  const editor = { capture: vi.fn().mockResolvedValue({ id: "scope-1", text: "Hello", scope: "selection" }), apply: vi.fn().mockResolvedValue({ replaced: 1 }), save: vi.fn().mockResolvedValue({}) };
  vi.mocked(officecli.startAgentRun).mockResolvedValue({ id: "run-1" } as never);
  vi.mocked(waitForAgentRun).mockResolvedValue({ kind: "completed", run: { result: { summary: "Updated greeting", edits: [{ query: "Hello", replacement: "Hi" }] } } } as never);
  render(<LocaleProvider value={locale}><DocxAgentPanel filePath={filePath} editor={editor} selection={{ empty: false, collapsed: false }} /></LocaleProvider>);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Shorten this" } });
  return editor;
}
it("plans from selected text, applies the captured scope, then saves", async () => {
  const editor = setup();
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await screen.findByText(/Updated greeting/);
  expect(editor.capture).toHaveBeenCalledWith("selection");
  expect(editor.apply).toHaveBeenCalledWith("scope-1", [{ query: "Hello", replacement: "Hi" }]);
  expect(editor.save).toHaveBeenCalledOnce();
  expect(screen.getByRole("textbox")).toHaveValue("");
});
it.each(["en", "zh"] as const)("passes UI locale %s independently of the translation request", async (locale) => {
  setup(locale);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: locale === "en" ? "把这段话翻译成中文" : "Translate this into English" } });
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await screen.findByText(/Updated greeting/);
  expect(officecli.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({
    input: { parameters: expect.objectContaining({ ui_locale: locale }) },
  }));
});
it("retains the prompt and reports a failed save without claiming success", async () => {
  const editor = setup();
  editor.save.mockRejectedValue(new Error("disk full"));
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Edits were applied but could not be saved");
  expect(screen.getByRole("textbox")).toHaveValue("Shorten this");
});
it("does not apply a late plan after cancellation", async () => {
  const editor = setup();
  let resolve!: (value: never) => void;
  vi.mocked(waitForAgentRun).mockReturnValue(new Promise((done) => { resolve = done; }));
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await waitFor(() => expect(waitForAgentRun).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Stop editing" }));
  await act(async () => { resolve({ kind: "completed", run: { result: { summary: "Late", edits: [{ query: "Hello", replacement: "Hi" }] } } } as never); });
  expect(editor.apply).not.toHaveBeenCalled();
});

it("sends with Enter", async () => {
  const editor = setup();
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" })).toBe(false);
  await screen.findByText(/Updated greeting/);
  expect(editor.save).toHaveBeenCalledOnce();
});
it.each([
  { shiftKey: true },
  { isComposing: true },
  { keyCode: 229 },
])("preserves newline and composition Enter: %j", (modifiers) => {
  const editor = setup();
  expect(fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ...modifiers })).toBe(true);
  expect(editor.capture).not.toHaveBeenCalled();
  expect(officecli.startAgentRun).not.toHaveBeenCalled();
});

it("restores the full conversation when reopening a file and isolates other files", async () => {
  const editor = setup("en", "/tmp/history.docx");
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await screen.findByText(/Updated greeting/);
  cleanup();
  const view = render(<DocxAgentPanel filePath="/tmp/history.docx" editor={editor} />);
  expect(screen.getByText("Shorten this")).toBeTruthy();
  expect(screen.getByText(/Updated greeting/)).toBeTruthy();
  expect(editor.apply).toHaveBeenCalledTimes(1);
  view.rerender(<DocxAgentPanel filePath="/other/history.docx" editor={editor} />);
  expect(screen.queryByText("Shorten this")).toBeNull();
  view.rerender(<DocxAgentPanel filePath="/tmp/history.docx" editor={editor} />);
  expect(screen.getByText(/Updated greeting/)).toBeTruthy();
});

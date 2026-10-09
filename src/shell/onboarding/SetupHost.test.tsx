import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import { createBrowserPreviewAPI } from "../../renderer/bridge/browserPreview";
import { LocaleProvider } from "../../renderer/i18n";
import type { AuthEvent, SetupState } from "../../shared/types";
import { SetupHost, SETUP_OPEN } from "./SetupHost";

const shell = vi.hoisted(() => ({ dispatch: vi.fn(), openDropped: vi.fn(async () => {}), openFromDisk: vi.fn(async () => {}), state: { activeFileId: null, navCollapsed: false } }));
vi.mock("../state/ShellContext", () => ({ useShell: () => ({ loaded: true, state: shell.state, dispatch: shell.dispatch }) }));
vi.mock("../nav/useLibraryActions", () => ({ useLibraryActions: () => shell }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(step: SetupState["step"] = "preferences", status: SetupState["status"] = "pending") {
  const api = createBrowserPreviewAPI();
  const value: SetupState = { version: 1, status, step, startMode: "agent" };
  api.getSetupState = vi.fn(async () => value);
  api.saveSetupState = vi.fn(async () => {});
  api.setSetupWindow = vi.fn(async () => {});
  api.setDefaultDocumentApps = vi.fn(async (exts: string[]) => exts.map(extension => ({ extension, isDefault: true })));
  api.takeNativeOpenFiles = vi.fn(async () => []);
  api.cancelLogin = vi.fn(async () => {});
  let auth: (event: AuthEvent) => void = () => {};
  api.onAuthEvent = vi.fn(callback => { auth = callback; return () => {}; });
  const view = render(<LocaleProvider value="en"><DesktopApiProvider api={api}><SetupHost onVisibility={vi.fn()} onAccountChanged={vi.fn()} /></DesktopApiProvider></LocaleProvider>);
  return { api, view, auth: (event: AuthEvent) => act(() => auth({ flowId: vi.mocked(api.login).mock.calls.at(-1)?.[0]?.flowId, ...event })) };
}

describe("first-run setup", () => {
  it("does not show setup to migrated users; manual entry still works", async () => {
    const { api } = mount("welcome", "migrated");
    await waitFor(() => expect(api.getSetupState).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => window.dispatchEvent(new CustomEvent(SETUP_OPEN)));
    expect(await screen.findByText("Get started", { selector: "button" })).toBeTruthy();
  });
  it("selects a single mode, advances, and preserves it when returning", async () => {
    const { api } = mount();
    fireEvent.click(await screen.findByRole("button", { name: /Local mode/ }));
    await screen.findByText("Start using OfficeDex");
    expect(api.saveSetupState).toHaveBeenCalledWith(expect.objectContaining({ startMode: "local", step: "defaults" }));
    fireEvent.click(screen.getByText("← Back"));
    expect(await screen.findByRole("button", { name: /Local mode/ })).toHaveAttribute("aria-pressed", "true");
  });
  it("unchecked completion leaves associations untouched and enters the chosen mode", async () => {
    const { api } = mount();
    fireEvent.click(await screen.findByRole("button", { name: /Local mode/ }));
    fireEvent.click(await screen.findByText("Start using OfficeDex"));
    await waitFor(() => expect(shell.dispatch).toHaveBeenCalledWith({ type: "go", page: "local" }));
    expect(api.setDefaultDocumentApps).not.toHaveBeenCalled();
    expect(api.saveSetupState).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed", startMode: "local" }));
  });
  it("checkbox is a draft; partial failure retries only unsuccessful types", async () => {
    const { api } = mount("defaults");
    vi.mocked(api.setDefaultDocumentApps).mockResolvedValueOnce([
      { extension: "docx", isDefault: true }, { extension: "xlsx", isDefault: false }, { extension: "pptx", isDefault: false },
    ]);
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(api.setDefaultDocumentApps).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Start using OfficeDex"));
    fireEvent.click(await screen.findByText("Retry", { selector: "button" }));
    await waitFor(() => expect(api.setDefaultDocumentApps).toHaveBeenLastCalledWith(["xlsx", "pptx"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("skip confirmation can be canceled and skipping never submits the checkbox", async () => {
    const { api } = mount("defaults");
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByText("Skip", { selector: "button" }));
    fireEvent.keyDown(screen.getByText("Skip setup?"), { key: "Escape" });
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByText("Skip", { selector: "button" }));
    fireEvent.click(screen.getByText("Open app", { selector: "button" }));
    await waitFor(() => expect(api.saveSetupState).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" })));
    expect(api.setDefaultDocumentApps).not.toHaveBeenCalled();
  });
  it("unknown credits allow continuing without becoming a low balance", async () => {
    const { api } = mount("ai");
    api.getCreditStatus = vi.fn(async () => { throw new Error("offline"); });
    expect(await screen.findByText("Couldn't load your credits")).toBeTruthy();
    fireEvent.click(screen.getByText("Continue", { selector: "button" }));
    expect(await screen.findByText("How would you like to start?")).toBeTruthy();
    expect(screen.queryByText("Not enough credits")).toBeNull();
  });
  it("opens pending Finder files before the local picker without overwriting saved mode", async () => {
    const { api } = mount("welcome");
    vi.mocked(api.takeNativeOpenFiles).mockResolvedValueOnce(["/tmp/report.docx"]);
    fireEvent.click(await screen.findByText("Open a local file first →"));
    await waitFor(() => expect(shell.openDropped).toHaveBeenCalledWith(["/tmp/report.docx"]));
    expect(shell.openFromDisk).not.toHaveBeenCalled();
    expect(api.saveSetupState).toHaveBeenCalledWith(expect.objectContaining({ startMode: "agent", status: "skipped" }));
  });
  it("login success requires whoami confirmation; cancellation ignores late events", async () => {
    const { api, auth } = mount("welcome");
    api.login = vi.fn(async () => ({ url: "https://example.test/login" }));
    api.openExternal = vi.fn(async () => {});
    api.whoami = vi.fn(async () => ({ mode: "anonymous" as const }));
    fireEvent.click(await screen.findByText("Log in", { selector: "button" }));
    await screen.findByText("Back to welcome", { selector: "button" });
    auth({ type: "success" });
    expect(screen.queryByText("Get started", { selector: "button" })).toBeNull();
    fireEvent.click(screen.getByText("Back to welcome", { selector: "button" }));
    await screen.findByText("Log in", { selector: "button" });
    api.whoami = vi.fn(async () => ({ mode: "logged_in" as const }));
    auth({ type: "success" });
    expect(screen.queryByText("Get started", { selector: "button" })).toBeNull();
    expect(api.setSetupWindow).toHaveBeenCalledWith("welcome");
  });
  it("only the active verified login proceeds and switches to the setup window", async () => {
    const { api, auth } = mount("welcome");
    api.login = vi.fn(async () => ({ url: "https://example.test/login" }));
    api.openExternal = vi.fn(async () => {});
    api.whoami = vi.fn(async () => ({ mode: "anonymous" as const }));
    fireEvent.click(await screen.findByText("Log in", { selector: "button" }));
    await waitFor(() => expect(api.openExternal).toHaveBeenCalled());
    api.whoami = vi.fn(async () => ({ mode: "logged_in" as const }));
    auth({ type: "success", flowId: "retired-attempt" });
    expect(api.whoami).not.toHaveBeenCalled();
    auth({ type: "success" });
    expect(await screen.findByText("Get started", { selector: "button" })).toBeTruthy();
    expect(api.saveSetupState).toHaveBeenCalledWith(expect.objectContaining({ step: "introduction" }));
    await waitFor(() => expect(api.setSetupWindow).toHaveBeenCalledWith("setup"));
  });
  it("closing default-app settings preserves onboarding and does not change associations", async () => {
    const { api } = mount("welcome", "migrated");
    await waitFor(() => expect(api.getSetupState).toHaveBeenCalled());
    act(() => window.dispatchEvent(new CustomEvent(SETUP_OPEN, { detail: "defaults" })));
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveSetupState).not.toHaveBeenCalled();
    expect(api.setDefaultDocumentApps).not.toHaveBeenCalled();
  });
});

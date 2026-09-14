import { afterEach, expect, it, vi } from "vitest";
import { createWailsAPI } from "./wails";

afterEach(() => vi.unstubAllGlobals());

it("calls generated desktop bindings through the DOCX agent lifecycle", async () => {
  const result = { summary: "Translated", edits: [{ query: "你好", replacement: "Hello" }] };
  const run = { id: "run-1", status: "completed", result };
  const app = {
    StartAgentRun: vi.fn().mockResolvedValue({ id: "run-1", status: "running" }),
    GetAgentRun: vi.fn().mockResolvedValue(run),
    CancelAgentRun: vi.fn().mockResolvedValue({ accepted: true }),
  };
  vi.stubGlobal("go", { main: { App: app } });
  const api = createWailsAPI();
  await api.startAgentRun({ workflow: "office.docx.edit.v1", input: { parameters: { prompt: "Translate", text: "你好", scope: "selection" } } });
  expect(app.StartAgentRun).toHaveBeenCalledWith(expect.objectContaining({ workflow: "office.docx.edit.v1", input: { parameters: { prompt: "Translate", text: "你好", scope: "selection" } } }));
  expect(await api.getAgentRun("run-1")).toEqual(run);
  await api.cancelAgentRun("run-1");
  expect(app.CancelAgentRun).toHaveBeenCalledWith("run-1");
});

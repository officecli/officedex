import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent, DesktopAPI } from "../shared/types";
import { applyTaskEvent, createInitialTaskState, reduceStages } from "./taskState";
import { IDEA_NODE_DRAWING_MS } from "./screens/DialogueScreens";

const DEMO_NODE_SEQUENCE_TIMEOUT_MS = IDEA_NODE_DRAWING_MS * 24 + 3000;

describe("reduceStages", () => {
  it("derives four default stages from task.started + progress events", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.started", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
    ]);
    expect(stages).toHaveLength(4);
    expect(stages.map((s) => s.id)).toEqual(["analyze", "outline", "writing", "format"]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("active");
    expect(stages[2].status).toBe("pending");
    expect(stages[3].status).toBe("pending");
    expect(activeStageId).toBe("outline");
  });

  it("uses payload.stage as the human-readable label override", () => {
    const { stages } = reduceStages([
      { task_id: "t", type: "task.progress", payload: { stage: "Generating milestone sections" } },
    ]);
    expect(stages[0].label).toBe("Generating milestone sections");
    expect(stages[0].status).toBe("active");
  });

  it("marks all stages completed when task.completed arrives", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.completed", payload: {} },
    ]);
    expect(stages.every((s) => s.status === "completed")).toBe(true);
    expect(activeStageId).toBeUndefined();
  });

  it("marks the current active stage failed on task.failed", () => {
    const { stages } = reduceStages([
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.progress", payload: {} },
      { task_id: "t", type: "task.failed", payload: { message: "boom" } },
    ]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("failed");
  });

  it("honors native payload.stage_id and ignores derived defaults", () => {
    const { stages, activeStageId } = reduceStages([
      { task_id: "t", type: "task.progress", payload: { stage_id: "ingest", stage_label: "Ingesting" } },
      { task_id: "t", type: "task.progress", payload: { stage_id: "render", stage_label: "Rendering" } },
    ]);
    expect(stages.map((s) => s.id)).toEqual(["ingest", "render"]);
    expect(stages[0].status).toBe("completed");
    expect(stages[1].status).toBe("active");
    expect(activeStageId).toBe("render");
  });

  it("applyTaskEvent attaches stages to the DesktopTask", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, { task_id: "t", type: "task.started", payload: {} });
    state = applyTaskEvent(state, { task_id: "t", type: "task.progress", payload: {} });
    const task = state.tasks["t"];
    expect(task.stages).toBeDefined();
    expect(task.stages![0].status).toBe("active");
    expect(task.activeStageId).toBe("analyze");
  });

  it("applyTaskEvent stores the latest Vibe Project Tree snapshot", () => {
    let state = createInitialTaskState();
    state = applyTaskEvent(state, { task_id: "t", type: "task.started", payload: { document_type: "pptx" } });
    state = applyTaskEvent(state, {
      task_id: "t",
      type: "task.vibe_tree",
      payload: {
        stage: "outline_ready",
        tree: {
          id: "tree-1",
          rootId: "root",
          title: "Rebuild Internal Knowledge Base",
          nodes: [
            { id: "root", kind: "root", title: "Rebuild Internal Knowledge Base" },
            { id: "branch-problem", parentId: "root", kind: "branch", title: "Problem", summary: "Can't find, can't trust, can't use" },
          ],
        },
        actions: [{ id: "refine_slides", label: "Refine Page Content" }],
      },
    });

    const task = state.tasks["t"];
    expect(task.vibeTree?.stage).toBe("outline_ready");
    expect(task.vibeTree?.tree.nodes[1]?.title).toBe("Problem");
    expect(task.vibeTree?.actions[0]?.id).toBe("refine_slides");
  });
});

describe("App task flow", () => {
  it("uses the latest prior PPTX artifact as the source for follow-up modify tasks", async () => {
    const { findModifySourceTask } = await import("./App");
    const task = findModifySourceTask([
      {
        id: "task-vibe",
        conversationId: "conversation-vibe",
        status: "completed",
        documentType: "pptx",
        events: [],
        artifact: {
          taskId: "task-vibe",
          filePath: "/tmp/deck.pptx",
          fileName: "deck.pptx",
          documentType: "pptx",
        },
      },
      {
        id: "task-edit",
        conversationId: "conversation-vibe",
        parentTaskId: "task-vibe",
        status: "running",
        documentType: "pptx",
        events: [],
        userInput: {
          prompt: "把最后一页标题改成 hello void",
          sourceFile: "/tmp/deck.pptx",
        },
      },
    ], "pptx");

    expect(task?.id).toBe("task-vibe");
    expect(task?.artifact?.filePath).toBe("/tmp/deck.pptx");
  });

  it("keeps inline preview from toggling native preview mode and resizing the app window", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8");

    expect(source).not.toContain("setPreviewMode?.(previewActive)");
    expect(source).not.toContain("setPreviewMode(previewActive)");
  });

  beforeEach(() => {
    vi.resetModules();
    installDomStubs();
    window.history.pushState({}, "", "/?view=dialogue");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens Home by default and enters dialogue with the chosen type", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /what will you create today/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Presentation" }));
    expect(await screen.findByTestId("new-generation-form")).toHaveAttribute("data-document-type", "pptx");
  });

  it("opens Spreadsheet directly in the new workbook workspace", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Spreadsheet" }));

    expect(await screen.findByRole("region", { name: "Untitled workbook" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "AI Assistant" })).toBeTruthy();
    expect(screen.queryByTestId("new-generation-form")).toBeNull();
  });

  it("generates XLSX inside the spreadsheet workspace and opens the matching artifact", async () => {
    window.history.pushState({}, "", "/");
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Spreadsheet" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Spreadsheet generation request" }), { target: { value: "Build a quarterly sales forecast" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "xlsx",
      generationMode: "plan",
      prompt: "Build a quarterly sales forecast",
    })));
    act(() => {
      bridge.emit({
        task_id: "task-2",
        type: "task.completed",
        payload: { result: { file_path: "/tmp/forecast.xlsx", file_name: "forecast.xlsx", document_type: "xlsx" } },
      });
    });

    expect(await screen.findByRole("region", { name: "forecast.xlsx workbook" })).toBeTruthy();
    expect(screen.queryByTestId("new-generation-form")).toBeNull();
  });

  it("opens recent XLSX files in the same spreadsheet workspace", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const recent = { filePath: "/tmp/local.xlsx", fileName: "Local workbook.xlsx", documentType: "xlsx", source: "local" as const, lastOpenedAt: "2026-08-05T02:00:00Z" };
    api.listRecentFiles = vi.fn(async () => [recent]);
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Local workbook.xlsx" }));

    expect(await screen.findByRole("region", { name: "Local workbook.xlsx workbook" })).toBeTruthy();
    expect(screen.queryByLabelText("Close preview")).toBeNull();
    expect(api.issuePreviewToken).toHaveBeenCalledWith(expect.objectContaining({ filePath: recent.filePath }));
  });

  it("selects a project and reloads recent files for that workspace", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    api.listWorkspaces = vi.fn(async () => [{ id: "ws-a", name: "Client A", path: "/tmp/client-a", active: false, conversations: [] }]);
    api.listRecentFiles = vi.fn(async (workspaceId?: string) => workspaceId === "ws-a" ? [{
      filePath: "/tmp/client-a/deck.pptx",
      fileName: "Client deck.pptx",
      documentType: "pptx",
      source: "generated" as const,
      workspaceId: "ws-a",
      lastOpenedAt: "2026-08-05T02:00:00Z",
    }] : []);
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Client A" }));

    await waitFor(() => expect(api.selectWorkspace).toHaveBeenCalledWith("ws-a"));
    await waitFor(() => expect(api.listRecentFiles).toHaveBeenCalledWith("ws-a"));
    expect(await screen.findByText("Client deck.pptx")).toBeTruthy();
  });

  it("opens a local recent file in the existing preview panel", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const recent = {
      filePath: "/tmp/local.pdf",
      fileName: "Local brief.pdf",
      documentType: "pdf",
      source: "local" as const,
      lastOpenedAt: "2026-08-05T02:00:00Z",
    };
    api.listRecentFiles = vi.fn(async () => [recent]);
    api.openRecentFile = vi.fn(async () => ({ filePath: recent.filePath, fileName: recent.fileName, documentType: recent.documentType }));
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Local brief.pdf" }));

    await waitFor(() => expect(api.openRecentFile).toHaveBeenCalledWith(recent));
    await waitFor(() => expect(api.issuePreviewToken).toHaveBeenCalledWith(expect.objectContaining({ filePath: recent.filePath })));
    expect(await screen.findByLabelText("Close preview")).toBeTruthy();
  });

  it("restores a generated recent file conversation before opening its preview", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const recent = {
      filePath: "/tmp/generated-deck.pptx",
      fileName: "Generated deck.pptx",
      documentType: "pptx",
      source: "generated" as const,
      taskId: "task-generated",
      conversationId: "conversation-generated",
      lastOpenedAt: "2026-08-05T02:00:00Z",
    };
    api.listRecentFiles = vi.fn(async () => [recent]);
    api.getTaskHistory = vi.fn(async () => [{
      taskId: "task-generated",
      conversationId: "conversation-generated",
      events: [
        { task_id: "task-generated", type: "task.started", payload: { document_type: "pptx", topic: "Generated deck" } },
        { task_id: "task-generated", type: "task.completed", payload: { result: { file_path: recent.filePath, file_name: recent.fileName, document_type: "pptx" } } },
      ],
    }]);
    api.openRecentFile = vi.fn(async () => ({ taskId: recent.taskId, filePath: recent.filePath, fileName: recent.fileName, documentType: recent.documentType }));
    const { App } = await import("./App");

    render(<App />);
    await waitFor(() => expect(api.getTaskHistory).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Open Generated deck.pptx" }));

    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    expect(await screen.findByLabelText("Close preview")).toBeTruthy();
  });

  it("falls back to the system app for an unsupported recent file", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const recent = { filePath: "/tmp/notes.txt", fileName: "notes.txt", documentType: "txt", source: "local" as const, lastOpenedAt: "2026-08-05T02:00:00Z" };
    api.listRecentFiles = vi.fn(async () => [recent]);
    api.openRecentFile = vi.fn(async () => { throw new Error("unsupported preview file type"); });
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open notes.txt" }));

    await waitFor(() => expect(api.openPath).toHaveBeenCalledWith(recent.filePath));
    expect(await screen.findByText("This format will open in the system app.")).toBeTruthy();
  });

  it("offers to remove a missing recent file", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const recent = { filePath: "/tmp/missing.pdf", fileName: "missing.pdf", documentType: "pdf", source: "local" as const, lastOpenedAt: "2026-08-05T02:00:00Z" };
    api.listRecentFiles = vi.fn(async () => [recent]);
    api.openRecentFile = vi.fn(async () => { throw new Error("recent file is unavailable: no such file"); });
    const { App } = await import("./App");

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open missing.pdf" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove from recents" }));

    await waitFor(() => expect(api.removeRecentFile).toHaveBeenCalledWith(recent.filePath));
    expect(screen.queryByText("missing.pdf")).toBeNull();
  });

  it("keeps projects usable when recent files fail to load", async () => {
    window.history.pushState({}, "", "/");
    installBridgeMock();
    const api = window.officecli as DesktopAPI;
    api.listRecentFiles = vi.fn(async () => { throw new Error("recent files unavailable"); });
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("button", { name: "workspace" })).toBeTruthy();
    expect(await screen.findByRole("alert")).toHaveTextContent("recent files unavailable");
  });

  it("keeps New chat on a blank composer after a previous task exists and submits another generate request", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-1",
        task_id: "task-1",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/previous.pptx",
            file_name: "previous.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    expect(screen.queryByText("Fluid")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Generate a new quarterly review PPT" },
    });
    expect(screen.queryByText(/^Mode$/)).toBeNull();
    expect(screen.queryByRole("radio", { name: "Fast" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "Generate a new quarterly review PPT",
      generationMode: "plan",
    }));
    expect(bridge.generate).toHaveBeenCalledWith(expect.not.objectContaining({ runtimeMode: expect.anything() }));
  });

  it("does not render the hardcoded Vibe-Officing demo route", async () => {
    window.history.pushState({}, "", "/?view=dialogue&demo=vibe-officing");
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "From a Single Idea to a Complete PPTX" })).toBeNull();
    expect(screen.queryByText("OfficeDex Vibe-Officing Demo")).toBeNull();
    expect(screen.queryByText("Living Tree Cockpit")).toBeNull();
    expect(bridge.generate).not.toHaveBeenCalled();
  });

  it("collapses the main sidebar when a real PPT Vibe canvas opens", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-vibe-started",
        task_id: "task-vibe-shell",
        type: "task.started",
        payload: { document_type: "pptx", topic: "Introduce Shimo Docs" },
      });
      bridge.emit({
        event_id: "event-vibe-tree",
        task_id: "task-vibe-shell",
        type: "task.vibe_tree",
        payload: {
          stage: "story_ready",
          tree: {
            id: "tree-shell",
            rootId: "root",
            title: "Introduce Shimo Docs",
            nodes: [
              { id: "root", kind: "root", title: "Introduce Shimo Docs" },
              { id: "branch-1", parentId: "root", kind: "branch", title: "Scale Adoption", summary: "Lower decision barriers with paths and benefits." },
            ],
          },
          actions: [{ id: "generate_chapter", label: "Generate Chapters" }],
        },
      });
    });

    expect(await screen.findByText("Living Tree Cockpit")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".app-shell.sidebar-collapsed")).toBeTruthy());
  });

  it("keeps a blank new chat selected when an existing running task updates", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-running-started",
        task_id: "task-running",
        type: "task.started",
        payload: { document_type: "pptx", topic: "Background deck" },
      });
    });
    expect(await screen.findByText("Generating PPTX...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-pptx")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();

    act(() => {
      bridge.emit({
        event_id: "event-running-progress",
        task_id: "task-running",
        type: "task.progress",
        payload: { stage: "Writing slides" },
      });
    });

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    expect(screen.queryByText("Thinking...")).toBeNull();
    expect(screen.getByRole("button", { name: /Background deck/ }).classList.contains("active")).toBe(false);
  });

  it("nudges the prompt input instead of resetting when New chat is clicked on an existing blank composer", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    const textarea = await screen.findByPlaceholderText(/Enter what you want to generate/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Keep this draft" } });

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(bridge.generate).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Keep this draft");
    await waitFor(() => expect(textarea.classList.contains("is-new-chat-nudging")).toBe(true));

    const css = readFileSync("src/renderer/styles/dialogue.css", "utf8");
    expect(css).toMatch(/@keyframes\s+new-chat-input-nudge/);
    expect(css).toMatch(/\.new-chat-nudge-input\.is-new-chat-nudging/s);
  });

  it("removes a project from the sidebar and refreshes chats", async () => {
    installBridgeMock();
    vi.stubGlobal("confirm", vi.fn(() => true));
    const api = window.officecli as DesktopAPI;
    const projectConversation = {
      conversationId: "conv-project",
      firstTaskId: "task-project",
      latestTaskId: "task-project",
      status: "completed" as const,
      title: "Project chat",
      documentType: "pptx",
      updatedAt: "2026-06-10T10:00:00Z",
    };
    api.listWorkspaces = vi.fn()
      .mockResolvedValueOnce([{
        id: "ws-project",
        name: "void-oversea",
        path: "/Users/test/void-oversea",
        active: true,
        conversations: [projectConversation],
      }])
      .mockResolvedValueOnce([]);
    api.listChats = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([projectConversation]);
    api.removeWorkspace = vi.fn(async () => undefined);
    const { App } = await import("./App");

    render(<App />);
    await screen.findByRole("button", { name: "Project actions for void-oversea" });

    fireEvent.click(screen.getByRole("button", { name: "Project actions for void-oversea" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Remove$/ }));

    await waitFor(() => expect(api.removeWorkspace).toHaveBeenCalledWith("ws-project"));
    await waitFor(() => expect(api.listChats).toHaveBeenCalledTimes(2));
  });

  it("deletes a persisted project conversation from the sidebar", async () => {
    installBridgeMock();
    const api = window.officecli as DesktopAPI & { deleteConversation?: ReturnType<typeof vi.fn> };
    const projectConversation = {
      conversationId: "conv-ppt-test",
      firstTaskId: "task-ppt-1",
      latestTaskId: "task-ppt-2",
      status: "completed" as const,
      title: "Create a realistic pitch deck",
      documentType: "pptx",
      updatedAt: "2026-06-10T10:00:00Z",
    };
    api.listWorkspaces = vi.fn()
      .mockResolvedValueOnce([{
        id: "ws-ppt-test",
        name: "ppt-test",
        path: "/Users/test/ppt-test",
        active: true,
        conversations: [projectConversation],
      }])
      .mockResolvedValueOnce([{
        id: "ws-ppt-test",
        name: "ppt-test",
        path: "/Users/test/ppt-test",
        active: true,
        conversations: [],
      }]);
    api.listChats = vi.fn(async () => []);
    api.deleteConversation = vi.fn(async () => undefined);
    const { App } = await import("./App");

    render(<App />);
    await screen.findByRole("button", { name: /Create a realistic pitch deck/ });

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith("conv-ppt-test"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Create a realistic pitch deck/ })).toBeNull());
  });

  it("does not switch to a fatal error screen when the conversation delete bridge is unavailable", async () => {
    installBridgeMock();
    const api = window.officecli as Omit<DesktopAPI, "deleteConversation"> & { deleteConversation?: DesktopAPI["deleteConversation"] };
    const projectConversation = {
      conversationId: "conv-ppt-test",
      firstTaskId: "task-ppt-1",
      latestTaskId: "task-ppt-1",
      status: "completed" as const,
      title: "Create a realistic pitch deck",
      documentType: "pptx",
      updatedAt: "2026-06-10T10:00:00Z",
    };
    api.listWorkspaces = vi.fn(async () => [{
      id: "ws-ppt-test",
      name: "ppt-test",
      path: "/Users/test/ppt-test",
      active: true,
      conversations: [projectConversation],
    }]);
    api.listChats = vi.fn(async () => []);
    delete api.deleteConversation;
    const { App } = await import("./App");

    render(<App />);
    await screen.findByRole("button", { name: /Create a realistic pitch deck/ });

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Create a realistic pitch deck/ })).toBeNull());
    expect(screen.queryByText(/Conversation deletion requires/i)).toBeNull();
    expect(screen.getByRole("heading", { name: /What should we work on/i })).toBeTruthy();
  });

  it("switches from submit spinner to the running task when task.started arrives before generate resolves", async () => {
    const bridge = installBridgeMock();
    bridge.generate.mockImplementation(() => new Promise(() => undefined));
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-existing-task",
        task_id: "existing-task",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/existing.pptx",
            file_name: "existing.pptx",
            document_type: "pptx",
          },
        },
      });
    });
    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "DOCX" }));
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a stuck DOCX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    act(() => {
      bridge.emit({
        event_id: "event-started-before-return",
        task_id: "task-started-before-return",
        type: "task.started",
        payload: { document_type: "docx", topic: "Create a stuck DOCX", message: "Task accepted" },
      });
    });

    expect(await screen.findByText("Writing plan...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-plan")).toBeTruthy();
    expect(screen.getAllByText("Create a stuck DOCX").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /What should we work on/i })).toBeNull();
  });

  it("does not duplicate the first running conversation when persisted workspace summaries arrive after an early task.started event", async () => {
    const bridge = installBridgeMock();
    const api = window.officecli as DesktopAPI;
    const workspace = {
      id: "ws-default",
      name: "workspace",
      path: "/Users/test/Library/Application Support/OfficeDex/workspace",
      active: true,
    };
    api.listWorkspaces = vi.fn()
      .mockResolvedValueOnce([{ ...workspace, conversations: [] }])
      .mockResolvedValue([{ ...workspace, conversations: [{
        conversationId: "task-started-before-return",
        firstTaskId: "task-started-before-return",
        latestTaskId: "task-started-before-return",
        status: "running" as const,
        title: "Create a stuck DOCX",
        documentType: "docx",
        updatedAt: "2026-06-11T07:50:11Z",
      }] }]);
    bridge.generate.mockImplementation(() => new Promise(() => undefined));
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "DOCX" }));
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a stuck DOCX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    act(() => {
      bridge.emit({
        event_id: "event-started-before-return",
        task_id: "task-started-before-return",
        type: "task.started",
        payload: { document_type: "docx", topic: "Create a stuck DOCX", message: "Task accepted" },
      });
    });

    await waitFor(() => expect(api.listWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelectorAll(".workspace-conversations .history-item")).toHaveLength(1));
  });

  it("switches to a local pending task immediately when generate does not resolve and no bridge event arrives", async () => {
    const bridge = installBridgeMock();
    bridge.generate.mockImplementation(() => new Promise(() => undefined));
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "DOCX" }));
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a pending DOCX" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    expect(await screen.findByText("Writing plan...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-plan")).toBeTruthy();
    expect(screen.getAllByText("Create a pending DOCX").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /What should we work on/i })).toBeNull();
  });

  it("renders a failed task with its recorded error and bridge event context", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-failed",
        task_id: "task-failed",
        type: "task.failed",
        payload: { message: "model quota exceeded" },
      });
    });

    expect(await screen.findByText("Generation Failed")).toBeTruthy();
    expect(screen.getAllByText("model quota exceeded").length).toBeGreaterThan(0);
    expect(screen.getByText("task.failed")).toBeTruthy();
  });

  it("retries a failed generation with the original task input", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-retry-started",
        task_id: "task-retry",
        type: "task.started",
        payload: { document_type: "img", topic: "Retry poster" },
      });
      bridge.emit({
        event_id: "event-retry-input",
        task_id: "task-retry",
        type: "task.user_input",
        payload: {
          prompt: "Create a poster from the reference",
          reference_images: ["/tmp/ref.png"],
          image_ratio: "portrait",
        },
      });
      bridge.emit({
        event_id: "event-retry-failed",
        task_id: "task-retry",
        type: "task.failed",
        payload: { message: "temporary provider outage" },
      });
    });

    expect(await screen.findByText("Generation Failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        prompt: "Create a poster from the reference",
        referenceImages: ["/tmp/ref.png"],
        imageRatio: "portrait",
      }),
    );
  });

  it("renders a cancelled task as a visible terminal state", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-cancelled",
        task_id: "task-cancelled",
        type: "task.cancelled",
        payload: { message: "User cancelled the task" },
      });
    });

    expect(await screen.findByText("Task Cancelled")).toBeTruthy();
    expect(screen.getAllByText("User cancelled the task").length).toBeGreaterThan(0);
    expect(screen.getByText("cancelled")).toBeTruthy();
  });

  it("shows real bridge tasks in Recent Tasks and reopens the selected task dialogue", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-live-1",
        task_id: "task-live",
        type: "task.started",
        payload: { document_type: "pptx", topic: "Live Bridge Task" },
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));

    expect((await screen.findAllByText("Live Bridge Task")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Live Bridge Task/ }));

    expect(await screen.findByText("Generating PPTX...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-pptx")).toBeTruthy();
  });

  it("uses the page-level New chat button to return to a blank composer", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-completed",
        task_id: "task-completed",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/completed.pptx",
            file_name: "completed.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Tasks/ }));

    const tasksPage = screen.getByRole("heading", { name: "Recent Tasks" }).closest(".page-stack");
    expect(tasksPage).toBeTruthy();
    fireEvent.click(within(tasksPage as HTMLElement).getByRole("button", { name: /New chat/ }));

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
  });

  it("preserves a typed new generation prompt after switching to another conversation and back", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-previous",
        task_id: "task-previous",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/previous.pptx",
            file_name: "previous.pptx",
            document_type: "pptx",
          },
        },
      });
    });
    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    const prompt = await screen.findByPlaceholderText(/Enter what you want to generate/);
    fireEvent.change(prompt, { target: { value: "Draft a quarterly board deck" } });

    fireEvent.click(screen.getByRole("button", { name: /previous\.pptx/ }));
    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    expect(await screen.findByDisplayValue("Draft a quarterly board deck")).toBeTruthy();
  });

  it("preserves image reference attachments after switching to another conversation and submits them", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-previous-img",
        task_id: "task-previous-img",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/previous.pptx",
            file_name: "previous.pptx",
            document_type: "pptx",
          },
        },
      });
    });
    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Image"));
    expect(await screen.findByText("Image ratio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Attach reference images/ })).toBeNull();
    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/);
    firePasteWithFile(textarea, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ref-a.png", { type: "image/png" }));
    expect(await screen.findByText("pasted-1.png")).toBeTruthy();
    firePasteWithFile(screen.getByPlaceholderText(/Enter what you want to generate/), new File([new Uint8Array([0xff, 0xd8, 0xff])], "ref-b.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("pasted-2.jpg")).toBeTruthy();
    fireEvent.change(textarea, {
      target: { value: "Create a poster in this visual style" },
    });

    fireEvent.click(screen.getByRole("button", { name: /previous\.pptx/ }));
    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(await screen.findByText("pasted-1.png")).toBeTruthy();
    expect(screen.getByText("pasted-2.jpg")).toBeTruthy();
    expect(screen.getByDisplayValue("Create a poster in this visual style")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        prompt: "Create a poster in this visual style",
        referenceImages: ["/tmp/pasted-1.png", "/tmp/pasted-2.jpg"],
      }),
    );
  });

  it("preserves a report source workbook after switching to another conversation and submits it", async () => {
    const bridge = installBridgeMock();
    bridge.openFileDialog.mockResolvedValueOnce("/tmp/source.xlsx");
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-previous-report",
        task_id: "task-previous-report",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/previous.docx",
            file_name: "previous.docx",
            document_type: "docx",
          },
        },
      });
    });
    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Report"));
    fireEvent.click(await screen.findByRole("button", { name: /Attach source file/ }));
    await waitFor(() => expect(bridge.openFileDialog).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("source.xlsx")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Analyze workbook trends" },
    });

    fireEvent.click(screen.getByRole("button", { name: /previous\.docx/ }));
    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(await screen.findByText("source.xlsx")).toBeTruthy();
    expect(screen.getByDisplayValue("Analyze workbook trends")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "report",
        prompt: "Analyze workbook trends",
        sourceFile: "/tmp/source.xlsx",
      }),
    );
  });

  it("clears the new generation draft after a successful submit", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a sales deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    const prompt = await screen.findByPlaceholderText(/Enter what you want to generate/) as HTMLTextAreaElement;
    expect(prompt.value).toBe("");
  });

  it("keeps submitted input stable when generate resolves before the optimistic task render", async () => {
    const bridge = installBridgeMock();
    bridge.generate.mockResolvedValueOnce({ taskId: "fast-task", sessionId: "session-fast", status: "starting" });
    const unhandled = vi.fn();
    window.addEventListener("error", unhandled);
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a fast deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getAllByText("Create a fast deck").length).toBeGreaterThan(0));
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener("error", unhandled);
  });

  it("restores the submitted new generation draft when generate rejects before task acceptance", async () => {
    const bridge = installBridgeMock();
    bridge.generate.mockRejectedValueOnce(new Error("provider unavailable"));
    const { App } = await import("./App");

    render(<App />);

    expect(await screen.findByRole("heading", { name: /What should we work on/i })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a deck that should be retried" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    expect(await screen.findByText("provider unavailable")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /New chat/ })[0]);

    expect(await screen.findByDisplayValue("Create a deck that should be retried")).toBeTruthy();
  });

  it("renders running dialogue from task topic and bridge events instead of Q3 sample text", async () => {
    installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");

    render(
      <DialogueScreen
        tasks={[{
          id: "task-running",
          conversationId: "task-running",
          status: "running",
          topic: "Auto-generate product roadmap",
          documentType: "pptx",
          events: [
            {
              event_id: "event-started",
              task_id: "task-running",
              type: "task.started",
              ts: "2026-05-20T10:00:00+08:00",
              payload: { message: "Roadmap task started" },
            },
            {
              event_id: "event-progress",
              task_id: "task-running",
              type: "task.progress",
              ts: "2026-05-20T10:00:05+08:00",
              payload: { stage: "Generating milestone sections" },
            },
          ],
        }]}
        busy={false}
        bridgeStatus="connected"
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={vi.fn()}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Auto-generate product roadmap")).toBeTruthy();
    expect(screen.getByText("Generating PPTX...")).toBeTruthy();
    expect(document.querySelector(".generation-loading-pptx")).toBeTruthy();
    expect(screen.queryByText(/Roadmap task started/)).toBeNull();
    expect(screen.queryByText("Generating milestone sections")).toBeNull();
    expect(screen.queryByText(/Q3 promo/)).toBeNull();
    expect(screen.queryByText(/market data report/)).toBeNull();
    expect(screen.queryByText(/knowledge base/)).toBeNull();
  });

  it("renders completed dialogue from the current task artifact and event payload", async () => {
    const bridge = installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");
    const artifact = {
      taskId: "task-completed-real",
      filePath: "/tmp/budget-summary.docx",
      fileName: "budget-summary.docx",
      documentType: "docx",
      syncedAt: "2026-05-20 11:30",
      previewUrl: "https://platform.officecli.io/files/budget-summary",
    };
    const onPreview = vi.fn();

    render(
      <DialogueScreen
        tasks={[{
          id: "task-completed-real",
          conversationId: "task-completed-real",
          status: "completed",
          topic: "Annual budget review",
          documentType: "docx",
          events: [
            {
              event_id: "event-completed-real",
              task_id: "task-completed-real",
              type: "task.completed",
              ts: "2026-05-20T11:30:00+08:00",
              payload: { message: "Budget review synced" },
            },
          ],
          artifact,
        }]}
        busy={false}
        bridgeStatus="connected"
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={onPreview}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Budget review synced")).toBeTruthy();
    expect(screen.getByText("budget-summary.docx")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Online Preview/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(onPreview).toHaveBeenCalledWith(artifact);
    expect(bridge.openExternal).not.toHaveBeenCalled();
    expect(screen.queryByText("other-task.pptx")).toBeNull();
    expect(screen.queryByText(/Q3/)).toBeNull();
    expect(screen.queryByText("12s elapsed")).toBeNull();
    expect(screen.queryByText(/2.4 MB/)).toBeNull();
    expect(screen.queryByText(/Just now/)).toBeNull();
  });

  it("does not show another task artifact when a completed task has no artifact", async () => {
    installBridgeMock();
    const { DialogueScreen } = await import("./screens/DialogueScreens");

    render(
      <DialogueScreen
        tasks={[{
          id: "task-completed-empty",
          conversationId: "task-completed-empty",
          status: "completed",
          topic: "Completed only",
          documentType: "report",
          events: [
            {
              event_id: "event-completed-empty",
              task_id: "task-completed-empty",
              type: "task.completed",
              payload: { status: "completed" },
            },
          ],
        }]}
        busy={false}
        bridgeStatus="connected"
        onSubmit={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenLogin={vi.fn()}
        onRetry={vi.fn()}
        onPreview={vi.fn()}
        errorKind="connection"
      />,
    );

    expect(screen.getByText("Generation Complete")).toBeTruthy();
    expect(screen.getByText("Completed only")).toBeTruthy();
    expect(screen.queryByText("other-task.pptx")).toBeNull();
  });

  it("submits referenceImages when documentType is Image and the user pastes reference images", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });

    fireEvent.click(screen.getByLabelText("Image"));
    expect(await screen.findByText("Image ratio")).toBeTruthy();

    expect(screen.queryByRole("button", { name: /Attach reference images/ })).toBeNull();
    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/);
    firePasteWithFile(textarea, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ref-a.png", { type: "image/png" }));
    expect(await screen.findByText("pasted-1.png")).toBeTruthy();
    firePasteWithFile(screen.getByPlaceholderText(/Enter what you want to generate/), new File([new Uint8Array([0xff, 0xd8, 0xff])], "ref-b.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("pasted-2.jpg")).toBeTruthy();
    expect(bridge.openMultiFileDialog).not.toHaveBeenCalled();

    fireEvent.change(textarea, {
      target: { value: "Match the style of these references" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        referenceImages: ["/tmp/pasted-1.png", "/tmp/pasted-2.jpg"],
      }),
    );
  });

  it("submits selected imageRatio for new image generation", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });

    fireEvent.click(screen.getByLabelText("Image"));
    expect(await screen.findByText("Image ratio")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Landscape"));
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a wide launch visual" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        prompt: "Create a wide launch visual",
        imageRatio: "landscape",
      }),
    );
  });

  it("shows GIF in new generation and submits fps", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });

    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    expect(await screen.findByText("GIF FPS")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Create a launch GIF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "gif",
        prompt: "Create a launch GIF",
        fps: 16,
      }),
    );
    expect(bridge.generate).toHaveBeenCalledWith(expect.not.objectContaining({ imageRatio: expect.anything() }));
  });

  it("does not include referenceImages when documentType is not Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });

    fireEvent.change(screen.getByPlaceholderText(/Enter what you want to generate/), {
      target: { value: "Build a deck" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate$/ }));

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(expect.not.objectContaining({ referenceImages: expect.anything() }));
    expect(bridge.generate).toHaveBeenCalledWith(expect.not.objectContaining({ imageRatio: expect.anything() }));
  });

  it("continuation composer on completed image task calls generate with new prompt and no referenceImages by default", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-img-done",
        task_id: "task-img-done",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/generated.png",
            file_name: "generated.png",
            document_type: "img",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    const composer = screen.getByTestId("continuation-composer");
    expect(composer).toBeTruthy();
    const textarea = within(composer).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Make the sky brighter" } });
    const submitBtn = within(composer).getByRole("button", { name: /generate/i });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        prompt: "Make the sky brighter",
      }),
    );
  });

  it("continuation composer on completed image task sends selected imageRatio", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-img-ratio-done",
        task_id: "task-img-ratio-done",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/generated.png",
            file_name: "generated.png",
            document_type: "img",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    const composer = screen.getByTestId("continuation-composer");
    fireEvent.click(within(composer).getByLabelText("Portrait"));
    const textarea = within(composer).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Make it vertical" } });
    const submitBtn = within(composer).getByRole("button", { name: /generate/i });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));
    expect(bridge.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        documentType: "img",
        prompt: "Make it vertical",
        imageRatio: "portrait",
      }),
    );
  });

  it("keeps a continued image generation in the same sidebar conversation when bridge events arrive before generate resolves", async () => {
    const bridge = installBridgeMock();
    bridge.generate.mockImplementation(() => new Promise(() => undefined));
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-img-done",
        task_id: "task-img-done",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/generated.png",
            file_name: "generated.png",
            document_type: "img",
          },
        },
      });
    });

    expect(await screen.findByText("Generation Complete")).toBeTruthy();
    expect(document.querySelectorAll(".history-list .history-item")).toHaveLength(1);

    const composer = screen.getByTestId("continuation-composer");
    fireEvent.change(within(composer).getByRole("textbox"), {
      target: { value: "Make the sky brighter" },
    });
    fireEvent.click(within(composer).getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    act(() => {
      bridge.emit({
        event_id: "event-img-edit-started",
        task_id: "task-img-edit",
        type: "task.started",
        payload: { document_type: "img", topic: "Make the sky brighter" },
      });
    });

    await waitFor(() => expect(document.querySelectorAll(".history-list .history-item")).toHaveLength(1));
    expect(screen.getByText("Thinking...")).toBeTruthy();
    expect(screen.getAllByText("generated.png").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Make the sky brighter").length).toBeGreaterThan(0);
  });

  it("deletes every task in a sidebar conversation", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    act(() => {
      bridge.emit({
        event_id: "event-img-done",
        task_id: "task-img-done",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/generated.png",
            file_name: "generated.png",
            document_type: "img",
          },
        },
      });
    });
    expect(await screen.findByText("Generation Complete")).toBeTruthy();

    const composer = screen.getByTestId("continuation-composer");
    fireEvent.change(within(composer).getByRole("textbox"), {
      target: { value: "Make the sky brighter" },
    });
    fireEvent.click(within(composer).getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(bridge.generate).toHaveBeenCalledTimes(1));

    act(() => {
      bridge.emit({
        event_id: "event-img-edit-completed",
        task_id: "task-2",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/brighter.png",
            file_name: "brighter.png",
            document_type: "img",
          },
        },
      });
    });
    expect(await screen.findByText("brighter.png")).toBeTruthy();

    fireEvent.click(document.querySelector(".history-item-delete") as HTMLElement);

    await screen.findByRole("heading", { name: /What should we work on/i });
    expect(document.querySelectorAll(".history-list .history-item")).toHaveLength(0);
    expect(screen.queryByText("generated.png")).toBeNull();
    expect(screen.queryByText("brighter.png")).toBeNull();
  });

  it("attaches pasted image files as reference images when documentType is Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });
    fireEvent.click(screen.getByLabelText("Image"));
    expect(await screen.findByText("Image ratio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Attach reference images/ })).toBeNull();

    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/) as HTMLTextAreaElement;
    const pastedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot.png", { type: "image/png" });
    firePasteWithFile(textarea, pastedFile);

    await waitFor(() => expect(bridge.savePastedImage).toHaveBeenCalledTimes(1));
    expect(bridge.savePastedImage).toHaveBeenCalledWith(expect.any(Uint8Array), "png");
    expect(await screen.findByText("pasted-1.png")).toBeTruthy();
  });

  it("does not call savePastedImage when documentType is not Image", async () => {
    const bridge = installBridgeMock();
    const { App } = await import("./App");

    render(<App />);

    await screen.findByRole("heading", { name: /What should we work on/i });

    const textarea = screen.getByPlaceholderText(/Enter what you want to generate/) as HTMLTextAreaElement;
    const pastedFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "screenshot.png", { type: "image/png" });
    firePasteWithFile(textarea, pastedFile);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bridge.savePastedImage).not.toHaveBeenCalled();
  });
});

async function confirmDemoNode(title: string) {
  await waitFor(() => expect(pendingDemoNodeCard(title)).toBeTruthy(), { timeout: DEMO_NODE_SEQUENCE_TIMEOUT_MS });
  const nodeCard = pendingDemoNodeCard(title) as HTMLElement;
  const nodeId = nodeCard.closest(".react-flow__node")?.getAttribute("data-id");
  const nodeSummary = nodeCard.querySelector("p")?.textContent;
  fireEvent.click(nodeCard);
  await waitFor(() => {
    const popover = currentOpenDemoPopover(title, nodeSummary);
    expect(popover?.querySelector("strong")?.textContent).toBe(title);
    expect(within(popover as HTMLElement).getByRole("button", { name: "Confirm this node" })).toBeTruthy();
  }, { timeout: DEMO_NODE_SEQUENCE_TIMEOUT_MS });
  fireEvent.click(within(currentOpenDemoPopover(title, nodeSummary) as HTMLElement).getByRole("button", { name: "Confirm this node" }));
  if (nodeId) {
    await waitFor(() => expect(demoNodeCardById(nodeId)?.classList.contains("is-confirmed")).toBe(true), { timeout: DEMO_NODE_SEQUENCE_TIMEOUT_MS });
  }
}

async function waitForDemoNodeTitle(title: string) {
  await waitFor(() => expect(demoNodeCard(title)).toBeTruthy(), { timeout: DEMO_NODE_SEQUENCE_TIMEOUT_MS });
}

async function clickReadyDemoStageButton(name: string) {
  await waitFor(() => {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  }, { timeout: DEMO_NODE_SEQUENCE_TIMEOUT_MS });
  fireEvent.click(screen.getByRole("button", { name }));
}

function demoNodeCard(title: string) {
  return (Array.from(document.querySelectorAll(".living-tree-flow-node"))
    .find((node) => node.querySelector("strong")?.textContent === title) as HTMLElement | undefined) ?? null;
}

function currentOpenDemoPopover(title?: string, summary?: string) {
  const popovers = Array.from(document.querySelectorAll(".ui-popover[data-open='true'] .living-tree-popover"));
  if (title) {
    const matched = popovers.find((popover) => {
      const text = popover.textContent ?? "";
      return text.includes(title) && (!summary || text.includes(summary));
    });
    if (matched) return matched as HTMLElement;
    return undefined;
  }
  return popovers.at(-1) as HTMLElement | undefined;
}

function pendingDemoNodeCard(title: string) {
  return Array.from(document.querySelectorAll(".living-tree-flow-node.is-confirmable.is-pending"))
    .find((node) => !document.querySelector(".living-tree-flow-node.is-node-drawing") && !node.classList.contains("is-node-drawing") && !node.classList.contains("is-node-waiting") && node.querySelector("strong")?.textContent === title) as HTMLElement | undefined;
}

function pendingDemoNodeCardById(nodeId: string) {
  return document.querySelector(`.react-flow__node[data-id="${nodeId}"] .living-tree-flow-node.is-confirmable.is-pending`);
}

function demoNodeCardById(nodeId: string) {
  return document.querySelector(`.react-flow__node[data-id="${nodeId}"] .living-tree-flow-node`) as HTMLElement | null;
}

describe("App auto-update flow", () => {
  beforeEach(() => {
    installDomStubs();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as { officecli?: unknown }).officecli;
  });

  it("renders ForceUpdateOverlay and hides the main shell when release is mandatory", async () => {
    const bridge = installBridgeMock();
    const { officecli } = await import("./bridge");
    const release = {
      version: "0.5.0",
      notes: "Critical migration",
      minSupportedVersion: "0.5.0",
      mandatory: true,
      assets: {},
    };
    const status = {
      currentVersion: "0.1.0",
      latestVersion: "0.5.0",
      updateAvailable: true,
      mandatory: true,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    };
    const checkSpy = vi.fn(async () => ({ release, status }));
    const downloadSpy = vi.fn(async () => "/tmp/x.dmg");
    const installSpy = vi.fn(async () => undefined);
    officecli.checkAppUpdate = checkSpy as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = downloadSpy as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = installSpy as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = vi.fn(async () => undefined) as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = (() => () => undefined) as unknown as DesktopAPI["onAppUpdateEvent"];
    officecli.getAppVersion = (async () => "0.1.0") as unknown as DesktopAPI["getAppVersion"];

    const { App } = await import("./App");
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Required update/i)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /What should we work on/i })).toBeNull();
    expect(bridge.generate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Update now"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  });

  it("renders UpdateBanner and keeps the Shell visible when release is non-mandatory", async () => {
    installBridgeMock();
    const { officecli } = await import("./bridge");
    const release = {
      version: "0.2.0",
      notes: "Bug fixes.",
      minSupportedVersion: "0.0.0",
      mandatory: false,
      assets: {},
    };
    const status = {
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      mandatory: false,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
    };
    officecli.checkAppUpdate = (async () => ({ release, status })) as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = (async () => "/tmp/x.dmg") as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = (async () => undefined) as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = (async () => undefined) as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = (() => () => undefined) as unknown as DesktopAPI["onAppUpdateEvent"];
    officecli.getAppVersion = (async () => "0.1.0") as unknown as DesktopAPI["getAppVersion"];

    const { App } = await import("./App");
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/New version 0\.2\.0 available/i)).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("App credit display", () => {
  beforeEach(() => {
    vi.resetModules();
    installDomStubs();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function overrideCreditStatus(status: {
    mode: "anonymous" | "logged_in" | "api_key";
    accessMode?: string;
    planName?: string;
    hostedCreditBalance?: number | null;
    anonymousCreditAvailable?: number | null;
    anonymousCreditReserved?: number | null;
    anonymousCreditBalance?: number | null;
    rewardRemaining?: number;
    paidKeyPrefix?: string;
    paidKeyTotal?: number;
    paidKeyUsed?: number;
    paidKeyRemaining?: number;
    paidEntitlement?: boolean;
  }) {
    const api = (window as unknown as { officecli: DesktopAPI }).officecli;
    api.getCreditStatus = (async () => ({
      mode: status.mode,
      accessMode: status.accessMode ?? "",
      planName: status.planName ?? "",
      hostedCreditBalance: status.hostedCreditBalance ?? null,
      anonymousCreditAvailable: status.anonymousCreditAvailable ?? null,
      anonymousCreditReserved: status.anonymousCreditReserved ?? null,
      anonymousCreditBalance: status.anonymousCreditBalance ?? null,
      rewardRemaining: status.rewardRemaining ?? 0,
      paidKeyPrefix: status.paidKeyPrefix ?? "",
      paidKeyTotal: status.paidKeyTotal ?? 0,
      paidKeyUsed: status.paidKeyUsed ?? 0,
      paidKeyRemaining: status.paidKeyRemaining ?? 0,
      paidEntitlement: status.paidEntitlement ?? false,
      raw: "",
    })) as unknown as DesktopAPI["getCreditStatus"];
  }

  it("renders anonymous credit balance when getCreditStatus returns anonymous credits", async () => {
    installBridgeMock();
    overrideCreditStatus({
      mode: "anonymous",
      anonymousCreditAvailable: 75,
      anonymousCreditReserved: 25,
      anonymousCreditBalance: 100,
    });

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("75 / 100")).toBeTruthy();
    expect(screen.getAllByText("Credits").length).toBeGreaterThan(0);
    const meter = document.querySelector(".credit-meter");
    expect(meter?.closest(".sidebar")).toBeTruthy();
    expect(document.querySelector(".main-frame .credit-meter")).toBeNull();
  });

  it("renders hosted balance when getCreditStatus returns logged_in with hostedCreditBalance and ignores any anonymous fields", async () => {
    installBridgeMock();
    overrideCreditStatus({
      mode: "logged_in",
      hostedCreditBalance: 42,
      planName: "Pro",
      accessMode: "hosted",
      anonymousCreditAvailable: 10,
      anonymousCreditReserved: 0,
      anonymousCreditBalance: 10,
    });

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("42 credits")).toBeTruthy();
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    const meter = document.querySelector(".credit-meter");
    expect(meter?.closest(".sidebar")).toBeTruthy();
    expect(document.querySelector(".main-frame .credit-meter")).toBeNull();
  });

  it("keeps the credit meter in the sidebar when the sidebar is collapsed", async () => {
    installBridgeMock();
    overrideCreditStatus({
      mode: "logged_in",
      hostedCreditBalance: 42,
      planName: "Pro",
      accessMode: "hosted",
    });

    const { App } = await import("./App");
    render(<App />);

    await screen.findByRole("button", { name: /Show credit balance/i });
    fireEvent.click(screen.getByRole("button", { name: /Collapse sidebar/i }));

    expect(document.querySelector(".app-shell.sidebar-collapsed")).toBeTruthy();
    const meter = document.querySelector(".credit-meter");
    expect(meter?.closest(".sidebar")).toBeTruthy();
    expect(document.querySelector(".main-frame .credit-meter")).toBeNull();
  });

  it("refreshes the sidebar credit meter after a task.completed event (covers settlement delay)", async () => {
    const bridge = installBridgeMock();
    const api = (window as unknown as { officecli: DesktopAPI }).officecli;
    const sequence: number[] = [100, 100, 80];
    let call = 0;
    api.getCreditStatus = (async () => {
      const balance = sequence[Math.min(call, sequence.length - 1)];
      call += 1;
      return {
        mode: "logged_in" as const,
        accessMode: "hosted",
        planName: "Pro",
        hostedCreditBalance: balance,
        anonymousCreditAvailable: null,
        anonymousCreditReserved: null,
        anonymousCreditBalance: null,
        rewardRemaining: 0,
        paidKeyPrefix: "",
        paidKeyTotal: 0,
        paidKeyUsed: 0,
        paidKeyRemaining: 0,
        paidEntitlement: false,
        raw: "",
      };
    }) as unknown as DesktopAPI["getCreditStatus"];

    const { App } = await import("./App");
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Show credit balance/i }));
    expect(await screen.findByText("100 credits")).toBeTruthy();

    act(() => {
      bridge.emit({
        event_id: "event-credit-1",
        task_id: "task-credit-1",
        type: "task.completed",
        payload: {
          result: {
            file_path: "/tmp/credit.pptx",
            file_name: "credit.pptx",
            document_type: "pptx",
          },
        },
      });
    });

    await waitFor(() => expect(screen.getByText("80 credits")).toBeTruthy(), { timeout: 1500 });
  });
});

function firePasteWithFile(target: HTMLElement, file: File) {
  const dataTransfer = {
    files: [file] as unknown as FileList,
    items: [],
    types: ["Files"],
    getData: () => "",
  } as unknown as DataTransfer;
  const event = createEvent.paste(target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: dataTransfer });
  fireEvent(target, event);
}

function installBridgeMock() {
  let listener: (event: BridgeEvent) => void = () => undefined;
  const generate = vi.fn(async () => ({ taskId: "task-2", sessionId: "session-2", status: "starting" }));
  const previewArtifact = vi.fn(async () => undefined);
  const openExternal = vi.fn(async () => undefined);
  const openFileDialog = vi.fn<(options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>>(async () => null);
  const openMultiFileDialog = vi.fn<(options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string[] | null>>(async () => null);
  const savePastedImage = vi.fn<(data: Uint8Array, ext: string) => Promise<string>>(
    async (_data: Uint8Array, ext: string): Promise<string> =>
      `/tmp/pasted-${savePastedImage.mock.calls.length}.${ext || "png"}`,
  );
  const api: DesktopAPI = {
    initialize: vi.fn(async () => ({})),
    getCapabilities: vi.fn(async () => ({})),
    listImageTemplates: vi.fn(async () => []),
    createImageTemplate: vi.fn(async () => ({ id: 1, slug: "mock", title: "Mock", description: "", promptPreset: "", sortOrder: 0, enabled: true })),
    createImageTemplatePublishRequest: vi.fn(async () => ({ id: 1, privateTemplateID: 1, provenanceID: 1, status: "pending" })),
    generate,
    modify: vi.fn(async () => ({ taskId: "task-modify", sessionId: "session-2", status: "starting" })),
    respond: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    showItemInFolder: vi.fn(async () => undefined),
    openExternal,
    openFileDialog,
    openDirectoryDialog: vi.fn(async () => null),
    openMultiFileDialog,
	    savePastedImage,
	    savePptx: vi.fn(async () => "/tmp/deck.pptx"),
	    exportVibeTreePptx: vi.fn(async () => "/tmp/deck.pptx"),
	    modifyPptistDeck: vi.fn(async () => ({ summary: "updated", ops: [] })),
	    previewArtifact,
    readArtifactFile: vi.fn(async () => ({ data: new Uint8Array() })),
    readLocalImage: vi.fn(async () => ({ data: new Uint8Array(), mime: "image/png" })),
    copyImageToClipboard: vi.fn(async () => undefined),
    issuePreviewToken: vi.fn(async (artifact) => ({ token: "test-token", fileName: artifact.fileName, documentType: artifact.documentType })),
    revokePreviewToken: vi.fn(async () => undefined),
    prepareXlsxEditor: vi.fn(async () => ({ sessionId: "xlsx-session", modocContent: "modoc" })),
    saveXlsxEditor: vi.fn(async () => ({ filePath: "/tmp/workbook.xlsx" })),
    closeXlsxEditor: vi.fn(async () => undefined),
    setPreviewMode: vi.fn(async () => undefined),
    login: vi.fn(async () => ({ url: "https://example.com/login" })),
    cancelLogin: vi.fn(async () => undefined),
    whoami: vi.fn(async () => ({ mode: "anonymous" as const })),
    logout: vi.fn(async () => undefined),
    getCreditStatus: vi.fn(async () => ({
      mode: "anonymous" as const,
      accessMode: "",
      planName: "",
      hostedCreditBalance: null,
      anonymousCreditAvailable: null,
      anonymousCreditReserved: null,
      anonymousCreditBalance: null,
      rewardRemaining: 0,
      paidKeyPrefix: "",
      paidKeyTotal: 0,
      paidKeyUsed: 0,
      paidKeyRemaining: 0,
      paidEntitlement: false,
      raw: "",
    })),
    getInviteInfo: vi.fn(async () => ({ invite_code: "invite-test" })),
    redeem: vi.fn(async () => ({
      code: "",
      credit_amount: 0,
      new_balance: 0,
      redeemed_at: "",
      expires_at: null,
    })),
    getSettings: vi.fn(async () => ({
      version: 1,
      defaults: {
        documentType: "pptx" as const,
        enableImages: true,
        imageQuality: "premium" as const,
      },
      workspaceDir: null,
      outputDir: null,
      llmProvider: null,
      onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
      proxy: null,
      imageWatermark: { showWatermark: true, preferenceSource: "system" as const },
      waiting2048Enabled: false,
    })),
    updateSettings: vi.fn(async (patch) => ({
      version: 1,
      defaults: {
        documentType: "pptx" as const,
        enableImages: true,
        imageQuality: "premium" as const,
        ...(patch.defaults ?? {}),
      },
      workspaceDir: patch.workspaceDir ?? null,
      outputDir: patch.outputDir ?? null,
      llmProvider: patch.llmProvider ?? null,
      onboardingCompletedAt: patch.onboardingCompletedAt ?? "2026-05-22T00:00:00.000Z",
      proxy: patch.proxy ?? null,
      imageWatermark: patch.imageWatermark ?? { showWatermark: true, preferenceSource: "system" as const },
      waiting2048Enabled: patch.waiting2048Enabled ?? false,
    })),
    getDefaultWorkspaceDir: vi.fn(async () => "/Users/test/Library/Application Support/OfficeDex/workspace"),
    listWorkspaces: vi.fn(async () => [{
      id: "ws-default",
      name: "workspace",
      path: "/Users/test/Library/Application Support/OfficeDex/workspace",
      active: true,
      conversations: [],
    }]),
    listChats: vi.fn(async () => []),
    listRecentFiles: vi.fn(async () => []),
    removeRecentFile: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async (workspaceId: string, name: string) => ({
      id: workspaceId,
      name: name.trim(),
      path: "/Users/test/Library/Application Support/OfficeDex/workspace",
      active: true,
      conversations: [],
    })),
    openRecentFile: vi.fn(async (file) => ({
      taskId: file.taskId,
      filePath: file.filePath,
      fileName: file.fileName,
      documentType: file.documentType,
    })),
    deleteConversation: vi.fn(async () => undefined),
    addWorkspace: vi.fn(async (path: string) => ({
      id: "ws-picked",
      name: path.split("/").pop() || "workspace",
      path,
      active: true,
      conversations: [],
    })),
    selectWorkspace: vi.fn(async (workspaceId: string) => ({
      id: workspaceId,
      name: "workspace",
      path: "/Users/test/Library/Application Support/OfficeDex/workspace",
      active: true,
      conversations: [],
    })),
    removeWorkspace: vi.fn(async () => undefined),
    onAuthEvent: vi.fn(() => () => undefined),
    onBridgeEvent: vi.fn((callback) => {
      listener = callback;
      return () => undefined;
    }),
    onFileDrop: vi.fn(() => () => undefined),
    getAppVersion: vi.fn(async () => "0.1.0"),
    getAppUpdateStatus: vi.fn(async () => ({
      currentVersion: "0.1.0",
      latestVersion: null,
      updateAvailable: false,
      mandatory: false,
      downloading: false,
      downloadedPath: null,
      lastCheckedAt: null,
      lastError: null,
    })),
    checkAppUpdate: vi.fn(async () => ({
      release: null,
      status: {
        currentVersion: "0.1.0",
        latestVersion: null,
        updateAvailable: false,
        mandatory: false,
        downloading: false,
        downloadedPath: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      },
    })),
    downloadAppUpdate: vi.fn(async () => ""),
    installAppUpdate: vi.fn(async () => undefined),
    cancelAppUpdate: vi.fn(async () => undefined),
    onAppUpdateEvent: vi.fn(() => () => undefined),
    exportLogs: vi.fn(async () => ({ path: "/Users/test/Downloads/officedex-logs.zip", manifest: { schemaVersion: 1, bundleId: "test", items: [], truncated: false } })),
    submitReport: vi.fn(async () => ({ ticketId: "T-001", requestId: "req-test-123", uploaded: true })),
    getReportCapability: vi.fn(async () => ({ enabled: false, reason: "test" })),
    peekReportContext: vi.fn(async () => ({ requestId: "req-test-123", errorCode: "", errorMessage: "" })),
    getTaskHistory: vi.fn(async () => []),
    getBridgeRuntimeSnapshot: vi.fn(async () => ({ runtimeMode: "hosted" as const, binaryPath: "", envApplied: false })),
    recordRendererLog: vi.fn(async () => undefined),
    testProvider: vi.fn(async () => ({ ok: true, httpStatus: 200, latencyMs: 12, url: "https://api.openai.com" })),
  };
  window.officecli = api;
  return {
    generate,
    previewArtifact,
    issuePreviewToken: api.issuePreviewToken,
    openExternal,
    openFileDialog,
    openMultiFileDialog,
    savePastedImage,
    emit(event: BridgeEvent) {
      listener(event);
    },
  };
}

function installDomStubs() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: () => "",
      }) as unknown as CSSStyleDeclaration,
  );
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  if (typeof Blob.prototype.arrayBuffer !== "function") {
    Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
}

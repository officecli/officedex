import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSummary, WorkspaceConversationSummary } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { HistoryList } from "./HistoryList";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function installDomStubs() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
}

function conversation(overrides: Partial<WorkspaceConversationSummary>): WorkspaceConversationSummary {
  return {
    conversationId: "task-1",
    firstTaskId: "task-1",
    latestTaskId: "task-1",
    status: "completed",
    title: "Quarterly review",
    documentType: "pptx",
    updatedAt: "2026-06-10T10:00:00Z",
    ...overrides,
  };
}

function workspace(overrides: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    id: "ws-1",
    name: "void-oversea",
    path: "/Users/test/void-oversea",
    active: false,
    conversations: [],
    ...overrides,
  };
}

function renderHistory(workspaces: WorkspaceSummary[], overrides: Partial<Parameters<typeof HistoryList>[0]> = {}) {
  installDomStubs();
  const props = {
    workspaces,
    chats: [],
    activeWorkspaceId: workspaces[0]?.id,
    selectedConversationId: workspaces[0]?.conversations[0]?.conversationId,
    collapsed: false,
    onSelect: () => undefined,
    onDelete: () => undefined,
    onSelectWorkspace: () => undefined,
    onNewConversation: () => undefined,
    onAddWorkspace: () => undefined,
    onRevealWorkspace: () => undefined,
    onRemoveWorkspace: () => undefined,
    ...overrides,
  } as Parameters<typeof HistoryList>[0];
  return render(
    <LocaleProvider value="en">
      <HistoryList {...props} />
    </LocaleProvider>,
  );
}

describe("HistoryList", () => {
  it("marks standalone task conversations as a legacy compatibility entry", () => {
    renderHistory([], {
      chats: [conversation({ conversationId: "legacy-chat", title: "Imported task" })],
    });

    expect(screen.getByText("Legacy task history")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Collapse Chats/ }).getAttribute("data-legacy-entry")).toBe("true");
  });

  it("separates projects from no-project chats", () => {
    renderHistory([
      workspace({
        id: "ws-a",
        name: "void-oversea",
        active: true,
        conversations: [
          conversation({ conversationId: "conv-a", latestTaskId: "task-a", title: "Workspace feature" }),
        ],
      }),
      workspace({ id: "ws-b", name: "officecli", conversations: [] }),
    ], {
      chats: [
        conversation({ conversationId: "chat-a", latestTaskId: "task-chat-a", title: "Standalone chat" }),
      ],
    });

    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();
    expect(screen.getByRole("button", { name: "void-oversea" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Workspace feature/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "officecli" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Standalone chat/ })).toBeTruthy();
    expect(screen.getByText("Legacy task history")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Collapse Chats/ }).getAttribute("data-legacy-entry")).toBe("true");
    expect(screen.getByText("No chats")).toBeTruthy();
  });

  it("creates a new conversation in the selected workspace", () => {
    const onNewConversation = vi.fn();
    renderHistory([
      workspace({ id: "ws-a", name: "void-oversea", active: true }),
    ], { onNewConversation });

    fireEvent.click(screen.getByRole("button", { name: /New chat in void-oversea/ }));
    expect(onNewConversation).toHaveBeenCalledWith("ws-a");
  });

  it("opens an existing-folder menu from the project add button", () => {
    const onAddWorkspace = vi.fn();
    renderHistory([
      workspace({ id: "ws-a", name: "void-oversea", active: true }),
    ], { onAddWorkspace });

    fireEvent.click(screen.getByRole("button", { name: /Add project/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Use an existing folder/ }));

    expect(onAddWorkspace).toHaveBeenCalledTimes(1);
  });

  it("collapses projects and chats independently", () => {
    const onSelectWorkspace = vi.fn();
    renderHistory([
      workspace({
        id: "ws-a",
        name: "void-oversea",
        conversations: [conversation({ conversationId: "conv-a", latestTaskId: "task-a", title: "Project chat" })],
      }),
    ], {
      chats: [conversation({ conversationId: "chat-a", latestTaskId: "task-chat-a", title: "Standalone chat" })],
      onSelectWorkspace,
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse void-oversea" }));
    expect(screen.queryByRole("button", { name: /Project chat/ })).toBeNull();
    expect(onSelectWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Chats" }));
    expect(screen.queryByRole("button", { name: /Standalone chat/ })).toBeNull();
  });

  it("shows project overflow actions and calls enabled handlers", () => {
    const onRevealWorkspace = vi.fn();
    const onRemoveWorkspace = vi.fn();
    vi.stubGlobal("confirm", vi.fn(() => true));
    renderHistory([
      workspace({ id: "ws-a", name: "void-oversea", path: "/Users/test/void-oversea", active: true }),
    ], { onRevealWorkspace, onRemoveWorkspace });

    fireEvent.click(screen.getByRole("button", { name: "Project actions for void-oversea" }));
    expect(screen.getByRole("menuitem", { name: "Pin" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Create permanent worktree" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Rename" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: /Archive chats/ }).getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(screen.getByRole("menuitem", { name: /Reveal in Finder/ }));
    expect(onRevealWorkspace).toHaveBeenCalledWith("/Users/test/void-oversea");

    fireEvent.click(screen.getByRole("button", { name: "Project actions for void-oversea" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Remove$/ }));
    expect(onRemoveWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("renders active conversations with a spinner instead of a solid status dot", () => {
    renderHistory([workspace({
      conversations: [
        conversation({ conversationId: "conv-running", latestTaskId: "task-running", status: "running", title: "Running conversation" }),
        conversation({ conversationId: "conv-starting", latestTaskId: "task-starting", status: "starting", title: "Starting conversation" }),
        conversation({ conversationId: "conv-done", latestTaskId: "task-done", status: "completed", title: "Done conversation" }),
      ],
    })]);

    const runningItem = screen.getByRole("button", { name: /Running conversation/ });
    const startingItem = screen.getByRole("button", { name: /Starting conversation/ });
    const completedItem = screen.getByRole("button", { name: /Done conversation/ });

    expect(runningItem.querySelector(".status-spinner")).toBeTruthy();
    expect(runningItem.querySelector(".status-dot")).toBeNull();
    expect(startingItem.querySelector(".status-spinner")).toBeTruthy();
    expect(startingItem.querySelector(".status-dot")).toBeNull();
    expect(completedItem.querySelector(".status-dot.green")).toBeTruthy();
  });

  it("selects the latest task id while deleting by conversation id", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    renderHistory(
      [
        workspace({
          conversations: [
            conversation({
              conversationId: "conv-1",
              firstTaskId: "task-1",
              latestTaskId: "task-2",
              title: "Stable title",
            }),
          ],
        }),
      ],
      { onSelect, onDelete },
    );

    fireEvent.click(screen.getByRole("button", { name: /Stable title/ }));
    expect(onSelect).toHaveBeenCalledWith("task-2");

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith("conv-1");
  });

  it("keeps the delete affordance in a reserved layout slot to avoid hover jitter", () => {
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");

    expect(css).toContain("grid-template-columns: 22px minmax(0, 1fr) 14px 24px");
    expect(css).toMatch(/\.history-item-delete\s*\{[^}]*opacity:\s*0;/s);
    expect(css).toMatch(/\.history-item-delete\s*\{[^}]*pointer-events:\s*none;/s);
    expect(css).not.toMatch(/\.history-item-delete\s*\{[^}]*display:\s*none;/s);
  });
});

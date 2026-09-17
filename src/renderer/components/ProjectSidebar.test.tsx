import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSummary } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { dialog } from "../ui";
import { ProjectSidebar } from "./ProjectSidebar";

const workspaces: WorkspaceSummary[] = [{
  id: "ws-a",
  path: "/tmp/client-a",
  name: "Client A",
  active: true,
}];

afterEach(() => {
  dialog.destroy();
  cleanup();
});

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ProjectSidebar>> = {}) {
  const props: React.ComponentProps<typeof ProjectSidebar> = {
    workspaces,
    activeWorkspaceId: "ws-a",
    onSelectAll: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onAddWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(async () => undefined),
    onRevealWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    ...overrides,
  };
  render(<LocaleProvider value="en"><ProjectSidebar {...props} /></LocaleProvider>);
  return props;
}

describe("ProjectSidebar", () => {
  it("keeps the OfficeDex icon and returns to the unfiltered home", () => {
    const props = renderSidebar();
    expect(screen.getByRole("img", { name: "OfficeDex" })).toHaveAttribute("src", "./officedex-logo.png");
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Client A" }));
    expect(props.onSelectAll).toHaveBeenCalledOnce();
    expect(props.onSelectWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("creates, renames, reveals, and removes a content space through the row menu", async () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Add content space" }));
    fireEvent.click(screen.getByRole("button", { name: "Actions for Client A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(input, { target: { value: "Renamed project" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAddWorkspace).toHaveBeenCalledOnce();
    expect(props.onRenameWorkspace).toHaveBeenCalledWith("ws-a", "Renamed project");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Client A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show in Finder" }));
    expect(props.onRevealWorkspace).toHaveBeenCalledWith("/tmp/client-a");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Client A" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(await screen.findByText(/files stay on disk/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(props.onRemoveWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("keeps the New action free of task signal bubbles", () => {
    renderSidebar({ workspaces: [], signal: { kind: "attention", count: 2 } });
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
    expect(document.querySelector(".project-sidebar__badge")).toBeNull();
  });

  it("shows the signed-in account without a credit meter in the footer", () => {
    renderSidebar({
      account: { mode: "logged_in", email: "luyang@example.com" },
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "luyang@example.com" })).toBeTruthy();
  });

  it("keeps home, settings, and account keyboard-accessible", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(props.onSelectAll).toHaveBeenCalled();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(props.onOpenAccount).toHaveBeenCalledOnce();
  });

  it("shows documents beneath their project and opens the selected document", () => {
    const onOpenDocument = vi.fn();
    renderSidebar({
      documents: [{ id: "run-doc", title: "Quarterly report.docx", documentType: "docx", workspaceId: "ws-a", status: "running" }],
      activeDocumentId: "run-doc",
      onOpenDocument,
    });
    const documentButton = screen.getByRole("button", { name: /Quarterly report\.docx/i });
    expect(documentButton).toHaveAttribute("data-active", "true");
    expect(documentButton.querySelector(".doc-type-icon.doc-type--docx")).toBeTruthy();
    expect(documentButton.querySelector(".project-sidebar__document-type")).toBeNull();
    fireEvent.click(documentButton);
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "run-doc", documentType: "docx" }));
    expect(screen.queryByText(/No chats|Legacy task history/i)).toBeNull();
  });

  it("folds same-titled rows behind a count instead of listing them all", () => {
    const onOpenDocument = vi.fn();
    renderSidebar({
      documents: [
        { id: "a", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "b", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "c", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "d", title: "Otter Life", documentType: "pptx", workspaceId: "ws-a" },
      ],
      onOpenDocument,
    });
    expect(screen.queryByRole("button", { name: /^Untitled task$/i })).toBeNull();
    const toggle = screen.getByRole("button", { name: "3 more documents named Untitled task" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("×3");
    fireEvent.click(toggle);
    expect(screen.getAllByRole("button", { name: /^Untitled task$/i })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: /^Untitled task$/i })[1]);
    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    // A differently named row is untouched by the fold.
    expect(screen.getByRole("button", { name: /Otter Life/i })).toBeInTheDocument();
  });

  it("names a row's status instead of leaving it to a coloured dot", () => {
    renderSidebar({
      documents: [{ id: "q", title: "Needs me", documentType: "pptx", workspaceId: "ws-a", status: "question" }],
    });
    const badge = screen.getByText("Awaiting Confirmation");
    expect(badge).toHaveAttribute("data-status", "question");
    expect(badge).toHaveAttribute("title", "Awaiting Confirmation");
    // A settled row carries no badge at all, so the list stays quiet.
    cleanup();
    renderSidebar({ documents: [{ id: "c", title: "Done", documentType: "pptx", workspaceId: "ws-a", status: "completed" }] });
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("labels status sections only when a workspace holds more than one kind", () => {
    const running = { id: "a", title: "Alpha", documentType: "pptx", workspaceId: "ws-a", status: "running" as const };
    const done = { id: "b", title: "Beta", documentType: "pptx", workspaceId: "ws-a", status: "completed" as const };
    renderSidebar({ documents: [running, done] });
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    // One kind of row needs no heading to explain it.
    cleanup();
    renderSidebar({ documents: [done] });
    expect(screen.queryByText("Recent")).toBeNull();
  });

  it("filters rows by name and says when nothing is left", () => {
    renderSidebar({
      documents: [
        { id: "a", title: "Otter Life", documentType: "pptx", workspaceId: "ws-a" },
        { id: "b", title: "Penguin Life", documentType: "pptx", workspaceId: "ws-a" },
      ],
    });
    const search = screen.getByRole("textbox", { name: "Search documents" });
    fireEvent.change(search, { target: { value: "penguin" } });
    expect(screen.queryByRole("button", { name: /Otter Life/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Penguin Life/i })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing matches this" } });
    expect(screen.getByText("No matching documents")).toBeInTheDocument();
  });

  it("keeps the document on screen out of the fold so it stays actionable", () => {
    renderSidebar({
      documents: [
        { id: "a", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "b", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "c", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
      ],
      activeDocumentId: "b",
    });
    const open = screen.getByRole("button", { name: /^Untitled task$/i });
    expect(open).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "2 more documents named Untitled task" })).toHaveTextContent("×2");
  });

  it("deletes a sidebar document after confirmation without implying the file is deleted", async () => {
    const onDeleteDocument = vi.fn(async () => undefined);
    renderSidebar({
      documents: [{ id: "run-doc", title: "Quarterly report.docx", documentType: "docx", workspaceId: "ws-a", status: "failed" }],
      onDeleteDocument,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete Quarterly report.docx" }));
    expect(await screen.findByText(/files on disk are not affected/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDeleteDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "run-doc" }));
  });

  it("opens a context menu from a sidebar row", async () => {
    renderSidebar({ documents: [{ id: "ctx", title: "Context task", documentType: "pptx", workspaceId: "ws-a" }] });
    fireEvent.contextMenu(screen.getByRole("button", { name: "Context task" }));
    expect(await screen.findByRole("menuitem", { name: "Open" })).toBeInTheDocument();
  });

  it("confirms before deleting every document in a folded group", async () => {
    const onDeleteDocuments = vi.fn(async () => undefined);
    renderSidebar({
      documents: [
        { id: "a", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "b", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
        { id: "c", title: "Untitled task", documentType: "pptx", workspaceId: "ws-a" },
      ],
      onDeleteDocuments,
    });
    fireEvent.contextMenu(screen.getByRole("button", { name: "3 more documents named Untitled task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete 3 tasks" }));
    expect(await screen.findByText(/Delete 3 tasks named/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete 3 tasks" }));
    expect(onDeleteDocuments).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" }), expect.objectContaining({ id: "c" })]));
  });

  it("labels every project action and leaves the rail toggle to Shell", () => {
    const props: React.ComponentProps<typeof ProjectSidebar> = {
      workspaces,
      activeWorkspaceId: "ws-a",
      onSelectAll: vi.fn(),
      onSelectWorkspace: vi.fn(),
      onAddWorkspace: vi.fn(),
      onRenameWorkspace: vi.fn(),
      onRevealWorkspace: vi.fn(),
      onRemoveWorkspace: vi.fn(),
        onOpenSettings: vi.fn(),
      onOpenAccount: vi.fn(),
    };
    const { container } = render(<LocaleProvider value="en"><ProjectSidebar {...props} /></LocaleProvider>);

    // The rail only ever renders expanded now — collapsing unmounts it, and
    // Shell owns the single control that hides it and brings it back, parked in
    // the band above the brand rather than inside the rail.
    expect(container.querySelector(".project-sidebar")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Client A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
    expect(container.querySelector(".project-sidebar__window-drag")).not.toBeNull();
  });
});

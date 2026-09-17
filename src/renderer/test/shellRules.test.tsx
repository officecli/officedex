/**
 * Contract tests for the Shell rules in docs/interaction-rules.md (group R-F).
 *
 * These live in their own file because interactionRules.test.tsx mocks Shell
 * away to get at App's orchestration; here Shell is the thing under test. It is
 * driven purely through props, which is the whole point — the sidebar's
 * behaviour is a function of `activeNav`, `editingDocument` and
 * `documentOpenRevision`, and that contract has to survive an IA change.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { WorkspaceSummary } from "../../shared/types";
import { Shell } from "../components/Shell";

vi.mock("../components/ProjectSidebar", () => ({
  ProjectSidebar: (props: { onOpenSettings: () => void }) => (
    <aside data-testid="project-sidebar">
      <button onClick={props.onOpenSettings}>sidebar-settings</button>
    </aside>
  ),
}));

vi.mock("../usePointerDotField", () => ({
  usePointerDotField: () => ({
    hostRef: { current: null },
    canvasRef: { current: null },
    movePointer: () => {},
    hidePointer: () => {},
  }),
}));

const SIDEBAR_COMPACT_KEY = "officedex.homeSidebarCompact";
const workspaces: WorkspaceSummary[] = [{ id: "ws-a", name: "Alpha", path: "/tmp/alpha", active: true }];

type ShellProps = ComponentProps<typeof Shell>;

function renderShell(overrides: Partial<ShellProps> = {}) {
  const props: ShellProps = {
    activeNav: "home",
    workspaces,
    activeWorkspaceId: "ws-a",
    onNavChange: () => {},
    onSelectWorkspace: () => {},
    onSelectAllFiles: () => {},
    onAddWorkspace: () => {},
    onRenameWorkspace: () => {},
    onRevealWorkspace: () => {},
    onRemoveWorkspace: () => {},
    children: <div data-testid="stage-content">content</div>,
    ...overrides,
  };
  const view = render(<Shell {...props} />);
  return {
    ...view,
    update: (next: Partial<ShellProps>) => view.rerender(<Shell {...props} {...next} />),
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("R-F · sidebar and frame", () => {
  // Entering an editor carries the Home navigation state across, rather than
  // opening on a collapsed frame; the revision — which changes only after a
  // file has actually opened — is what closes it.
  it("R-F-02 + R-F-04: entering an editor keeps the rail, a successful open collapses it", async () => {
    const { update } = renderShell({ activeNav: "home", editingDocument: false, documentOpenRevision: 0 });
    expect(screen.getByTestId("project-sidebar")).toBeInTheDocument();

    // Entering the editor inherits the expanded Home state.
    update({ activeNav: "home", editingDocument: true, documentOpenRevision: 0 });
    expect(screen.getByTestId("project-sidebar")).toBeInTheDocument();

    // Only the successful open closes it.
    update({ activeNav: "home", editingDocument: true, documentOpenRevision: 1 });

    await waitFor(() => expect(screen.queryByTestId("project-sidebar")).not.toBeInTheDocument());
  });

  // Mounting straight into an editor is the one case that opens collapsed:
  // there is no previous Home state to inherit.
  it("R-F-01: mounting already in editor mode starts collapsed", async () => {
    renderShell({ activeNav: "spreadsheet", editingDocument: false });

    expect(screen.queryByTestId("project-sidebar")).not.toBeInTheDocument();
  });

  // Returning to Home from an editor restores the file list, and persists that
  // choice — otherwise the app reopens collapsed on a surface that is nothing
  // but navigation.
  it("R-F-03: leaving the editor for Home re-expands the rail and persists it", async () => {
    const { update } = renderShell({ activeNav: "home", editingDocument: true, documentOpenRevision: 1 });
    await waitFor(() => expect(screen.queryByTestId("project-sidebar")).not.toBeInTheDocument());

    update({ activeNav: "home", editingDocument: false, documentOpenRevision: 1 });

    await waitFor(() => expect(screen.getByTestId("project-sidebar")).toBeInTheDocument());
    expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("0");
  });

  // The collapsed state the user chose on Home is remembered across restarts;
  // the one they choose inside an editor is not.
  it("R-F-01: only the non-editor collapse is persisted", async () => {
    const { update } = renderShell({ activeNav: "home", editingDocument: false });

    fireEvent.click(screen.getByRole("button", { name: /collapse|收起/i }));
    await waitFor(() => expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("1"));

    // Entering an editor and toggling there must not overwrite that record.
    update({ activeNav: "spreadsheet", editingDocument: false });
    await waitFor(() => expect(screen.queryByTestId("project-sidebar")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /expand|展开/i }));
    await waitFor(() => expect(screen.getByTestId("project-sidebar")).toBeInTheDocument());
    expect(window.localStorage.getItem(SIDEBAR_COMPACT_KEY)).toBe("1");
  });

  // The textured backdrop belongs to the two surfaces that are not a document.
  it("R-F-11: only home and settings get the pointer field", async () => {
    const { container, update } = renderShell({ activeNav: "home" });
    expect(container.querySelector(".home-shell__stage--textured")).not.toBeNull();

    update({ activeNav: "settings" });
    expect(container.querySelector(".home-shell__stage--textured")).not.toBeNull();

    update({ activeNav: "document" });
    expect(container.querySelector(".home-shell__stage--textured")).toBeNull();
  });

  // The spreadsheet workspace draws its own frame, so the host must not wrap it
  // in the stage box the other surfaces sit in.
  it("R-F-12: the spreadsheet surface is not wrapped in the stage", async () => {
    const { container, update } = renderShell({ activeNav: "home" });
    expect(container.querySelector(".home-shell__stage")?.contains(screen.getByTestId("stage-content"))).toBe(true);

    update({ activeNav: "spreadsheet" });

    expect(container.querySelector(".home-shell__stage")).toBeNull();
    expect(screen.getByTestId("stage-content")).toBeInTheDocument();
  });

  // With the rail gone the window's corner is nobody's but the toggle's, so the
  // rest of that strip goes back to dragging the window.
  it("R-F-10: a collapsed rail hands the corner back to the window", async () => {
    const { container } = renderShell({ activeNav: "home", editingDocument: false });
    expect(container.querySelector(".home-shell__drag")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /collapse|收起/i }));

    await waitFor(() => expect(container.querySelector(".home-shell__drag")).not.toBeNull());
  });
});

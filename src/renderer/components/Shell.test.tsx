import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { Shell } from "./Shell";

afterEach(() => {
  cleanup();
  // Shell persists the collapsed state, and jsdom keeps one localStorage for
  // the whole file — without this, a test that collapses starts the next one
  // collapsed.
  try { localStorage.clear(); } catch { /* not every environment has it */ }
});

function renderShell(activeNav: "home" | "document" | "spreadsheet" | "settings" = "document") {
  return render(
    <LocaleProvider value="en">
      <Shell
        activeNav={activeNav}
        workspaces={[]}
        activeWorkspaceId={undefined}
        onNavChange={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onSelectAllFiles={vi.fn()}
        onAddWorkspace={vi.fn()}
        onRenameWorkspace={vi.fn()}
        onRevealWorkspace={vi.fn()}
        onRemoveWorkspace={vi.fn()}
      >
        <div>Workspace content</div>
      </Shell>
    </LocaleProvider>,
  );
}

describe("Shell", () => {
  it.each(["home", "document", "settings"] as const)("uses ProjectSidebar for %s", (activeNav) => {
    renderShell(activeNav);
    expect(screen.getByRole("complementary", { name: /content sidebar/i })).toBeInTheDocument();
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new chat/i })).toBeNull();
    expect(screen.queryByText(/legacy task history/i)).toBeNull();
  });

  it.each([
    ["home", true],
    ["settings", true],
    ["document", false],
  ] as const)("marks the %s stage texture explicitly", (activeNav, textured) => {
    const { container } = renderShell(activeNav);
    const stage = container.querySelector(".home-shell__stage");

    expect(stage).not.toBeNull();
    expect(stage?.classList.contains("home-shell__stage--textured")).toBe(textured);
    expect(Boolean(container.querySelector(".home-shell__pointer-field"))).toBe(textured);
  });

  it("lets SpreadsheetWorkspace own the document topbar", () => {
    const { container } = renderShell("spreadsheet");
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
    expect(container.querySelector(".home-shell__stage")).toBeNull();
  });

  it.each(["home", "document", "spreadsheet", "settings"] as const)("renders no shell topbar for %s", (activeNav) => {
    const { container } = renderShell(activeNav);
    expect(container.querySelector(".home-shell__topbar")).toBeNull();
    expect(container.querySelector(".breadcrumb")).toBeNull();
  });

  it("peeks the rail open on hover and floats it over the content", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderShell("home");
      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".project-sidebar")).toBeNull();

      const expand = screen.getByRole("button", { name: "Expand sidebar" });
      act(() => { fireEvent.pointerEnter(expand); });

      // Peeked, not pinned: the rail is back but overlays the content rather
      // than taking a track, so a passing pointer never reflows the page.
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.querySelector(".home-shell--rail-peek")).not.toBeNull();
      expect(container.querySelector(".home-shell--railless")).not.toBeNull();

      act(() => { fireEvent.pointerLeave(expand); vi.advanceTimersByTime(400); });
      expect(container.querySelector(".project-sidebar")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the peeked rail when the corner control is clicked", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderShell("home");
      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      act(() => { vi.advanceTimersByTime(200); });

      const expand = screen.getByRole("button", { name: "Expand sidebar" });
      act(() => { fireEvent.pointerEnter(expand); });
      act(() => { fireEvent.click(expand); });

      // Pinned: it stops floating and takes a grid track again.
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.querySelector(".home-shell--rail-peek")).toBeNull();
      expect(container.querySelector(".home-shell--railless")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("plays the rail out before unmounting it, then hands over the corner control", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderShell("home");
      expect(container.querySelector(".project-sidebar")).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

      // An unmounted element cannot animate, so the rail outlives the click:
      // shut geometry now, removal once the transition has had its time.
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.querySelector(".home-shell--rail-shut")).not.toBeNull();

      act(() => { vi.advanceTimersByTime(200); });

      // The rail is gone, so the control that brings it back cannot live inside
      // it — on any platform, not only where window controls need dodging.
      expect(container.querySelector(".project-sidebar")).toBeNull();
      const expand = screen.getByRole("button", { name: "Expand sidebar" });
      expect(expand).toHaveClass("home-shell__expand");

      fireEvent.click(expand);
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

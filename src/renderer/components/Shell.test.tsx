import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

function shellUi(activeNav: "home" | "document" | "spreadsheet" | "settings" = "document", editingDocument = false, documentOpenRevision = 0) {
  return (
    <LocaleProvider value="en">
      <Shell
        activeNav={activeNav}
        editingDocument={editingDocument}
        documentOpenRevision={documentOpenRevision}
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
    </LocaleProvider>
  );
}

function renderShell(activeNav: "home" | "document" | "spreadsheet" | "settings" = "document", editingDocument = false) {
  return render(shellUi(activeNav, editingDocument));
}

/** Declaration blocks of every rule whose selector list names exactly `selector`. */
function cssRules(selector: string): string[] {
  // Comments go first: they sit between the previous rule and this one's
  // selector, and would otherwise be read as part of it.
  const css = readFileSync("src/renderer/styles/home.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((part) => part.trim() === selector))
    .map(([, , body]) => body);
}

describe("Shell", () => {
  it.each(["document", "spreadsheet"] as const)("closes the homepage sidebar after %s opens and restores it on return", (nav) => {
    vi.useFakeTimers();
    try {
    const { container, rerender } = render(shellUi("home", false, 0));
    expect(container.querySelector(".project-sidebar")).not.toBeNull();
    rerender(shellUi(nav, true, 0));
    expect(container.querySelector(".home-shell--railless")).toBeNull();
    // Opening succeeds asynchronously, after navigation has already changed.
    rerender(shellUi(nav, true, 1));
    expect(container.querySelector(".home-shell--rail-shut")).not.toBeNull();
    expect(container.querySelector(".project-sidebar")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector(".project-sidebar")).toBeNull();
    rerender(shellUi("home", false, 1));
    expect(container.querySelector(".project-sidebar")).not.toBeNull();
    expect(container.querySelector(".home-shell--rail-shut")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  // The generation step does not change the route: the deck is drawn into an
  // overlay that opens over New. It is still the document step, and the task
  // rail goes away with it — for pptx, docx and xlsx alike.
  it("hides the rail when a workbench overlay opens over New and restores it on close", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(shellUi("home", false, 0));
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      rerender(shellUi("home", true, 0));
      expect(container.querySelector(".home-shell--railless")).toBeNull();
      // The grant lands one commit after editor mode; the rail follows it out.
      rerender(shellUi("home", true, 1));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".project-sidebar")).toBeNull();
      // Closing the overlay puts the file list back on New.
      rerender(shellUi("home", false, 1));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.querySelector(".home-shell--rail-shut")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("cancels automatic collapse when returning home during the transition", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(shellUi("home", false, 0));
      rerender(shellUi("document", true, 1));
      expect(container.querySelector(".home-shell--rail-shut")).not.toBeNull();
      rerender(shellUi("home", false, 1));
      act(() => { vi.advanceTimersByTime(300); });
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      expect(container.querySelector(".home-shell--rail-shut")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each(["pinned", "peek"] as const)("closes %s navigation only after a successful document open", (mode) => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(shellUi("spreadsheet", true, 0));
      const toggle = screen.getByRole("button", { name: "Expand sidebar" });
      if (mode === "pinned") fireEvent.click(toggle);
      else fireEvent.pointerEnter(toggle);
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      // A pending/cancelled/failed open has no success revision.
      rerender(shellUi("spreadsheet", true, 0));
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
      rerender(shellUi("document", true, 1));
      act(() => { vi.advanceTimersByTime(200); });
      expect(container.querySelector(".project-sidebar")).toBeNull();
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeDefined();
    } finally { vi.useRealTimers(); }
  });

  it("starts document editing with the file navigation collapsed", () => {
    const { container } = renderShell("document", true);
    expect(container.querySelector(".home-shell")).toHaveClass("home-shell--railless");
    expect(screen.queryByRole("complementary", { name: /content sidebar/i })).toBeNull();
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
  });

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

  it.each(["home", "document", "settings"] as const)("drags the window from the %s stage's top strip", (activeNav) => {
    const { container } = renderShell(activeNav);
    const band = container.querySelector(".home-shell__stage > .home-shell__stage-drag");

    expect(band).not.toBeNull();
    // The rail's own band covers the traffic lights; this one covers the rest
    // of the window's top edge, which otherwise drags nothing.
    const css = readFileSync("src/renderer/styles/home.css", "utf8");
    expect(css).toMatch(
      /\.home-shell__stage > \.home-shell__stage-drag \{[^}]*position:\s*absolute[^}]*height:\s*var\(--od-window-chrome-inset[^}]*--wails-draggable:\s*drag/s,
    );
  });

  it("centres the rail toggle on the traffic lights, not on a guessed axis", () => {
    const css = readFileSync("src/renderer/styles/home.css", "utf8");

    // AppKit parks the three 14x14 buttons at y 9..23 with the title bar
    // hidden, so their axis is 16px down. 14px (half of a 28px title bar) puts
    // the control two pixels high, which is visible right next to the lights.
    expect(css).toMatch(/:root\s*\{[^}]*--od-window-controls-center:\s*16px/s);
    // 14px is half the control's own 28px box, so this reads "centre on the axis".
    expect(css).toMatch(
      /\.home-shell__rail-toggle\s*\{[^}]*top:\s*calc\(var\(--od-window-controls-center\) - 14px\)[^}]*height:\s*28px/s,
    );
  });

  it("keeps one rail toggle in the band, in both directions", () => {
    const { container } = renderShell("home");

    // Docked: the rail carries no control of its own, the band above it does.
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(collapse).toHaveClass("home-shell__rail-toggle");
    expect(collapse.closest(".project-sidebar")).toBeNull();
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelectorAll(".home-shell__rail-toggle")).toHaveLength(1);
  });

  it("makes every window-drag region unselectable", () => {
    // A press that drags the window is still a press that starts a text
    // selection, so without this the whole page flashes blue for the length of
    // the drag. Checked over every stylesheet so a new drag region cannot
    // reintroduce it.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory()
        ? walk(join(dir, entry.name))
        : entry.name.endsWith(".css") ? [join(dir, entry.name)] : []));

    const offenders: string[] = [];
    for (const file of walk("src/renderer")) {
      const css = readFileSync(file, "utf8");
      for (const [block] of css.matchAll(/\{[^{}]*\}/g)) {
        if (!/--wails-draggable:\s*drag/.test(block)) continue;
        if (!/user-select:\s*none/.test(block)) offenders.push(`${file}: ${block.slice(0, 60)}…`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("lets SpreadsheetWorkspace own the document topbar", () => {
    const { container } = renderShell("spreadsheet");
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
    expect(container.querySelector(".home-shell__stage")).toBeNull();
    // The spreadsheet topbar is its own drag region, so no band is layered over it.
    expect(container.querySelector(".home-shell__stage-drag")).toBeNull();
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
      // Same control, same spot in the band — only its direction changed.
      expect(expand).toHaveClass("home-shell__rail-toggle");
      expect(expand).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(expand);
      expect(container.querySelector(".project-sidebar")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the corner reserve for the whole slide, in both directions", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderShell("home");
      const shell = container.querySelector(".home-shell");

      // Docked and settled: the rail owns the corner, so the content has
      // nothing to dodge and the reserve must not be published.
      expect(shell?.classList.contains("home-shell--rail-moving")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

      // Sliding out: the main column is mid-resize, and its left edge is on its
      // way to the window's edge — where the expand button already is. The
      // reserve has to be up before the content arrives, not after.
      expect(shell?.classList.contains("home-shell--rail-moving")).toBe(true);
      expect(shell?.classList.contains("home-shell--rail-shut")).toBe(true);

      act(() => { vi.advanceTimersByTime(200); });

      // Settled collapsed: still reserved, because the expand button is the
      // thing now sitting in that corner.
      expect(shell?.classList.contains("home-shell--rail-moving")).toBe(false);
      expect(shell?.classList.contains("home-shell--railless")).toBe(true);

      // And the same on the way back in: the reserve may not drop while the
      // content is still at the window's edge.
      fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      expect(shell?.classList.contains("home-shell--rail-moving")).toBe(true);

      act(() => { vi.advanceTimersByTime(200); });
      expect(shell?.classList.contains("home-shell--rail-moving")).toBe(false);
      expect(shell?.classList.contains("home-shell--railless")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes that reserve in every state where the corner is not the rail's", () => {
    // The three states a workbench can be sitting under while the rail is not
    // docked and still: collapsed, sliding out, sliding back in.
    for (const state of ["home-shell--railless", "home-shell--rail-shut", "home-shell--rail-moving"]) {
      const bodies = cssRules(`.${state}`);
      expect(
        bodies.some((body) => /--od-topleft-reserve:\s*calc\(var\(--od-window-chrome-inset-x\) \+ 44px\)/.test(body)),
        `${state} must publish --od-topleft-reserve`,
      ).toBe(true);
    }
  });

  it("keeps the peeked rail above the preview overlay, and the toggle above the rail", () => {
    const peekedZ = Number(/z-index:\s*(\d+)/.exec(cssRules(".home-shell--rail-peek .project-sidebar").join(" "))?.[1]);
    const toggleZ = Number(/z-index:\s*(\d+)/.exec(cssRules(".home-shell__rail-toggle").join(" "))?.[1]);

    // .preview-panel is 100. A peek underneath it is a control that looks
    // broken: hovering the corner toggle with a document open shows nothing.
    expect(peekedZ).toBeGreaterThan(100);
    // The toggle sits in the rail's own band, so it has to outrank the rail it
    // reveals — otherwise the thing you are hovering swallows it.
    expect(toggleZ).toBeGreaterThan(peekedZ);
    // Both stay under the modal tier, so an open dialog still blocks them.
    expect(toggleZ).toBeLessThan(1000);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { Shell } from "./Shell";

afterEach(cleanup);

function renderShell(activeNav: "home" | "document" | "spreadsheet" | "settings" = "document") {
  return render(
    <LocaleProvider value="en">
      <Shell
        activeNav={activeNav}
        workspaces={[]}
        activeWorkspaceId={undefined}
        activeWorkspaceName={undefined}
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
    expect(screen.queryByText("All content")).toBeNull();
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
    expect(container.querySelector(".home-shell__stage")).toBeNull();
  });

  it("toggles the sidebar from expanded to compact and back", () => {
    const { container } = renderShell("home");
    const sidebar = container.querySelector(".project-sidebar");
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });

    expect(sidebar).toHaveAttribute("data-compact", "false");
    fireEvent.click(toggle);
    expect(sidebar).toHaveAttribute("data-compact", "true");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar).toHaveAttribute("data-compact", "false");
  });
});

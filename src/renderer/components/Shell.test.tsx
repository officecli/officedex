import { cleanup, render, screen } from "@testing-library/react";
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

  it("lets SpreadsheetWorkspace own the document topbar", () => {
    renderShell("spreadsheet");
    expect(screen.queryByText("All content")).toBeNull();
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
  });
});

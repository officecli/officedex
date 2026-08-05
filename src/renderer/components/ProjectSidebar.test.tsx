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
  conversations: [],
}];

afterEach(() => {
  dialog.destroy();
  cleanup();
});

function renderSidebar() {
  const props: React.ComponentProps<typeof ProjectSidebar> = {
    workspaces,
    activeWorkspaceId: "ws-a",
    onSelectAll: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onAddWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(async () => undefined),
    onRevealWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
  };
  render(<LocaleProvider value="en"><ProjectSidebar {...props} /></LocaleProvider>);
  return props;
}

describe("ProjectSidebar", () => {
  it("keeps the OfficeDex icon and supports all-file/project selection", () => {
    const props = renderSidebar();
    expect(screen.getByRole("img", { name: "OfficeDex" })).toHaveAttribute("src", "./officedex-logo.png");
    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    fireEvent.click(screen.getByRole("button", { name: "Client A" }));
    expect(props.onSelectAll).toHaveBeenCalledOnce();
    expect(props.onSelectWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("creates, renames, reveals, and removes a project without deleting disk files", async () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Client A" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: "Renamed project" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAddWorkspace).toHaveBeenCalledOnce();
    expect(props.onRenameWorkspace).toHaveBeenCalledWith("ws-a", "Renamed project");

    fireEvent.click(screen.getByRole("button", { name: "Reveal Client A" }));
    expect(props.onRevealWorkspace).toHaveBeenCalledWith("/tmp/client-a");
    fireEvent.click(screen.getByRole("button", { name: "Remove Client A" }));
    expect(await screen.findByText(/files stay on disk/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(props.onRemoveWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("keeps task history, settings, and account keyboard-accessible", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Task history" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(props.onOpenTasks).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(props.onOpenAccount).toHaveBeenCalledOnce();
  });
});

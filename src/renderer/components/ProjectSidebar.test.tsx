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
  it("keeps the OfficeDex icon and supports all-content selection", () => {
    const props = renderSidebar();
    expect(screen.getByRole("img", { name: "OfficeDex" })).toHaveAttribute("src", "./officedex-logo.png");
    fireEvent.click(screen.getByRole("button", { name: "All content" }));
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

  it("shows an attention badge on tasks and an empty-state hint without workspaces", () => {
    const props = renderSidebar({ workspaces: [], signal: { kind: "attention", count: 2 } });
    expect(screen.getByLabelText("2 tasks need your attention")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: /Folders you work in become workspaces/ }));
    expect(props.onAddWorkspace).toHaveBeenCalledOnce();
  });

  it("shows running and failed as dots, without a count the user cannot act on", () => {
    cleanup();
    renderSidebar({ workspaces: [], signal: { kind: "running", count: 3 } });
    const running = screen.getByLabelText("3 tasks running");
    expect(running).toHaveTextContent("");
    expect(running.className).toContain("project-sidebar__badge--running");

    cleanup();
    renderSidebar({ workspaces: [], signal: { kind: "failed", count: 2 } });
    expect(screen.getByLabelText("2 tasks failed").className).toContain("project-sidebar__badge--failed");
  });

  it("shows credit and the signed-in account in the footer", () => {
    renderSidebar({
      credit: { displayMode: "quota", used: 3, total: 10, planLabel: "Credits" },
      account: { mode: "logged_in", email: "luyang@example.com" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Credits");
    expect(screen.getByRole("status")).toHaveTextContent("7 / 10");
    expect(screen.getByRole("button", { name: "luyang@example.com" })).toBeTruthy();
  });

  it("keeps task history, settings, and account keyboard-accessible", () => {
    const props = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /All content/ }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(props.onSelectAll).toHaveBeenCalled();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(props.onOpenAccount).toHaveBeenCalledOnce();
  });

  it("supports compact project navigation while keeping every action labelled", () => {
    const onCompactChange = vi.fn();
    const props: React.ComponentProps<typeof ProjectSidebar> = {
      workspaces,
      activeWorkspaceId: "ws-a",
      compact: true,
      onCompactChange,
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

    expect(container.querySelector(".project-sidebar")).toHaveAttribute("data-compact", "true");
    expect(screen.getByRole("button", { name: "Client A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand project sidebar" }));
    expect(onCompactChange).toHaveBeenCalledWith(false);
  });
});

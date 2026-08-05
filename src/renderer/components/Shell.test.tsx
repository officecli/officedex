import { createElement } from "react";
import type { ComponentType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { Shell } from "./Shell";

vi.mock("../bridge", () => ({
  officecli: new Proxy({} as DesktopAPI, {
    get(_target, prop) {
      if (prop === "getBridgeRuntimeSnapshot") {
        return vi.fn(async () => null);
      }
      if (prop === "onBridgeEvent") {
        return vi.fn(() => () => undefined);
      }
      return vi.fn();
    },
  }),
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Shell sidebar layout", () => {
  it("uses the project-shell family for spreadsheet mode without adding a second topbar", () => {
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "spreadsheet",
            failed: false,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onSelectAllFiles: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRenameWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div data-testid="spreadsheet-workspace" />,
        )}
      </LocaleProvider>,
    );

    expect(document.querySelector(".home-shell--spreadsheet")).toBeInTheDocument();
    expect(document.querySelector(".project-sidebar")).toHaveAttribute("data-compact", "true");
    expect(document.querySelector(".home-shell__topbar")).toBeNull();
    expect(screen.getByTestId("spreadsheet-workspace")).toBeInTheDocument();
  });
  it("returns to Home from the dialogue sidebar brand", () => {
    const onNavChange = vi.fn();
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "dialogue",
            failed: false,
            tasks: [],
            workspaces: [],
            chats: [],
            onNavChange,
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onNavChange).toHaveBeenCalledWith("home");
  });

  it("uses the OfficeDex PNG app icon for the sidebar brand mark", () => {
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "tasks",
            failed: false,
            tasks: [],
            selectedTaskId: undefined,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    expect(screen.getByAltText("OfficeDex logo").getAttribute("src")).toBe("./officedex-logo.png");
  });

  it("clips the opaque sidebar logo asset to rounded corners", () => {
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");
    const brandMarkRule = css.match(/\.brand-mark\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(brandMarkRule).toMatch(/border-radius:\s*8px;/);
    expect(brandMarkRule).toMatch(/overflow:\s*hidden;/);
  });

  it("places the credit meter above Profile in the sidebar footer", () => {
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "tasks",
            failed: false,
            tasks: [],
            selectedTaskId: undefined,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            credit: { displayMode: "balance", used: 0, total: 42, planLabel: "Credits" },
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    const meter = screen.getByRole("group", { name: /credit balance/i });
    const profile = screen.getByRole("button", { name: /profile/i });

    expect(meter.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps sidebar footer navigation controls vertically centered", () => {
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");
    const settingsRule = css.match(/\.sidebar-settings\s*\{[^}]*\}/s)?.[0] ?? "";

    expect(css).toContain("grid-template-columns: 28px minmax(0, 1fr)");
    expect(css).toMatch(/\.nav-item > svg\s*\{[^}]*place-items:\s*center;/s);
    expect(css).toMatch(/\.nav-item > span\s*\{[^}]*line-height:\s*20px;/s);
    expect(settingsRule).not.toContain("border-top");
    expect(settingsRule).not.toContain("padding-top");
    expect(css).toMatch(/\.sidebar-settings::after\s*\{[^}]*background:\s*var\(--n-hairline-soft\);/s);
  });

  it("uses the topbar as the only sidebar control and reveals the hidden sidebar from the left edge", async () => {
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "tasks",
            failed: false,
            tasks: [],
            selectedTaskId: undefined,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );
    const css = readFileSync("src/renderer/styles/shell.css", "utf8");
    const shell = document.querySelector(".app-shell");
    const toggle = screen.getByRole("button", { name: /collapse sidebar/i });

    expect(document.querySelector(".sidebar-divider-toggle")).toBeNull();
    expect(toggle.closest(".topbar-sidebar-slot")).toBeTruthy();
    expect(toggle.getAttribute("data-sidebar-icon-state")).toBe("expanded");

    fireEvent.mouseEnter(toggle);
    await screen.findByText("Collapse sidebar");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.querySelector(".ui-tooltip")).toBeNull();
    });

    expect(shell?.classList.contains("sidebar-collapsed")).toBe(true);
    const expandToggle = screen.getByRole("button", { name: /expand sidebar/i });
    expect(expandToggle.getAttribute("data-sidebar-icon-state")).toBe("hidden");
    expect(expandToggle.querySelector(".sidebar-toggle-dot")).toBeTruthy();
    const hoverZone = document.querySelector(".sidebar-hover-zone");
    expect(hoverZone).toBeTruthy();
    fireEvent.mouseEnter(hoverZone!);

    expect(expandToggle.getAttribute("data-sidebar-icon-state")).toBe("preview");
    fireEvent.mouseEnter(expandToggle);
    await screen.findByText("Expand sidebar");
    fireEvent.click(expandToggle);
    await waitFor(() => {
      expect(document.querySelector(".ui-tooltip")).toBeNull();
    });
    expect(css).toMatch(/\.sidebar-collapsed\s*\.sidebar-hover-zone:hover\s*\+\s*\.sidebar/s);
    expect(css).toMatch(/\.sidebar-collapsed\s*\.sidebar:hover/s);
    expect(css).toMatch(/\.sidebar-collapsed\.sidebar-preview\s*\.sidebar/s);
    expect(css).toMatch(/\.topbar\s*\{[^}]*z-index:\s*40;/s);
    expect(css).toMatch(/\.app-shell\.sidebar-collapsed,[\s\S]*grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/);
  });

  it("collapses the sidebar once when a PPT canvas task becomes active", async () => {
    const { rerender } = render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "dialogue",
            failed: false,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            autoCollapseSidebarKey: "task-vibe",
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    await screen.findByRole("button", { name: /expand sidebar/i });
    const shell = document.querySelector(".app-shell");
    expect(shell?.classList.contains("sidebar-collapsed")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /expand sidebar/i }));
    expect(shell?.classList.contains("sidebar-collapsed")).toBe(false);

    rerender(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "dialogue",
            failed: false,
            workspaces: [],
            chats: [],
            activeWorkspaceId: undefined,
            activeWorkspaceName: undefined,
            selectedConversationId: undefined,
            autoCollapseSidebarKey: "task-vibe",
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectWorkspace: vi.fn(),
            onAddWorkspace: vi.fn(),
            onRevealWorkspace: vi.fn(),
            onRemoveWorkspace: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    expect(shell?.classList.contains("sidebar-collapsed")).toBe(false);
  });
});

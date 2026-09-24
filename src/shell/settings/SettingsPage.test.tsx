import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentRun, CreditStatus, DesktopAPI, UserSettings, WhoAmIResult } from "../../shared/types";
import { LocaleProvider } from "../../renderer/i18n";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import { ToastHost } from "../../renderer/ui";
import { createFakePort } from "../port/fake/createFakePort";
import { PortProvider } from "../port/PortContext";
import { ShellProvider } from "../state/ShellContext";
import { renderShell } from "../test/renderShell";
import { SettingsPage } from "./SettingsPage";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(cleanup);

const SETTINGS: UserSettings = {
  version: 1,
  defaults: { documentType: "pptx", enableImages: true, enableWebSearch: false, imageQuality: "premium" },
  workspaceDir: null,
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
  proxy: null,
  imageWatermark: { showWatermark: true, preferenceSource: "system" },
  waiting2048Enabled: false,
};

const UPDATE_STATUS = {
  currentVersion: "9.9.9",
  latestVersion: null,
  updateAvailable: false,
  mandatory: false,
  downloading: false,
  downloadedPath: null,
  lastCheckedAt: null,
  lastError: null,
};

/**
 * A desktop API that is only what the settings page reaches for.
 *
 * Injected through `DesktopApiProvider` rather than patched onto the module
 * singleton, for the same reason `AccountPage.test.tsx` does it: the page
 * reaches the transport through `useDesktopApi`, so a test that spied on the
 * global would still pass if the page forgot the context.
 *
 * Every method the page can call is present. The connection cards call
 * `api.getJiraConnection()` **outside** a try/catch (the promise is what they
 * catch), so a missing method there is a synchronous `TypeError` rather than a
 * rejected read — the same shape the real bridge would fail in.
 */
function makeApi(overrides: Partial<DesktopAPI> = {}) {
  let settings: UserSettings = {
    ...SETTINGS,
    defaults: { ...SETTINGS.defaults },
    imageWatermark: { ...SETTINGS.imageWatermark },
  };
  const patches: Array<Partial<UserSettings>> = [];
  const spies = {
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (patch: Partial<UserSettings>) => {
      patches.push(patch);
      settings = { ...settings, ...patch };
      return settings;
    }),
    getDefaultWorkspaceDir: vi.fn(async () => "/tmp/officedex"),
    whoami: vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "anonymous" })),
    getCreditStatus: vi.fn(async () => ({ paidEntitlement: false }) as unknown as CreditStatus),
    getInviteInfo: vi.fn(async () => ({ invite_code: "INVITE-1" })),
    getAppVersion: vi.fn(async () => "9.9.9"),
    getReportCapability: vi.fn(async () => ({ enabled: false, reason: "test" })),
    listAgentRuns: vi.fn(async (): Promise<AgentRun[]> => []),
    getBridgeRuntimeSnapshot: vi.fn(async () => ({})),
    exportLogs: vi.fn(async () => ({ path: "/tmp/logs.zip" })),
    testProvider: vi.fn(async () => ({ ok: true, httpStatus: 200, latencyMs: 12, url: "https://example.com" })),
    sendDesktopNotification: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    onAppUpdateEvent: vi.fn(() => () => {}),
    checkAppUpdate: vi.fn(async () => ({ status: UPDATE_STATUS, release: null })),
    getJiraConnection: vi.fn(async () => ({ configured: false, baseUrl: "", authType: "" as const })),
    getLiquipediaConnection: vi.fn(async () => ({
      configured: false,
      baseUrl: "https://liquipedia.net/dota2",
    })),
    redeem: vi.fn(async () => ({ code: "PROMO2026", credit_amount: 100, new_balance: 100 })),
    ...overrides,
  };
  return { api: spies as unknown as DesktopAPI, spies, patches };
}

function renderPage(api: DesktopAPI, options: { onClose?: () => void; onOpenLogin?: () => void } = {}) {
  const onClose = options.onClose ?? vi.fn();
  const onOpenLogin = options.onOpenLogin ?? vi.fn();
  render(
    // `value` pins the language: `detectLocale()` reads the environment, and a
    // suite that asserted English copy would be asserting the CI machine's.
    <LocaleProvider value="en">
      <DesktopApiProvider api={api}>
        {/*
          The port and shell providers are not ceremony: two of the nine
          sections are the shell's own rather than the legacy page's.
          Appearance's Reduced motion and Enter sends come off the port's
          settings store, and Activity reads the port's run list — so a harness
          without them fails the way a missing provider should.
        */}
        <PortProvider port={createFakePort()}>
          <ShellProvider>
            <SettingsPage onClose={onClose} onOpenLogin={onOpenLogin} />
            <ToastHost />
          </ShellProvider>
        </PortProvider>
      </DesktopApiProvider>
    </LocaleProvider>,
  );
  return { onClose, onOpenLogin };
}

/** Opens one section through the nav, as a user does. */
async function openSection(label: string) {
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  fireEvent.click(within(nav).getByRole("button", { name: label }));
  return screen.findByRole("heading", { name: label });
}

describe("SettingsPage", () => {
  it("opens from the sidebar's gear, and the shell stays mounted underneath", async () => {
    const shell = await renderShell();
    expect(shell.view.queryByRole("dialog", { name: "App Settings" })).toBeNull();

    // The gear, by the accessible name `chrome/Sidebar.tsx` gives it. It used to
    // open a three-row menu; it opens this page now.
    fireEvent.click(shell.view.getByTitle("Settings"));
    const page = await shell.view.findByRole("dialog", { name: "App Settings" });
    expect(page).toBeInTheDocument();
    expect(shell.view.queryByRole("menu")).toBeNull();

    // The frame is covered, not torn down: this is decision 4 in App.tsx, and a
    // settings page that unmounted the workspace would be the one screen that
    // breaks it.
    expect(shell.view.container.querySelector('#shell[data-loaded="true"]')).not.toBeNull();
    expect(shell.view.container.querySelector("#shell-sidebar")).not.toBeNull();
    expect(shell.view.container.querySelector(".shell-sidebar-footer")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(shell.view.queryByRole("dialog", { name: "App Settings" })).toBeNull(),
    );
  });

  it("keeps the legacy page's nine sections, in the legacy order", async () => {
    renderPage(makeApi().api);
    await screen.findByRole("heading", { name: "App Settings" });

    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Generation",
      "Notification",
      "Appearance",
      "Connection",
      "Subscription",
      "Activity",
      "Advanced & Support",
      "Reset",
      "About",
    ]);
  });

  it("writes a generation default and says it saved", async () => {
    const { api, patches } = makeApi();
    renderPage(api);
    await openSection("Generation");

    fireEvent.click(await screen.findByRole("switch", { name: "Enable Images" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ defaults: { ...SETTINGS.defaults, enableImages: false } });

    fireEvent.click(screen.getByRole("switch", { name: "Web Search" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ defaults: { ...SETTINGS.defaults, enableImages: false, enableWebSearch: true } });

    // Both halves of the save state: the toast (the shell's only confirmation
    // channel) and the pill in the header.
    expect(await screen.findByText("Settings saved and applied")).toBeInTheDocument();
    expect(screen.getByText("Auto-saved")).toBeInTheDocument();
  });

  it("carries the two preferences the sidebar menu used to hold, under Appearance", async () => {
    const { api } = makeApi();
    renderPage(api);
    await openSection("Appearance");

    // Same words they had in the menu; the switch is what makes the state
    // readable now, instead of the label spelling it out.
    expect(await screen.findByRole("switch", { name: "Reduced motion" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enter sends" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
  });

  it("renders the Jira connector with the legacy help text", async () => {
    const { api, spies } = makeApi();
    renderPage(api);
    await openSection("Connection");

    await waitFor(() => expect(spies.getJiraConnection).toHaveBeenCalled());

    expect(screen.getByRole("group", { name: "Jira Connector" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Liquipedia Connector" })).toBeNull();
    expect(screen.getByText("How to create a Jira PAT")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Jira Connector" })).getByRole("button", {
        name: "Test and save",
      }),
    ).toBeInTheDocument();
  });

  it("offers the redeem code, and hides the invite row when nobody is signed in", async () => {
    renderPage(makeApi().api);
    await openSection("Subscription");

    expect(await screen.findByRole("button", { name: "Redeem" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Redeem code" })).toBeInTheDocument();
    // `whoami` is the authority on this row, exactly as it was in legacy.
    expect(screen.queryByText("My invite code")).toBeNull();
  });

  it("shows the invite code to a signed-in account", async () => {
    const { api } = makeApi({
      whoami: vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "logged_in", email: "a@b.c" })),
    });
    renderPage(api);
    await openSection("Subscription");

    expect(await screen.findByText("INVITE-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invite code" })).toBeInTheDocument();
  });

  it("lists the shell's runs as the activity section, with an empty state", async () => {
    renderPage(makeApi().api);
    await openSection("Activity");

    expect(await screen.findByText("Nothing has run yet.")).toBeInTheDocument();
  });

  it("keeps the watermark switch behind the paid entitlement", async () => {
    const { api } = makeApi();
    renderPage(api);
    await openSection("Advanced & Support");

    const watermark = await screen.findByRole("switch", { name: "Show watermark" });
    // A free account reads `true` and cannot change it, and the row says which
    // of the two it is rather than leaving a dead control unexplained.
    expect(watermark).toBeChecked();
    expect(watermark).toBeDisabled();
    expect(screen.getByText("Free images include the OfficeDex watermark.")).toBeInTheDocument();
  });

  it("confirms before resetting everything, then sends the legacy patch", async () => {
    const { api, patches } = makeApi();
    renderPage(api);
    await openSection("Reset");

    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));

    /*
     * The confirmation is the shared `Modal.confirm`, which renders into the
     * dialog host rather than into this tree — and its `role="dialog"` cannot be
     * told from the settings page's own by role alone, so the title is the
     * handle and the panel is found from it.
     */
    const title = await screen.findByText("Reset all settings to defaults?");
    expect(patches).toHaveLength(0);
    const dialog = title.closest(".od-dialog");
    expect(dialog).not.toBeNull();

    fireEvent.click(within(dialog as HTMLElement).getByRole("button", { name: "Reset everything" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      defaults: { documentType: "pptx", enableImages: true, enableWebSearch: false, imageQuality: "premium" },
      workspaceDir: null,
      outputDir: null,
      llmProvider: null,
      onboardingCompletedAt: null,
      imageWatermark: { showWatermark: true, preferenceSource: "system" },
    });
  });

  it("does not close the page for an Escape an overlay has already taken", async () => {
    const { api } = makeApi();
    renderPage(api);
    await openSection("Reset");
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await screen.findByText("Reset all settings to defaults?");

    /*
     * Dispatched on `document`, which is the real propagation path: the page
     * listens in the capture phase on `window` (so it decides before the
     * overlay's own bubble listener on `document` runs), and a `window`-target
     * event would not reach that listener at all.
     *
     * The bug this guards was measured in a browser: React flushes a discrete
     * `keydown` synchronously, so a bubble listener here saw the mask already
     * gone and closed the page with it — one Escape dismissing both.
     */
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("Reset all settings to defaults?")).toBeNull(),
    );
    expect(screen.getByRole("heading", { name: "Reset" })).toBeInTheDocument();

    // With no overlay left, the same key closes the page.
    const onClose = vi.fn();
    cleanup();
    renderPage(api, { onClose });
    await screen.findByRole("heading", { name: "App Settings" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the version and can check for an update, which the shell never could", async () => {
    const { api, spies } = makeApi();
    renderPage(api);
    await openSection("About");

    expect(await screen.findByText("OfficeDex 9.9.9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => expect(spies.checkAppUpdate).toHaveBeenCalled());
    expect(await screen.findByText("You're on the latest version")).toBeInTheDocument();
  });
});

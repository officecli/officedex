import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal, toast as uiToast } from "../ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditStatus, DesktopAPI, UserSettings, WhoAmIResult } from "../../shared/types";
import { officecli } from "../bridge";
import { NOTIFICATIONS_STORAGE_KEY, readNotificationsEnabled } from "../notifications";

const DEFAULT_PROXY = { enabled: false, url: "http://127.0.0.1:7890" };

let currentSettings: UserSettings;

function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

function installDomStubs() {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () =>
      ({
        getPropertyValue: () => "",
      }) as unknown as CSSStyleDeclaration,
  );
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:test-json");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    version: 1,
    defaults: {
      documentType: "pptx",
      enableImages: true,
      imageQuality: "premium",
      ...(overrides.defaults ?? {}),
    },
    workspaceDir: overrides.workspaceDir ?? null,
    outputDir: overrides.outputDir ?? null,
    llmProvider: overrides.llmProvider ?? null,
    onboardingCompletedAt: overrides.onboardingCompletedAt ?? "2026-05-22T00:00:00Z",
    proxy: overrides.proxy ?? DEFAULT_PROXY,
    imageWatermark: overrides.imageWatermark ?? { showWatermark: true, preferenceSource: "system" },
  };
}

async function selectSettingsSection(label: string) {
  const menu = await screen.findByRole("navigation", { name: "Settings sections" });
  fireEvent.click(within(menu).getByRole("button", { name: label }));
}

let getSettingsSpy: ReturnType<typeof vi.fn>;
let updateSettingsSpy: ReturnType<typeof vi.fn>;
let getDefaultWorkspaceDirSpy: ReturnType<typeof vi.fn>;
let openDirectoryDialogSpy: ReturnType<typeof vi.fn>;
let testProviderSpy: ReturnType<typeof vi.fn>;
let sendDesktopNotificationSpy: ReturnType<typeof vi.fn>;
let whoamiSpy: ReturnType<typeof vi.fn>;
let getCreditStatusSpy: ReturnType<typeof vi.fn>;
let getInviteInfoSpy: ReturnType<typeof vi.fn>;
let originals: Partial<DesktopAPI>;

async function cleanupUiPortals() {
  Modal.destroyAll();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
}

beforeEach(() => {
  vi.spyOn(uiToast, "success").mockImplementation(() => "test-toast");
  vi.spyOn(uiToast, "error").mockImplementation(() => "test-toast");
  vi.spyOn(uiToast, "warning").mockImplementation(() => "test-toast");
  vi.stubGlobal("localStorage", createMemoryStorage());
  installDomStubs();
  localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
  currentSettings = makeSettings();
  getSettingsSpy = vi.fn(async () => currentSettings);
  updateSettingsSpy = vi.fn(async (patch: Partial<UserSettings>) => {
    currentSettings = {
      ...currentSettings,
      ...patch,
      defaults: { ...currentSettings.defaults, ...(patch.defaults ?? {}) },
    };
    return currentSettings;
  });
  getDefaultWorkspaceDirSpy = vi.fn(async () => "/tmp/default-workspace");
  openDirectoryDialogSpy = vi.fn(async () => null);
  testProviderSpy = vi.fn(async () => ({ ok: true, httpStatus: 200, latencyMs: 10, url: "official" }));
  sendDesktopNotificationSpy = vi.fn(async () => undefined);
  whoamiSpy = vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "logged_in", userId: "user-settings" }));
  getCreditStatusSpy = vi.fn(async (): Promise<CreditStatus> => ({
    mode: "logged_in",
    accessMode: "hosted",
    planName: "Pro",
    paidEntitlement: true,
    hostedCreditBalance: 100,
    anonymousCreditAvailable: null,
    anonymousCreditReserved: null,
    anonymousCreditBalance: null,
    rewardRemaining: 0,
    paidKeyPrefix: "",
    paidKeyTotal: 0,
    paidKeyUsed: 0,
    paidKeyRemaining: 0,
    raw: "",
  }));
  getInviteInfoSpy = vi.fn(async () => ({ invite_code: "invite-user" }));
  originals = {
    getSettings: officecli.getSettings,
    updateSettings: officecli.updateSettings,
    getDefaultWorkspaceDir: officecli.getDefaultWorkspaceDir,
    openDirectoryDialog: officecli.openDirectoryDialog,
    testProvider: officecli.testProvider,
    sendDesktopNotification: officecli.sendDesktopNotification,
    whoami: officecli.whoami,
    getCreditStatus: officecli.getCreditStatus,
    getInviteInfo: officecli.getInviteInfo,
  };
  officecli.getSettings = getSettingsSpy as unknown as DesktopAPI["getSettings"];
  officecli.updateSettings = updateSettingsSpy as unknown as DesktopAPI["updateSettings"];
  officecli.getDefaultWorkspaceDir = getDefaultWorkspaceDirSpy as unknown as DesktopAPI["getDefaultWorkspaceDir"];
  officecli.openDirectoryDialog = openDirectoryDialogSpy as unknown as DesktopAPI["openDirectoryDialog"];
  officecli.testProvider = testProviderSpy as unknown as DesktopAPI["testProvider"];
  officecli.sendDesktopNotification = sendDesktopNotificationSpy as unknown as DesktopAPI["sendDesktopNotification"];
  officecli.whoami = whoamiSpy as unknown as DesktopAPI["whoami"];
  officecli.getCreditStatus = getCreditStatusSpy as unknown as DesktopAPI["getCreditStatus"];
  officecli.getInviteInfo = getInviteInfoSpy as unknown as DesktopAPI["getInviteInfo"];
});

afterEach(async () => {
  await cleanupUiPortals();
  Object.assign(officecli, originals);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SettingsScreen", () => {
  it("loads settings on mount and shows current generation defaults", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /^generation$/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Workspace" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Connection" })).toBeNull();
  });

  it("renders a secondary menu inside Settings and switches the content section", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    const menu = await screen.findByRole("navigation", { name: "Settings sections" });
    expect(within(menu).getAllByRole("button")).toHaveLength(9);
    expect(within(menu).getByRole("button", { name: "Generation" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Notification" })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: "Generation Defaults" })).toBeNull();
    expect(within(menu).queryByRole("button", { name: "Image Watermark" })).toBeNull();
    expect(within(menu).queryByRole("button", { name: "Local Image Templates" })).toBeNull();
    expect(within(menu).getByRole("button", { name: "Connection" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: /Advanced/ })).toBeTruthy();
    expect(within(menu).queryByRole("button", { name: /Diagnostics/i })).toBeNull();
    expect(await screen.findByRole("heading", { level: 2, name: "Generation" })).toBeTruthy();
    expect(screen.getByText("Default Document Type")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: /show watermark/i })).toBeNull();

    fireEvent.click(within(menu).getByRole("button", { name: "Connection" }));

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(within(menu).getByRole("button", { name: "Connection" }).getAttribute("aria-current")).toBe("true");
    expect(await screen.findByRole("heading", { level: 2, name: "Connection" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Generation" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: "Appearance" })).toBeNull();
  });

  it("keeps the Settings navigation and content canvas as sibling layout columns", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    const { container } = render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    const layout = container.querySelector(".settings-layout");
    const menu = container.querySelector(".settings-secondary-menu");
    const content = container.querySelector(".settings-content");
    const stage = container.querySelector(".settings-stage");
    const page = container.querySelector(".settings-page");

    expect(stage).not.toBeNull();
    expect(page?.parentElement).toBe(stage);
    expect(layout).not.toBeNull();
    expect(menu?.parentElement).toBe(layout);
    expect(content?.parentElement).toBe(layout);
    expect(menu?.nextElementSibling).toBe(content);
  });

  it("keeps category titles accessible without rendering a duplicate card header", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    const { container } = render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    expect(container.querySelector(".settings-eyebrow")?.textContent).toBe("OFFICEDEX SETTINGS");
    expect(container.querySelectorAll(".settings-nav-icon svg")).toHaveLength(9);
    expect(container.querySelector(".settings-nav-group-start")).not.toBeNull();
    expect(container.querySelector(".settings-section-header")).toBeNull();
    expect(container.querySelector(".settings-document-chips")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Generation" })).toHaveClass("ui-sr-only");
    expect(container.querySelector(".settings-section-body > .setting-row")).not.toBeNull();
    expect(container.querySelector(".settings-toggle-control")?.textContent).toContain("On");
  });

  it("renders About only after selecting it from the Settings menu", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("heading", { level: 2, name: "About" })).toBeNull();

    await selectSettingsSection("About");

    expect(await screen.findByRole("heading", { level: 2, name: "About" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Reset" })).toBeNull();
  });

  it("changing default document type calls updateSettings with the new value", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    const trigger = await screen.findByRole("button", { name: /PowerPoint \(\.pptx\)/ });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Word (.docx)" }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalled());
    const last = updateSettingsSpy.mock.calls.at(-1)![0] as Partial<UserSettings>;
    expect(last.defaults?.documentType).toBe("docx");
  });

  it("does not expose generation mode settings", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: /^generation$/i });

    expect(screen.queryByText("Generation Mode")).toBeNull();
    expect(screen.queryByRole("radio", { name: /fast/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /smart/i })).toBeNull();
  });

  it("toggling enableImages persists the new value", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await screen.findByText("Enable Images");

    // The Switch in Enable Images row
    const enableImagesSwitches = screen.getAllByRole("switch");
    fireEvent.click(enableImagesSwitches[0]);
    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalled());
    const last = updateSettingsSpy.mock.calls.at(-1)![0] as Partial<UserSettings>;
    expect(last.defaults?.enableImages).toBe(false);
  });

  it("does not show desktop notifications in the Generation section", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    const generationHeading = await screen.findByRole("heading", { level: 2, name: "Generation" });
    const generationGroup = generationHeading.closest(".setting-group");

    expect(generationGroup).not.toBeNull();
    expect(within(generationGroup as HTMLElement).queryByRole("switch", { name: /desktop notifications/i })).toBeNull();
  });

  it("shows desktop notifications in a dedicated Notification section", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    await selectSettingsSection("Notification");

    expect(await screen.findByRole("heading", { level: 2, name: "Notification" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: /desktop notifications/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /test desktop notification/i })).not.toBeDisabled();
    expect(screen.queryByRole("heading", { level: 2, name: "Generation" })).toBeNull();
  });

  it("toggles desktop notifications in localStorage without writing Go settings", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Notification");
    await screen.findByText("Desktop notifications");

    const desktopNotificationsSwitch = screen.getByRole("switch", { name: /desktop notifications/i });
    fireEvent.click(desktopNotificationsSwitch);

    expect(readNotificationsEnabled()).toBe(false);
    expect(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)).toBe("false");
    expect(
      updateSettingsSpy.mock.calls.every((args) => (args[0] as Partial<UserSettings>).defaults?.enableImages === undefined),
    ).toBe(true);
  });

  it("shows invite code only in the Subscription section and copies it", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    expect(screen.queryByText("invite-user")).toBeNull();
    await selectSettingsSection("Subscription");

    expect(await screen.findByText("invite-user")).toBeTruthy();
    await waitFor(() => expect(getInviteInfoSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /copy invite code/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("invite-user"));
  });

  it("disables the desktop notification test button when notifications are off", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Notification");

    fireEvent.click(screen.getByRole("switch", { name: /desktop notifications/i }));

    expect(screen.getByRole("button", { name: /test desktop notification/i })).toBeDisabled();
  });

  it("sends a desktop notification test and reports success", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Notification");

    fireEvent.click(screen.getByRole("button", { name: /test desktop notification/i }));

    await waitFor(() => expect(sendDesktopNotificationSpy).toHaveBeenCalledTimes(1));
    expect(sendDesktopNotificationSpy).toHaveBeenCalledWith({
      title: "OfficeDex",
      body: "This is a test desktop notification from OfficeDex.",
    });
    expect(uiToast.success).toHaveBeenCalledWith("Test notification sent");
  });

  it("reports desktop notification test failures", async () => {
    sendDesktopNotificationSpy.mockRejectedValueOnce(new Error("permission denied"));
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Notification");

    fireEvent.click(screen.getByRole("button", { name: /test desktop notification/i }));

    await waitFor(() => expect(uiToast.error).toHaveBeenCalledWith("Test notification failed: permission denied"));
  });

  it("Provider form is always visible and lets user edit api key", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    currentSettings = makeSettings({
      defaults: {
        documentType: "pptx",
        enableImages: true,
        imageQuality: "premium",
      },
    });
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    fireEvent.click(await screen.findByRole("button", { name: "Official" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Custom endpoint" }));

    const apiKeyField = await screen.findByPlaceholderText(/api key/i);
    fireEvent.change(apiKeyField, { target: { value: "sk-new-key" } });
    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.llmProvider?.apiKey === "sk-new-key";
      });
      expect(matched).toBe(true);
    });
    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Cannot update a component");
  });

  it("requires sign-in before selecting and saving Custom endpoint", async () => {
    whoamiSpy.mockResolvedValueOnce({ mode: "anonymous" });
    const onOpenLogin = vi.fn();
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen onOpenLogin={onOpenLogin} />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    expect(await screen.findByText(/sign in to use custom endpoints/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onOpenLogin).toHaveBeenCalledTimes(1);

    const officialTrigger = await screen.findByRole("button", { name: "Official" });
    fireEvent.click(officialTrigger);
    const customOption = await screen.findByRole("menuitemradio", { name: "Custom endpoint" });
    expect(customOption).toBeDisabled();

    expect(screen.queryByPlaceholderText(/api key/i)).toBeNull();
    expect(
      updateSettingsSpy.mock.calls.every((args) => (args[0] as Partial<UserSettings>).llmProvider === undefined),
    ).toBe(true);
  });

  it("Provider test in Settings confirms before running a paid official probe", async () => {
    testProviderSpy.mockResolvedValueOnce({
      ok: true,
      httpStatus: 0,
      latencyMs: 25,
      url: "official",
      probeType: "officialPaid",
    });
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    fireEvent.click(await screen.findByRole("button", { name: /test connection/i }));

    expect(await screen.findByText(/may consume credits/i)).toBeTruthy();
    expect(testProviderSpy).not.toHaveBeenCalled();
    const okButton = await screen.findByRole("button", { name: /run test/i });
    fireEvent.click(okButton);

    await waitFor(() => expect(testProviderSpy).toHaveBeenCalledTimes(1));
    expect(testProviderSpy).toHaveBeenCalledWith({
      useProviderOverride: true,
      llmProvider: null,
      allowPaidOfficialProbe: true,
    });
    expect(await screen.findByText(/Official generation probe passed/)).toBeTruthy();
  });

  it("Provider test in Settings uses the saved custom settings without an override payload", async () => {
    currentSettings = makeSettings({
      llmProvider: {
        type: "custom",
        baseUrl: "https://custom.example/v1",
        apiKey: "sk-test",
        model: "gpt-test",
      },
    });
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    fireEvent.click(await screen.findByRole("button", { name: /test connection/i }));

    await waitFor(() => expect(testProviderSpy).toHaveBeenCalledTimes(1));
    expect(testProviderSpy).toHaveBeenCalledWith();
    expect(await screen.findByText(/HTTP 200/)).toBeTruthy();
  });

  it("Reset everything opens a confirm modal and applies the reset patch on OK", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Reset");

    fireEvent.click(screen.getByRole("button", { name: /reset everything/i }));

    const okButton = within(await screen.findByRole("dialog")).getByRole("button", { name: /reset everything/i });
    fireEvent.click(okButton);

    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.onboardingCompletedAt === null && patch.llmProvider === null;
      });
      expect(matched).toBe(true);
    });
  });

  it("'Show wizard' confirms then sets onboardingCompletedAt to null", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    fireEvent.click(screen.getByRole("button", { name: /show wizard/i }));

    const okButton = within(await screen.findByRole("dialog")).getByRole("button", { name: /show wizard/i });
    fireEvent.click(okButton);

    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.onboardingCompletedAt === null;
      });
      expect(matched).toBe(true);
    });
  });

  it("Proxy card starts disabled with the default local proxy URL ready when enabled", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    const enableSwitch = await screen.findByRole("switch", { name: /enable proxy/i });
    expect(enableSwitch.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(enableSwitch);

    expect(((await screen.findByLabelText(/proxy url/i)) as HTMLInputElement).value).toBe("http://127.0.0.1:7890");
  });

  it("Proxy card saves enabled+url patch and disabling keeps the URL but turns proxy off", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    const enableSwitch = await screen.findByRole("switch", { name: /enable proxy/i });
    fireEvent.click(enableSwitch);

    const urlInput = await screen.findByLabelText(/proxy url/i);
    fireEvent.change(urlInput, { target: { value: "http://127.0.0.1:7890" } });

    const saveButton = screen.getByRole("button", { name: /save proxy/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.proxy?.enabled === true && patch.proxy?.url === "http://127.0.0.1:7890";
      });
      expect(matched).toBe(true);
    });

    cleanup();
    currentSettings = makeSettings({ proxy: { enabled: true, url: "http://127.0.0.1:7890" } });
    updateSettingsSpy.mockClear();
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(2));
    await selectSettingsSection("Advanced & Support");
    await waitFor(() => {
      expect(screen.getByRole("switch", { name: /enable proxy/i }).getAttribute("aria-checked")).toBe("true");
    });

    fireEvent.click(await screen.findByRole("switch", { name: /enable proxy/i }));
    fireEvent.click(screen.getByRole("button", { name: /save proxy/i }));

    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.proxy?.enabled === false && patch.proxy?.url === "http://127.0.0.1:7890";
      });
      expect(matched).toBe(true);
    });
  });

  it("Proxy card rejects an obviously malformed URL", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await selectSettingsSection("Advanced & Support");

    fireEvent.click(await screen.findByRole("switch", { name: /enable proxy/i }));
    const urlInput = await screen.findByLabelText(/proxy url/i);
    fireEvent.change(urlInput, { target: { value: "not-a-url" } });
    const saveButton = screen.getByRole("button", { name: /save proxy/i });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(
      updateSettingsSpy.mock.calls.every((args) => (args[0] as Partial<UserSettings>).proxy === undefined),
    ).toBe(true);
  });

  it("disables watermark opt-out for users without paid entitlement", async () => {
    getCreditStatusSpy.mockResolvedValueOnce({
      mode: "logged_in",
      accessMode: "hosted",
      planName: "Free",
      paidEntitlement: false,
      hostedCreditBalance: null,
      anonymousCreditAvailable: null,
      anonymousCreditReserved: null,
      anonymousCreditBalance: null,
      rewardRemaining: 0,
      paidKeyPrefix: "",
      paidKeyTotal: 0,
      paidKeyUsed: 0,
      paidKeyRemaining: 0,
      raw: "",
    } satisfies CreditStatus);
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("Advanced & Support");

    expect(await screen.findByText(/free images include the officedex watermark/i)).toBeTruthy();
    expect(screen.getByRole("switch", { name: /show watermark/i }).hasAttribute("disabled")).toBe(true);
  });

  it("does not let hosted credit accounts disable watermark when entitlement flag is false", async () => {
    currentSettings = makeSettings({ imageWatermark: { showWatermark: true, preferenceSource: "user" } });
    getCreditStatusSpy.mockResolvedValueOnce({
      mode: "logged_in",
      accessMode: "hosted",
      planName: "",
      paidEntitlement: false,
      hostedCreditBalance: 1097930,
      anonymousCreditAvailable: null,
      anonymousCreditReserved: null,
      anonymousCreditBalance: null,
      rewardRemaining: 0,
      paidKeyPrefix: "",
      paidKeyTotal: 0,
      paidKeyUsed: 0,
      paidKeyRemaining: 0,
      raw: "",
    } satisfies CreditStatus);
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("Advanced & Support");

    const toggle = await screen.findByRole("switch", { name: /show watermark/i });
    expect(toggle.hasAttribute("disabled")).toBe(true);
    fireEvent.click(toggle);

    expect(
      updateSettingsSpy.mock.calls.every((args) => (args[0] as Partial<UserSettings>).imageWatermark === undefined),
    ).toBe(true);
  });

  it("lets paid users opt into watermark and saves the setting", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("Advanced & Support");

    const toggle = await screen.findByRole("switch", { name: /show watermark/i });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalledWith(expect.objectContaining({
        imageWatermark: { showWatermark: true, preferenceSource: "user" },
      }));
    });
  });

  it("lets paid users turn off watermark and removes custom text input", async () => {
    currentSettings = makeSettings({ imageWatermark: { showWatermark: true, preferenceSource: "user" } });
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("Advanced & Support");

    const toggle = await screen.findByRole("switch", { name: /show watermark/i });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(updateSettingsSpy).toHaveBeenCalledWith(expect.objectContaining({
        imageWatermark: { showWatermark: false, preferenceSource: "user" },
      }));
    });
    expect(screen.queryByLabelText(/watermark text/i)).toBeNull();
  });

});

describe("SettingsScreen > About card", () => {
  let getAppVersionSpy: ReturnType<typeof vi.fn>;
  let checkAppUpdateSpy: ReturnType<typeof vi.fn>;
  let downloadAppUpdateSpy: ReturnType<typeof vi.fn>;
  let installAppUpdateSpy: ReturnType<typeof vi.fn>;
  let cancelAppUpdateSpy: ReturnType<typeof vi.fn>;
  let onAppUpdateEventSpy: ReturnType<typeof vi.fn>;
  let openExternalSpy: ReturnType<typeof vi.fn>;
  let aboutOriginals: Partial<DesktopAPI>;

  beforeEach(() => {
    installDomStubs();
    currentSettings = makeSettings();
    getSettingsSpy = vi.fn(async () => currentSettings);
    updateSettingsSpy = vi.fn(async () => currentSettings);
    getDefaultWorkspaceDirSpy = vi.fn(async () => "/tmp/default-workspace");
    openDirectoryDialogSpy = vi.fn(async () => null);
    getAppVersionSpy = vi.fn(async () => "0.1.0");
    checkAppUpdateSpy = vi.fn(async () => ({
      release: {
        version: "0.2.0",
        notes: "Bug fixes.",
        minSupportedVersion: "0.0.0",
        mandatory: false,
        assets: {},
      },
      status: {
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        updateAvailable: true,
        mandatory: false,
        downloading: false,
        downloadedPath: null,
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
      },
    }));
    downloadAppUpdateSpy = vi.fn(async () => "/tmp/x.dmg");
    installAppUpdateSpy = vi.fn(async () => undefined);
    cancelAppUpdateSpy = vi.fn(async () => undefined);
    onAppUpdateEventSpy = vi.fn(() => () => undefined);
    openExternalSpy = vi.fn(async () => undefined);
    aboutOriginals = {
      getSettings: officecli.getSettings,
      updateSettings: officecli.updateSettings,
      getDefaultWorkspaceDir: officecli.getDefaultWorkspaceDir,
      openDirectoryDialog: officecli.openDirectoryDialog,
      openExternal: officecli.openExternal,
      getAppVersion: officecli.getAppVersion,
      checkAppUpdate: officecli.checkAppUpdate,
      downloadAppUpdate: officecli.downloadAppUpdate,
      installAppUpdate: officecli.installAppUpdate,
      cancelAppUpdate: officecli.cancelAppUpdate,
      onAppUpdateEvent: officecli.onAppUpdateEvent,
    };
    officecli.getSettings = getSettingsSpy as unknown as DesktopAPI["getSettings"];
    officecli.updateSettings = updateSettingsSpy as unknown as DesktopAPI["updateSettings"];
    officecli.getDefaultWorkspaceDir = getDefaultWorkspaceDirSpy as unknown as DesktopAPI["getDefaultWorkspaceDir"];
    officecli.openDirectoryDialog = openDirectoryDialogSpy as unknown as DesktopAPI["openDirectoryDialog"];
    officecli.openExternal = openExternalSpy as unknown as DesktopAPI["openExternal"];
    officecli.getAppVersion = getAppVersionSpy as unknown as DesktopAPI["getAppVersion"];
    officecli.checkAppUpdate = checkAppUpdateSpy as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = downloadAppUpdateSpy as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = installAppUpdateSpy as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = cancelAppUpdateSpy as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = onAppUpdateEventSpy as unknown as DesktopAPI["onAppUpdateEvent"];
  });

  afterEach(async () => {
    await cleanupUiPortals();
    Object.assign(officecli, aboutOriginals);
    vi.restoreAllMocks();
  });

  it("renders the version and a Check for updates button", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("About");
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    expect(await screen.findByRole("heading", { name: "OfficeDex" })).toBeTruthy();
    expect(await screen.findByText(/OfficeDex 0\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/AI desktop workspace for documents/i)).toBeTruthy();
    expect(screen.queryByText("Stable")).toBeNull();
    expect(screen.getByText(/Check for updates/i)).toBeTruthy();
  });

  it("opens About links and shows the disclaimer modal", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("About");
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: /visit website/i }));
    fireEvent.click(await screen.findByRole("button", { name: /github/i }));
    fireEvent.click(await screen.findByRole("button", { name: /gpl-3\.0/i }));
    fireEvent.click(await screen.findByRole("button", { name: /feedback/i }));

    expect(openExternalSpy).toHaveBeenCalledWith("https://officecli.io");
    expect(openExternalSpy).toHaveBeenCalledWith("https://github.com/officecli/officedex");
    expect(openExternalSpy).toHaveBeenCalledWith("https://github.com/officecli/officedex/blob/main/LICENSE");
    expect(openExternalSpy).toHaveBeenCalledWith("https://github.com/officecli/officedex/issues");

    fireEvent.click(await screen.findByRole("button", { name: /disclaimer/i }));
    expect(await screen.findByText(/OfficeDex AI may produce inaccurate content/i)).toBeTruthy();
  });

  it("Check for updates click invokes checkAppUpdate and surfaces the new version button", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("About");
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    const checkBtn = await screen.findByText(/Check for updates/i);
    fireEvent.click(checkBtn.closest("button")!);
    await waitFor(() => expect(checkAppUpdateSpy).toHaveBeenCalled());
    expect(await screen.findByText(/Update to 0\.2\.0/)).toBeTruthy();
  });

  it("clicking Update to <version> triggers download", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await selectSettingsSection("About");
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    fireEvent.click((await screen.findByText(/Check for updates/i)).closest("button")!);
    const updateBtn = await screen.findByText(/Update to 0\.2\.0/);
    fireEvent.click(updateBtn.closest("button")!);
    await waitFor(() => expect(downloadAppUpdateSpy).toHaveBeenCalled());
  });
});

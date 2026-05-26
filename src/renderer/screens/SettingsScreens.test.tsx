import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI, UserSettings } from "../../shared/types";
import { officecli } from "../bridge";

let currentSettings: UserSettings;

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
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    version: 1,
    defaults: {
      documentType: "pptx",
      mode: "fast",
      runtimeMode: "hosted",
      enableImages: true,
      imageQuality: "premium",
      ...(overrides.defaults ?? {}),
    },
    outputDir: overrides.outputDir ?? null,
    llmProvider: overrides.llmProvider ?? null,
    onboardingCompletedAt: overrides.onboardingCompletedAt ?? "2026-05-22T00:00:00Z",
    proxy: overrides.proxy ?? null,
  };
}

let getSettingsSpy: ReturnType<typeof vi.fn>;
let updateSettingsSpy: ReturnType<typeof vi.fn>;
let getDefaultWorkspaceDirSpy: ReturnType<typeof vi.fn>;
let openDirectoryDialogSpy: ReturnType<typeof vi.fn>;
let originals: Partial<DesktopAPI>;

beforeEach(() => {
  installDomStubs();
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
  originals = {
    getSettings: officecli.getSettings,
    updateSettings: officecli.updateSettings,
    getDefaultWorkspaceDir: officecli.getDefaultWorkspaceDir,
    openDirectoryDialog: officecli.openDirectoryDialog,
  };
  officecli.getSettings = getSettingsSpy as unknown as DesktopAPI["getSettings"];
  officecli.updateSettings = updateSettingsSpy as unknown as DesktopAPI["updateSettings"];
  officecli.getDefaultWorkspaceDir = getDefaultWorkspaceDirSpy as unknown as DesktopAPI["getDefaultWorkspaceDir"];
  officecli.openDirectoryDialog = openDirectoryDialogSpy as unknown as DesktopAPI["openDirectoryDialog"];
});

afterEach(async () => {
  await act(async () => {});
  cleanup();
  Object.assign(officecli, originals);
  vi.restoreAllMocks();
});

describe("SettingsScreen", () => {
  it("loads settings on mount and shows current generation defaults", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: /generation defaults/i })).toBeTruthy();
    expect(screen.getByText("Workspace Output Directory")).toBeTruthy();
    expect(screen.getAllByText("Core Settings").length).toBeGreaterThan(0);
  });

  it("changing default document type calls updateSettings with the new value", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    // antd Select: locate by current displayed label, click to open dropdown
    const trigger = await screen.findByText(/PowerPoint \(\.pptx\)/);
    fireEvent.mouseDown(trigger);
    const docxOption = await screen.findByText(/Word \(\.docx\)/);
    fireEvent.click(docxOption);

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalled());
    const last = updateSettingsSpy.mock.calls.at(-1)![0] as Partial<UserSettings>;
    expect(last.defaults?.documentType).toBe("docx");
  });

  it("switching to Smart mode sends mode=best in updateSettings", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: /generation defaults/i });

    fireEvent.click(screen.getByRole("radio", { name: /smart/i }));
    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalled());
    const last = updateSettingsSpy.mock.calls.at(-1)![0] as Partial<UserSettings>;
    expect(last.defaults?.mode).toBe("best");
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

  it("Browse output directory calls openDirectoryDialog and stores the picked path", async () => {
    openDirectoryDialogSpy.mockResolvedValueOnce("/Users/test/picked/workspace");
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await screen.findByText("Workspace Output Directory");

    const browseButtons = screen.getAllByRole("button", { name: /browse/i });
    fireEvent.click(browseButtons[0]);

    await waitFor(() => expect(openDirectoryDialogSpy).toHaveBeenCalled());
    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.outputDir === "/Users/test/picked/workspace";
      });
      expect(matched).toBe(true);
    });
  });

  it("External runtime selection reveals ProviderForm and lets user edit api key", async () => {
    currentSettings = makeSettings({
      defaults: {
        documentType: "pptx",
        mode: "fast",
        runtimeMode: "external",
        enableImages: true,
        imageQuality: "premium",
      },
    });
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    const apiKeyField = await screen.findByPlaceholderText(/api key/i);
    fireEvent.change(apiKeyField, { target: { value: "sk-new-key" } });
    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.llmProvider?.apiKey === "sk-new-key";
      });
      expect(matched).toBe(true);
    });
  });

  it("Reset everything opens a confirm modal and applies the reset patch on OK", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: /generation defaults/i });

    fireEvent.click(screen.getByRole("button", { name: /reset everything/i }));

    // Modal.confirm renders portal-mounted buttons in .ant-modal-confirm-btns.
    // Wait for it, then click the OK button (the danger-styled one).
    const okButton = await waitFor(() => {
      const buttons = document.querySelectorAll(".ant-modal-confirm-btns button");
      const ok = Array.from(buttons).find((btn) => btn.classList.contains("ant-btn-dangerous"));
      if (!ok) throw new Error("OK button not rendered yet");
      return ok as HTMLButtonElement;
    });
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
    await screen.findByRole("heading", { name: /generation defaults/i });

    fireEvent.click(screen.getByRole("button", { name: /show wizard/i }));

    // OK button is the second action inside .ant-modal-confirm-btns (after Cancel).
    const okButton = await waitFor(() => {
      const buttons = document.querySelectorAll(".ant-modal-confirm-btns button");
      if (buttons.length < 2) throw new Error("OK button not rendered yet");
      return buttons[buttons.length - 1] as HTMLButtonElement;
    });
    fireEvent.click(okButton);

    await waitFor(() => {
      const matched = updateSettingsSpy.mock.calls.some((args) => {
        const patch = args[0] as Partial<UserSettings>;
        return patch.onboardingCompletedAt === null;
      });
      expect(matched).toBe(true);
    });
  });

  it("Proxy card saves enabled+url patch and disabling clears proxy", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

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

    currentSettings = makeSettings({ proxy: { enabled: true, url: "http://127.0.0.1:7890" } });
    updateSettingsSpy.mockClear();
  });

  it("Proxy card rejects an obviously malformed URL", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getSettingsSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("switch", { name: /enable proxy/i }));
    const urlInput = await screen.findByLabelText(/proxy url/i);
    fireEvent.change(urlInput, { target: { value: "not-a-url" } });
    const saveButton = screen.getByRole("button", { name: /save proxy/i });
    expect(saveButton.hasAttribute("disabled")).toBe(true);
    expect(
      updateSettingsSpy.mock.calls.every((args) => (args[0] as Partial<UserSettings>).proxy === undefined),
    ).toBe(true);
  });
});

describe("SettingsScreen > About card", () => {
  let getAppVersionSpy: ReturnType<typeof vi.fn>;
  let checkAppUpdateSpy: ReturnType<typeof vi.fn>;
  let downloadAppUpdateSpy: ReturnType<typeof vi.fn>;
  let installAppUpdateSpy: ReturnType<typeof vi.fn>;
  let cancelAppUpdateSpy: ReturnType<typeof vi.fn>;
  let onAppUpdateEventSpy: ReturnType<typeof vi.fn>;
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
    aboutOriginals = {
      getSettings: officecli.getSettings,
      updateSettings: officecli.updateSettings,
      getDefaultWorkspaceDir: officecli.getDefaultWorkspaceDir,
      openDirectoryDialog: officecli.openDirectoryDialog,
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
    officecli.getAppVersion = getAppVersionSpy as unknown as DesktopAPI["getAppVersion"];
    officecli.checkAppUpdate = checkAppUpdateSpy as unknown as DesktopAPI["checkAppUpdate"];
    officecli.downloadAppUpdate = downloadAppUpdateSpy as unknown as DesktopAPI["downloadAppUpdate"];
    officecli.installAppUpdate = installAppUpdateSpy as unknown as DesktopAPI["installAppUpdate"];
    officecli.cancelAppUpdate = cancelAppUpdateSpy as unknown as DesktopAPI["cancelAppUpdate"];
    officecli.onAppUpdateEvent = onAppUpdateEventSpy as unknown as DesktopAPI["onAppUpdateEvent"];
  });

  afterEach(async () => {
    await act(async () => {});
    cleanup();
    Object.assign(officecli, aboutOriginals);
    vi.restoreAllMocks();
  });

  it("renders the version and a Check for updates button", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    expect(await screen.findByText(/OfficeDex 0\.1\.0/)).toBeTruthy();
    expect(screen.getByText(/Check for updates/i)).toBeTruthy();
  });

  it("Check for updates click invokes checkAppUpdate and surfaces the new version button", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    const checkBtn = await screen.findByText(/Check for updates/i);
    fireEvent.click(checkBtn.closest("button")!);
    await waitFor(() => expect(checkAppUpdateSpy).toHaveBeenCalled());
    expect(await screen.findByText(/Update to 0\.2\.0/)).toBeTruthy();
  });

  it("clicking Update to <version> triggers download", async () => {
    const { SettingsScreen } = await import("./SettingsScreens");
    render(<SettingsScreen />);
    await waitFor(() => expect(getAppVersionSpy).toHaveBeenCalled());
    fireEvent.click((await screen.findByText(/Check for updates/i)).closest("button")!);
    const updateBtn = await screen.findByText(/Update to 0\.2\.0/);
    fireEvent.click(updateBtn.closest("button")!);
    await waitFor(() => expect(downloadAppUpdateSpy).toHaveBeenCalled());
  });
});

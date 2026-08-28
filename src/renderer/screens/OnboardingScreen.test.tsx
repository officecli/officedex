import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Modal } from "../ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingScreen } from "./OnboardingScreen";
import { officecli } from "../bridge";
import type { UserSettings, WhoAmIResult } from "../../shared/types";

const baseSettings: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    enableImages: true,
    imageQuality: "premium",
  },
  workspaceDir: null,
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: null,
  proxy: null,
  imageWatermark: { showWatermark: true, preferenceSource: "system" },
  waiting2048Enabled: false,
};

let updateSettingsSpy: ReturnType<typeof vi.fn>;
let openDirectoryDialogSpy: ReturnType<typeof vi.fn>;
let testProviderSpy: ReturnType<typeof vi.fn>;
let whoamiSpy: ReturnType<typeof vi.fn>;

async function cleanupDialogPortals() {
  Modal.destroyAll();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
}

async function confirmationButton(kind: "cancel" | "ok") {
  return waitFor(() => {
    const dialogs = screen.getAllByRole("dialog");
    const confirmation = dialogs.at(-1);
    if (!confirmation || !confirmation.classList.contains("ui-dialog")) throw new Error("Confirmation dialog not rendered yet");
    const buttons = within(confirmation).getAllByRole("button");
    if (buttons.length < 2) throw new Error("Confirmation buttons not rendered yet");
    return buttons[kind === "cancel" ? 0 : buttons.length - 1] as HTMLButtonElement;
  });
}

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  updateSettingsSpy = vi.fn(async (patch: Partial<UserSettings>) => ({
    ...baseSettings,
    ...patch,
    defaults: { ...baseSettings.defaults, ...(patch.defaults ?? {}) },
  }));
  openDirectoryDialogSpy = vi.fn(async () => null);
  testProviderSpy = vi.fn(async () => ({ ok: true, httpStatus: 0, latencyMs: 12, url: "official", probeType: "officialPaid" }));
  whoamiSpy = vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "logged_in", userId: "user-onboarding" }));
  officecli.updateSettings = updateSettingsSpy as unknown as typeof officecli.updateSettings;
  officecli.openDirectoryDialog = openDirectoryDialogSpy as unknown as typeof officecli.openDirectoryDialog;
  officecli.testProvider = testProviderSpy as unknown as typeof officecli.testProvider;
  officecli.whoami = whoamiSpy as unknown as typeof officecli.whoami;
});

afterEach(async () => {
  await cleanupDialogPortals();
});

describe("OnboardingScreen", () => {
  it("walks through both steps and finishes with chosen values", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);

    expect(screen.getByText("Generation defaults")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText("Provider setup")).toBeTruthy();
    const workspaceField = screen.getByDisplayValue("/tmp/default-workspace") as HTMLInputElement;
    expect(workspaceField.disabled).toBe(true);
    expect(screen.getByText(/add or switch project workspaces from the projects sidebar/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    expect(await screen.findByText(/may consume credits/i)).toBeTruthy();
    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.defaults?.documentType).toBe("pptx");
    expect(patch).not.toHaveProperty("workspaceDir");
    expect(typeof patch.onboardingCompletedAt).toBe("string");
    expect(patch.onboardingCompletedAt && new Date(patch.onboardingCompletedAt).toString()).not.toBe("Invalid Date");
  });

  it("Skip for now marks onboarding completed without changing other fields", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(Object.keys(patch)).toEqual(["onboardingCompletedAt"]);
    expect(typeof patch.onboardingCompletedAt).toBe("string");
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("Back button returns to step 0 from step 1 without losing draft state", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("Generation defaults")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ProviderForm is always visible in step 1 and persists provider on finish", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Official" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom endpoint" }));

    const apiKeyField = await screen.findByPlaceholderText(/api key/i);
    fireEvent.change(apiKeyField, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.llmProvider).not.toBeNull();
    expect(patch.llmProvider?.apiKey).toBe("sk-test-key");
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("does not allow anonymous users to select or save Custom endpoint during onboarding", async () => {
    whoamiSpy.mockResolvedValueOnce({ mode: "anonymous" });
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();
    expect(await screen.findByText(/sign in to use custom endpoints/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Official" }));
    expect(screen.getByRole("menuitemradio", { name: "Custom endpoint" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom endpoint" }));

    expect(screen.queryByPlaceholderText(/api key/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.llmProvider).toBeNull();
  });

  it("empty provider finish never sends an llmProvider payload", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.llmProvider).toBeNull();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("confirms the paid draft official provider test before finishing", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    expect(await screen.findByText(/may consume credits/i)).toBeTruthy();
    expect(testProviderSpy).not.toHaveBeenCalled();
    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    await waitFor(() => expect(testProviderSpy).toHaveBeenCalledTimes(1));
    expect(testProviderSpy).toHaveBeenCalledWith({
      llmProvider: null,
      proxy: null,
      useProviderOverride: true,
      useProxyOverride: true,
      allowPaidOfficialProbe: true,
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("cancelling the paid official provider confirmation does not test or finish", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    expect(await screen.findByText(/may consume credits/i)).toBeTruthy();
    const cancelButton = await confirmationButton("cancel");
    fireEvent.click(cancelButton);

    await waitFor(() => expect(document.querySelector(".ui-dialog")).toBeNull());
    expect(testProviderSpy).not.toHaveBeenCalled();
    expect(updateSettingsSpy).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("shows the proxy step when the paid official provider test has a network error", async () => {
    testProviderSpy.mockResolvedValueOnce({
      ok: false,
      httpStatus: 0,
      latencyMs: 0,
      url: "official",
      probeType: "officialPaid",
      error: "connect: network is unreachable",
    });
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    expect(await screen.findByText("Configure proxy")).toBeTruthy();
    expect(((await screen.findByLabelText(/proxy url/i)) as HTMLInputElement).value).toBe("http://127.0.0.1:7890");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("keeps the user on provider setup when the paid official provider test fails for credits", async () => {
    testProviderSpy.mockResolvedValueOnce({
      ok: false,
      httpStatus: 0,
      latencyMs: 0,
      url: "official",
      probeType: "officialPaid",
      error: "not enough credits",
    });
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider setup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /finish/i }));
    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);

    expect(await screen.findByText(/not enough credits/i)).toBeTruthy();
    expect(screen.queryByText("Configure proxy")).toBeNull();
    expect(updateSettingsSpy).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("saves proxy settings and finishes after the retry test passes", async () => {
    testProviderSpy
      .mockResolvedValueOnce({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "official",
        error: "connect: network is unreachable",
      })
      .mockResolvedValueOnce({ ok: true, httpStatus: 0, latencyMs: 18, url: "official", probeType: "officialPaid" });
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("button", { name: /finish/i }));
    const okButton = await confirmationButton("ok");
    fireEvent.click(okButton);
    expect(await screen.findByText("Configure proxy")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /save proxy and retry/i }));

    await waitFor(() => expect(testProviderSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.proxy).toEqual({ enabled: true, url: "http://127.0.0.1:7890" });
    expect(typeof patch.onboardingCompletedAt).toBe("string");
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});

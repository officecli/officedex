import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingScreen } from "./OnboardingScreen";
import { officecli } from "../bridge";
import type { UserSettings } from "../../shared/types";

const baseSettings: UserSettings = {
  version: 1,
  defaults: {
    documentType: "pptx",
    mode: "fast",
    enableImages: true,
    imageQuality: "premium",
  },
  outputDir: null,
  llmProvider: null,
  onboardingCompletedAt: null,
  proxy: null,
};

let updateSettingsSpy: ReturnType<typeof vi.fn>;
let openDirectoryDialogSpy: ReturnType<typeof vi.fn>;

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
  officecli.updateSettings = updateSettingsSpy as unknown as typeof officecli.updateSettings;
  officecli.openDirectoryDialog = openDirectoryDialogSpy as unknown as typeof officecli.openDirectoryDialog;
});

afterEach(() => {
  cleanup();
});

describe("OnboardingScreen", () => {
  it("walks through both steps and finishes with chosen values", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);

    expect(screen.getByText("Generation defaults")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText("Provider & workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.defaults?.documentType).toBe("pptx");
    expect(patch.defaults?.mode).toBe("fast");
    expect(patch.outputDir).toBeNull();
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
    expect(await screen.findByText("Provider & workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText("Generation defaults")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("ProviderForm is always visible in step 1 and persists provider on finish", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider & workspace")).toBeTruthy();

    // Select Custom endpoint to reveal the input fields (Official is default)
    // Ant Design Select: find the displayed value, click to open dropdown
    const officialLabel = await screen.findByText("Official");
    fireEvent.mouseDown(officialLabel);

    const customOption = await screen.findByText("Custom endpoint");
    fireEvent.click(customOption);

    const apiKeyField = await screen.findByPlaceholderText(/api key/i);
    fireEvent.change(apiKeyField, { target: { value: "sk-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.llmProvider).not.toBeNull();
    expect(patch.llmProvider?.apiKey).toBe("sk-test-key");
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("empty provider finish never sends an llmProvider payload", async () => {
    const onComplete = vi.fn();
    render(<OnboardingScreen settings={baseSettings} defaultWorkspaceDir="/tmp/default-workspace" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText("Provider & workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.llmProvider).toBeNull();
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});

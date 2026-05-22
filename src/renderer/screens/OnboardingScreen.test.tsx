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
    runtimeMode: "hosted",
    enableImages: true,
    imageQuality: "standard",
  },
  outputDir: null,
  bridgeBinaryPath: null,
  llmProvider: null,
  onboardingCompletedAt: null,
};

let updateSettingsSpy: ReturnType<typeof vi.fn>;
let openFileDialogSpy: ReturnType<typeof vi.fn>;

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
  updateSettingsSpy = vi.fn(async (patch: Partial<UserSettings>) => ({
    ...baseSettings,
    ...patch,
    defaults: { ...baseSettings.defaults, ...(patch.defaults ?? {}) },
  }));
  openFileDialogSpy = vi.fn(async () => null);
  officecli.updateSettings = updateSettingsSpy as unknown as typeof officecli.updateSettings;
  officecli.openFileDialog = openFileDialogSpy as unknown as typeof officecli.openFileDialog;
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

    expect(await screen.findByText("Workspace & runtime")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => expect(updateSettingsSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));

    const patch = updateSettingsSpy.mock.calls[0][0] as Partial<UserSettings>;
    expect(patch.defaults?.documentType).toBe("pptx");
    expect(patch.defaults?.mode).toBe("fast");
    expect(patch.defaults?.runtimeMode).toBe("hosted");
    expect(patch.outputDir).toBeNull();
    expect(patch.bridgeBinaryPath).toBeNull();
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
});

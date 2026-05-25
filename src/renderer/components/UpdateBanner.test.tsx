import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateBanner } from "./UpdateBanner";
import type { AppUpdateRelease } from "../../shared/types";

const release: AppUpdateRelease = {
  version: "0.2.0",
  notes: "Bug fixes and small improvements.",
  minSupportedVersion: "0.1.0",
  mandatory: false,
  assets: {},
};

describe("UpdateBanner", () => {
  it("renders version and triggers onUpdate when Update now is clicked", () => {
    const onUpdate = vi.fn();
    render(
      <UpdateBanner
        release={release}
        phase="available"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error={null}
        onUpdate={onUpdate}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/New version 0\.2\.0 available/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Update now"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("disables download button and shows progress while downloading", () => {
    render(
      <UpdateBanner
        release={release}
        phase="downloading"
        progress={{ bytesDone: 512, bytesTotal: 2048 }}
        error={null}
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const dlBtn = screen.getByText("Downloading...").closest("button");
    expect(dlBtn?.disabled).toBe(true);
    expect(screen.getByText("512 B / 2.0 KB")).toBeTruthy();
  });

  it("shows Restart to install when phase=downloaded", () => {
    const onInstall = vi.fn();
    render(
      <UpdateBanner
        release={release}
        phase="downloaded"
        progress={{ bytesDone: 2048, bytesTotal: 2048 }}
        error={null}
        onUpdate={vi.fn()}
        onInstall={onInstall}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Restart to install"));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when Later is clicked", () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <UpdateBanner
        release={release}
        phase="available"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error={null}
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    const laterBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss update banner"]');
    expect(laterBtn).not.toBeNull();
    fireEvent.click(laterBtn!);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

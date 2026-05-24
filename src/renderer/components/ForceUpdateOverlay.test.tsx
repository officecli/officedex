import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ForceUpdateOverlay } from "./ForceUpdateOverlay";
import type { AppUpdateRelease } from "../../shared/types";

const release: AppUpdateRelease = {
  version: "0.3.0",
  notes: "Critical security update.",
  minSupportedVersion: "0.3.0",
  mandatory: true,
  assets: {},
};

describe("ForceUpdateOverlay", () => {
  it("renders the title and version and triggers onUpdate", () => {
    const onUpdate = vi.fn();
    render(
      <ForceUpdateOverlay
        release={release}
        phase="available"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={onUpdate}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Required update/i)).toBeTruthy();
    expect(screen.getByText(/Version 0\.3\.0/)).toBeTruthy();
    expect(screen.getByText(/Critical security update/)).toBeTruthy();
    fireEvent.click(screen.getByText("Update now"));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("never renders a dismiss/close button", () => {
    render(
      <ForceUpdateOverlay
        release={release}
        phase="available"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.queryByText(/dismiss/i)).toBeNull();
    expect(screen.queryByText(/later/i)).toBeNull();
    expect(screen.queryByText(/close/i)).toBeNull();
  });

  it("locks body scroll while mounted and restores on unmount", () => {
    const original = document.body.style.overflow;
    const { unmount } = render(
      <ForceUpdateOverlay
        release={release}
        phase="available"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe(original);
    cleanup();
  });

  it("renders progress with aria-valuenow when downloading", () => {
    const { rerender } = render(
      <ForceUpdateOverlay
        release={release}
        phase="downloading"
        progress={{ bytesDone: 0, bytesTotal: 1000 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    let progressEls = document.querySelectorAll(".force-update-progress [aria-valuenow]");
    expect(progressEls.length).toBeGreaterThan(0);
    expect(progressEls[0].getAttribute("aria-valuenow")).toBe("0");
    rerender(
      <ForceUpdateOverlay
        release={release}
        phase="downloading"
        progress={{ bytesDone: 500, bytesTotal: 1000 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    progressEls = document.querySelectorAll(".force-update-progress [aria-valuenow]");
    expect(progressEls[0].getAttribute("aria-valuenow")).toBe("50");
  });

  it("shows Restart to install when downloaded and triggers onInstall", () => {
    const onInstall = vi.fn();
    render(
      <ForceUpdateOverlay
        release={release}
        phase="downloaded"
        progress={{ bytesDone: 100, bytesTotal: 100 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={onInstall}
      />,
    );
    fireEvent.click(screen.getByText("Restart to install"));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });
});

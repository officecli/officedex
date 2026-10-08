import { afterEach, describe, expect, it, vi } from "vitest";
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
  // `globals: false` means RTL registers no automatic cleanup, so without this
  // every render in this file stays in the document and the next `getByText`
  // finds two of everything.
  afterEach(() => cleanup());

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
    // Queried by class, not by text: the version now also appears in the
    // phase's status line ("Version 0.3.0 is ready to download.").
    expect(document.querySelector(".force-update-version")?.textContent).toContain("Version 0.3.0");
    expect(document.querySelector(".force-update-status")?.textContent).toBe("Version 0.3.0 is ready to download.");
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

  it("shows Restart to install when downloaded and the caller does not auto-install", () => {
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
        autoInstall={false}
      />,
    );
    fireEvent.click(screen.getByText("Restart to install"));
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("does not draw a Restart to install button the auto-installing caller makes unpressable", () => {
    // `useAppUpdate` installs by itself on a mandatory update, so `downloaded`
    // lasts one render pass. A button there can never be clicked.
    render(
      <ForceUpdateOverlay
        release={release}
        phase="downloaded"
        progress={{ bytesDone: 39, bytesTotal: 100 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.queryByText("Restart to install")).toBeNull();
    expect(screen.getByText(/Download complete/)).toBeTruthy();
  });

  it("reports a finished download as 100% whatever the byte counter last said", () => {
    render(
      <ForceUpdateOverlay
        release={release}
        phase="downloaded"
        progress={{ bytesDone: 46_137_344, bytesTotal: 118_489_088 }}
        error={null}
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    const progressEls = document.querySelectorAll(".force-update-progress [aria-valuenow]");
    expect(progressEls[0].getAttribute("aria-valuenow")).toBe("100");
  });

  it("gives each phase its own copy", () => {
    const phases = ["idle", "checking", "available", "downloading", "downloaded", "installing", "error"] as const;
    const seen = new Set<string>();
    for (const phase of phases) {
      const { container, unmount } = render(
        <ForceUpdateOverlay
          release={release}
          phase={phase}
          progress={{ bytesDone: 500, bytesTotal: 1000 }}
          error={phase === "error" ? "The download could not be verified." : null}
          currentVersion="0.1.0"
          onUpdate={vi.fn()}
          onInstall={vi.fn()}
        />,
      );
      const text = container.textContent ?? "";
      expect(seen.has(text), `${phase} renders the same copy as an earlier phase`).toBe(false);
      seen.add(text);
      unmount();
    }
    expect(seen.size).toBe(phases.length);
  });

  it("offers a second way out of the error state", () => {
    render(
      <ForceUpdateOverlay
        release={{ ...release, assets: { "darwin-arm64": { url: "https://example.test/a.dmg", sha256: "x", size: 1 } } }}
        phase="error"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error="The download could not be verified."
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    // Not the same word as the button that just failed.
    expect(screen.getByText("Try again")).toBeTruthy();
    expect(screen.queryByText("Update now")).toBeNull();
    const link = document.querySelector<HTMLAnchorElement>(".force-update-download");
    expect(link?.getAttribute("href")).toBe("https://example.test/a.dmg");
    expect(screen.getByText("Copy error details")).toBeTruthy();
  });

  it("keeps a second exit when the release carries no assets", () => {
    render(
      <ForceUpdateOverlay
        release={release}
        phase="error"
        progress={{ bytesDone: 0, bytesTotal: 0 }}
        error="Network unreachable."
        currentVersion="0.1.0"
        onUpdate={vi.fn()}
        onInstall={vi.fn()}
      />,
    );
    expect(document.querySelectorAll(".force-update-download").length).toBe(0);
    expect(screen.getByText("Copy error details")).toBeTruthy();
  });

  it("labels the server-authored release notes", () => {
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
    expect(document.querySelector(".force-update-notes-heading")?.textContent).toBe("Release notes");
    expect(document.querySelector(".force-update-notes")?.textContent).toBe("Critical security update.");
  });
});

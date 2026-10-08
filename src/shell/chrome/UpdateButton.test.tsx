import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppUpdateEvent, AppUpdateRelease, AppUpdateStatus, DesktopAPI } from "../../shared/types";
import { Modal } from "../../renderer/ui";
import { UpdateButton } from "./UpdateButton";
import { UpdateGate } from "./UpdateGate";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(() => {
  act(() => Modal.destroyAll());
  cleanup();
});

const STATUS: AppUpdateStatus = {
  currentVersion: "9.9.9",
  latestVersion: "10.0.0",
  updateAvailable: true,
  mandatory: false,
  downloading: false,
  downloadedPath: null,
  lastCheckedAt: null,
  lastError: null,
};

const RELEASE: AppUpdateRelease = {
  version: "10.0.0",
  notes: "",
  minSupportedVersion: "",
  mandatory: false,
  assets: {},
};

/**
 * The button under a real `UpdateGate`, the way `main.tsx` mounts the shell,
 * with the updater's event stream in the test's hands. Only the five updater
 * methods exist: the button must not reach for anything else.
 */
function renderButton() {
  let listener: (event: AppUpdateEvent) => void = () => {};
  const spies = {
    checkAppUpdate: vi.fn(async () => ({ status: { ...STATUS, updateAvailable: false }, release: null })),
    onAppUpdateEvent: vi.fn((next: (event: AppUpdateEvent) => void) => {
      listener = next;
      return () => {};
    }),
    downloadAppUpdate: vi.fn(async () => "/tmp/OfficeDex.zip"),
    installAppUpdate: vi.fn(async () => undefined),
    cancelAppUpdate: vi.fn(async () => undefined),
  };
  const view = render(
    <UpdateGate api={spies as unknown as DesktopAPI}>
      <UpdateButton />
    </UpdateGate>,
  );
  return { view, spies, emit: (event: AppUpdateEvent) => act(() => listener(event)) };
}

describe("UpdateButton", () => {
  it("is absent until an optional update is reported", () => {
    const { view, emit } = renderButton();
    expect(view.container.querySelector(".shell-update-button")).toBeNull();

    emit({ type: "status", status: STATUS, release: RELEASE });
    const button = screen.getByRole("button", {
      name: "OfficeDex 10.0.0 is available — click to download and update",
    });
    expect(button.querySelector(".shell-update-dot")).not.toBeNull();
  });

  it("downloads on press, shows progress, then restarts only after a confirm", async () => {
    const { spies, emit } = renderButton();
    emit({ type: "status", status: STATUS, release: RELEASE });

    fireEvent.click(screen.getByRole("button", { name: /is available/ }));
    await waitFor(() => expect(spies.downloadAppUpdate).toHaveBeenCalledTimes(1));

    emit({ type: "progress", bytesDone: 40, bytesTotal: 100 });
    const busy = screen.getByRole("button", { name: "Downloading OfficeDex 10.0.0… 40%" });
    expect(busy.querySelector(".shell-update-ring")).not.toBeNull();
    expect(busy.querySelector(".shell-update-dot")).toBeNull();
    fireEvent.click(busy);
    expect(spies.downloadAppUpdate).toHaveBeenCalledTimes(1);

    emit({ type: "downloaded", downloadedPath: "/tmp/OfficeDex.zip" });
    const ready = screen.getByRole("button", {
      name: "OfficeDex 10.0.0 is ready — click to restart and update",
    });
    expect(ready.querySelector(".shell-update-dot")).not.toBeNull();

    // "Later" leaves everything where it was.
    fireEvent.click(ready);
    // The shared dialog host gives its panel no accessible name, so the title is
    // checked as text.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Restart to install OfficeDex 10.0.0?");
    expect(dialog).toHaveTextContent("Save anything you're editing first.");
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(spies.installAppUpdate).not.toHaveBeenCalled();

    // Confirming is what installs.
    fireEvent.click(ready);
    fireEvent.click(await screen.findByRole("button", { name: "Restart and update" }));
    await waitFor(() => expect(spies.installAppUpdate).toHaveBeenCalledTimes(1));
  });

  it("offers a retry after a failed download", async () => {
    const { spies, emit } = renderButton();
    emit({ type: "status", status: STATUS, release: RELEASE });
    fireEvent.click(screen.getByRole("button", { name: /is available/ }));
    await waitFor(() => expect(spies.downloadAppUpdate).toHaveBeenCalledTimes(1));

    emit({ type: "error", message: "checksum mismatch" });
    const retry = screen.getByRole("button", {
      name: "Couldn't update to OfficeDex 10.0.0 — click to try again",
    });
    expect(retry.querySelector(".shell-update-dot")).not.toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(spies.downloadAppUpdate).toHaveBeenCalledTimes(2));
  });

  it("stays out of the way of a mandatory update, which owns the window instead", () => {
    const { view, emit } = renderButton();
    emit({
      type: "status",
      status: { ...STATUS, mandatory: true },
      release: { ...RELEASE, mandatory: true },
    });
    expect(view.container.querySelector(".shell-update-button")).toBeNull();
  });

  it("renders nothing outside the desktop app, where there is no updater", () => {
    const view = render(
      <UpdateGate api={null}>
        <UpdateButton />
      </UpdateGate>,
    );
    expect(view.container.querySelector(".shell-update-button")).toBeNull();
  });
});

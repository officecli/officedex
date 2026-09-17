import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "../shared/types";
import {
  NOTIFICATIONS_STORAGE_KEY,
  maybeNotify,
  readNotificationsEnabled,
  setNotificationsEnabled,
} from "./notifications";

const mocks = vi.hoisted(() => ({
  sendDesktopNotification: vi.fn(async () => undefined),
}));

const api = { sendDesktopNotification: mocks.sendDesktopNotification } as unknown as DesktopAPI;

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

function setDocumentFocused(focused: boolean) {
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => focused,
  });
}

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

describe("desktop notifications", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    mocks.sendDesktopNotification.mockClear();
    setDocumentHidden(true);
    setDocumentFocused(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults notifications to enabled and persists opt out", () => {
    expect(readNotificationsEnabled()).toBe(true);

    setNotificationsEnabled(false);

    expect(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY)).toBe("false");
    expect(readNotificationsEnabled()).toBe(false);
  });

  it("notifies through the desktop bridge when enabled and the document is hidden", async () => {
    maybeNotify(api, { title: "OfficeDex", body: "Generation finished" });

    await vi.waitFor(() =>
      expect(mocks.sendDesktopNotification).toHaveBeenCalledWith({
        title: "OfficeDex",
        body: "Generation finished",
      }),
    );
  });

  it("notifies while the document is focused", async () => {
    setDocumentHidden(false);
    setDocumentFocused(true);

    maybeNotify(api, { title: "OfficeDex", body: "Generation finished" });

    await vi.waitFor(() =>
      expect(mocks.sendDesktopNotification).toHaveBeenCalledWith({
        title: "OfficeDex",
        body: "Generation finished",
      }),
    );
  });

  it("notifies when the app window is unfocused even if the document stays visible", async () => {
    setDocumentHidden(false);
    setDocumentFocused(false);

    maybeNotify(api, { title: "OfficeDex", body: "Generation finished" });

    await vi.waitFor(() =>
      expect(mocks.sendDesktopNotification).toHaveBeenCalledWith({
        title: "OfficeDex",
        body: "Generation finished",
      }),
    );
  });

  it("does not notify when notifications are disabled", () => {
    setNotificationsEnabled(false);

    maybeNotify(api, { title: "OfficeDex", body: "Generation finished" });

    expect(mocks.sendDesktopNotification).not.toHaveBeenCalled();
  });

  it("ignores desktop bridge failures", async () => {
    mocks.sendDesktopNotification.mockRejectedValueOnce(new Error("permission denied"));

    maybeNotify(api, { title: "OfficeDex", body: "Generation finished" });

    await vi.waitFor(() => expect(mocks.sendDesktopNotification).toHaveBeenCalledTimes(1));
  });
});

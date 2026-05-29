import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATIONS_STORAGE_KEY,
  maybeNotify,
  readNotificationsEnabled,
  setNotificationsEnabled,
} from "./notifications";

class NotificationStub {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static constructed: Array<{ title: string; options?: NotificationOptions }> = [];

  constructor(title: string, options?: NotificationOptions) {
    NotificationStub.constructed.push({ title, options });
  }
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
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
    NotificationStub.permission = "granted";
    NotificationStub.requestPermission.mockClear();
    NotificationStub.constructed = [];
    vi.stubGlobal("Notification", NotificationStub);
    setDocumentHidden(true);
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

  it("notifies when enabled and the document is hidden", () => {
    maybeNotify({ title: "OfficeDex", body: "Generation finished" });

    expect(NotificationStub.constructed).toEqual([
      { title: "OfficeDex", options: { body: "Generation finished" } },
    ]);
  });

  it("does not notify while the document is focused", () => {
    setDocumentHidden(false);

    maybeNotify({ title: "OfficeDex", body: "Generation finished" });

    expect(NotificationStub.constructed).toHaveLength(0);
  });

  it("does not notify when notifications are disabled", () => {
    setNotificationsEnabled(false);

    maybeNotify({ title: "OfficeDex", body: "Generation finished" });

    expect(NotificationStub.constructed).toHaveLength(0);
  });

  it("requests permission before notifying when permission is default", async () => {
    NotificationStub.permission = "default";

    maybeNotify({ title: "OfficeDex", body: "Generation finished" });
    await vi.waitFor(() => expect(NotificationStub.requestPermission).toHaveBeenCalledTimes(1));

    expect(NotificationStub.constructed).toEqual([
      { title: "OfficeDex", options: { body: "Generation finished" } },
    ]);
  });
});

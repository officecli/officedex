/**
 * Whether the machine has a connection — OD-UI-1.2 §13.
 *
 * Offline is a state of the workspace, not an error, so what the browser reports
 * has to reach the UI as it changes rather than only at mount. The hold is the
 * review fixture's seam: it lets the offline state be looked at without pulling
 * a cable, and `reconnect()` is what hands the question back to the browser.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { holdOnline, reconnect, useOnline } from "./useOnline";

afterEach(() => {
  holdOnline(null);
  cleanup();
  vi.unstubAllGlobals();
});

/** Mounts the hook and reports what it says now. */
function mountOnline(): { current: () => boolean; renders: () => number } {
  let value = true;
  let renders = 0;
  function Probe() {
    value = useOnline();
    renders += 1;
    return null;
  }
  render(<Probe />);
  return { current: () => value, renders: () => renders };
}

/** navigator.onLine is read-only in jsdom; a stub is the only way to move it. */
const setNavigatorOnLine = (online: boolean) =>
  vi.stubGlobal("navigator", { ...navigator, onLine: online });

describe("useOnline", () => {
  it("starts from what the browser reports", () => {
    expect(mountOnline().current()).toBe(true);
  });

  it("follows the window's own online and offline events", () => {
    const online = mountOnline();

    setNavigatorOnLine(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(online.current()).toBe(false);

    setNavigatorOnLine(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(online.current()).toBe(true);
  });

  it("stops listening once the last reader unmounts", () => {
    const online = mountOnline();
    const before = online.renders();
    cleanup();
    setNavigatorOnLine(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(online.renders()).toBe(before);
  });
});

describe("holdOnline", () => {
  it("overrides the browser and tells every reader at once", () => {
    const first = mountOnline();
    const second = mountOnline();

    act(() => holdOnline(false));
    expect(first.current()).toBe(false);
    expect(second.current()).toBe(false);

    // While held, the browser's own events do not get a say.
    setNavigatorOnLine(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(first.current()).toBe(false);
  });

  it("hands the question back to the browser when released", () => {
    const online = mountOnline();
    act(() => holdOnline(false));
    expect(online.current()).toBe(false);

    act(() => holdOnline(null));
    expect(online.current()).toBe(true);
  });

  // A hold of `true` is a hold like any other, not a synonym for released.
  it("can also hold the workspace online", () => {
    const online = mountOnline();
    setNavigatorOnLine(false);
    act(() => holdOnline(true));
    expect(online.current()).toBe(true);
  });
});

describe("reconnect", () => {
  it("releases the hold and reports what the browser now says", () => {
    const online = mountOnline();
    act(() => holdOnline(false));

    setNavigatorOnLine(true);
    let found = false;
    act(() => {
      found = reconnect();
    });
    expect(found).toBe(true);
    expect(online.current()).toBe(true);
  });

  it("says so when there is still no connection", () => {
    const online = mountOnline();
    act(() => holdOnline(false));

    setNavigatorOnLine(false);
    let found = true;
    act(() => {
      found = reconnect();
    });
    expect(found).toBe(false);
    // Released, but the browser is the one saying no now.
    expect(online.current()).toBe(false);
  });
});

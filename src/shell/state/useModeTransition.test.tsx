import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seedSettings } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { MODE_SWITCHING_ATTRIBUTE, MODE_TRANSITION_MS } from "./useModeTransition";

afterEach(cleanup);

/**
 * The mode switch's one moving part, at the level the rest of the shell sees
 * it: an attribute on the root that goes up for exactly one transition.
 *
 * Nothing here asserts what the animation *looks* like — that is CSS, and
 * `test/combinationSelectors.test.ts` is what keeps those rules honest about
 * which shells they cover. What this file protects is the contract between the
 * two: that the flag appears for a real mode change, that it goes away again
 * without anybody touching it, that it is spelled the way the stylesheets read
 * it, and that either Reduced motion switch skips it outright.
 */

const switching = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("#shell")!.getAttribute(MODE_SWITCHING_ATTRIBUTE);

describe("the mode transition", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("raises the switching flag on a mode change and drops it when the transition is over", async () => {
    const shell = await renderShell();
    expect(switching(shell.view.container)).toBe("false");

    vi.useFakeTimers();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    expect(switching(shell.view.container)).toBe("true");

    // Still up one tick short of the transition's length: the workspace is
    // pinned for this whole window, and releasing it early would hand the
    // embedded editor a second layout pass mid-animation.
    await act(async () => {
      vi.advanceTimersByTime(MODE_TRANSITION_MS - 1);
    });
    expect(switching(shell.view.container)).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(switching(shell.view.container)).toBe("false");
  });

  it("restarts the window when the mode changes again mid-transition", async () => {
    const shell = await renderShell();

    vi.useFakeTimers();
    await shell.dispatch({ type: "set-mode", mode: "editor" });
    await act(async () => {
      vi.advanceTimersByTime(MODE_TRANSITION_MS - 20);
    });
    await shell.dispatch({ type: "set-mode", mode: "agent" });

    // The first switch's timer must not clear the second switch's flag.
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    expect(switching(shell.view.container)).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(MODE_TRANSITION_MS);
    });
    expect(switching(shell.view.container)).toBe("false");
  });

  it("does not raise it for a dispatch that leaves the mode alone", async () => {
    const shell = await renderShell();

    await shell.dispatch({ type: "set-mode", mode: "agent" });
    expect(shell.state().mode).toBe("agent");
    expect(switching(shell.view.container)).toBe("false");

    // Nor for a change to some other axis of the same state: the sidebar has
    // its own width transition and does not borrow this one.
    await shell.dispatch({ type: "toggle-nav" });
    expect(switching(shell.view.container)).toBe("false");
  });

  it("switches instantly when the in-app Reduced motion setting is on", async () => {
    const shell = await renderShell({ settings: { ...seedSettings(), reduceMotion: true } });
    // The preference arrives through the port, so let its first read land.
    await act(async () => {});

    await shell.dispatch({ type: "set-mode", mode: "editor" });

    // The mode itself still changes — this is a visual layer and nothing else.
    expect(shell.state().mode).toBe("editor");
    expect(switching(shell.view.container)).toBe("false");
  });
});

describe("the mode transition under a system that asks for reduced motion", () => {
  beforeEach(() => {
    // The stub in `renderer/test/setup.ts` answers `false` to every query;
    // this replaces it for the reduce case only, and is undone below.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never enters the animated path, whatever the in-app setting says", async () => {
    const shell = await renderShell();

    await shell.dispatch({ type: "set-mode", mode: "editor" });

    expect(shell.state().mode).toBe("editor");
    expect(switching(shell.view.container)).toBe("false");
  });
});

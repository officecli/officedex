import { act, render, waitFor, type RenderResult } from "@testing-library/react";

import { App } from "../App";
import { PortProvider } from "../port/PortContext";
import { createFakePort, type FakePortOptions } from "../port/fake/createFakePort";
import type { UiPort } from "../port/types";
import { ShellProvider, useShell } from "../state/ShellContext";
import type { ShellAction, ShellState } from "../state/shellReducer";

interface ShellHarness {
  view: RenderResult;
  port: UiPort;
  /** Dispatch a reducer action the way a real control would. */
  dispatch: (action: ShellAction) => Promise<void>;
  state: () => ShellState;
  /** The persistent canvas host element, by its stable data attribute. */
  canvasHost: () => HTMLElement;
}

export interface RenderShellOptions extends FakePortOptions {
  /**
   * Collapses the fake agent's scripted delays to ~1ms so a test can await the
   * real sequence instead of installing fake timers. Fake timers cannot be used
   * here: Testing Library's `waitFor` needs a running clock, and this harness
   * awaits one during mount.
   */
  fastAgent?: boolean;
}

/**
 * Mounts the shell against a fresh fake port and waits for the workspace to
 * load. StrictMode is left off here: it double-invokes effects, which makes
 * assertions about mount/unmount counts harder to read without testing
 * anything the production entry does not already exercise.
 */
export async function renderShell(options: RenderShellOptions = {}): Promise<ShellHarness> {
  localStorage.clear();

  const { fastAgent, ...portOptions } = options;
  const port = createFakePort(
    fastAgent
      ? {
          ...portOptions,
          setTimeout: (fn) => setTimeout(fn, 1),
          clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        }
      : portOptions,
  );
  let captured: { state: ShellState; dispatch: (action: ShellAction) => void } | null = null;

  function Probe() {
    const { state, dispatch } = useShell();
    captured = { state, dispatch };
    return null;
  }

  const view = render(
    <PortProvider port={port}>
      <ShellProvider>
        <Probe />
        <App />
      </ShellProvider>
    </PortProvider>,
  );

  await waitFor(() => {
    if (!view.container.querySelector('#shell[data-loaded="true"]')) {
      throw new Error("shell has not loaded");
    }
  });

  const requireCaptured = () => {
    if (!captured) throw new Error("shell state was never captured");
    return captured;
  };

  return {
    view,
    port,
    async dispatch(action) {
      await act(async () => {
        requireCaptured().dispatch(action);
      });
    },
    state: () => requireCaptured().state,
    canvasHost() {
      const host = view.container.querySelector<HTMLElement>("[data-canvas-host]");
      if (!host) throw new Error("canvas host is not in the document");
      return host;
    },
  };
}

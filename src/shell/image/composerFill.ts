import { useEffect, useRef } from "react";

/**
 * "Put these words in the composer" — from anywhere to the one composer.
 *
 * The workspace's "Create another" tile and the composer are in different
 * columns of the shell: one is inside `<main className="shell-workspace">`, the
 * other inside the agent panel, and nothing owns both. `Composer` already
 * exposes `onRegisterFill` for exactly this, but only to whoever renders it —
 * which is the panel, not the canvas.
 *
 * So this is the seam: three lines of module-level fan-out rather than lifting
 * a text field into a provider that every keystroke would re-render. The
 * docked/floating composer subscribes; Home's does not, because a suggestion
 * aimed at the picture on the canvas has no meaning on a screen with no canvas.
 */

type Listener = (text: string) => void;

const listeners = new Set<Listener>();

export function requestComposerFill(text: string): void {
  for (const listener of [...listeners]) listener(text);
}

export function useComposerFillRequests(onFill: (text: string) => void): void {
  const latest = useRef(onFill);

  useEffect(() => {
    latest.current = onFill;
  });

  useEffect(() => {
    const listener: Listener = (text) => latest.current(text);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

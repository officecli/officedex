import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import type { Mode } from "./shellReducer";

/**
 * The one mechanism behind the mode switch's animation.
 *
 * Every entry point into a mode change dispatches `set-mode` and nothing else —
 * the brand menu (`chrome/ModeMenu.tsx`), the task panel's "open in Editor"
 * (`agent/TaskPanel.tsx`), and whatever comes next. So the animation is not
 * attached to any of them: it watches the *result*, the `mode` the shell is
 * rendering, and writes one attribute on the root that every affected region's
 * CSS keys off. A control that changes the mode gets the transition for free
 * and cannot get a different one.
 *
 * `#shell[data-mode-switching="true"]` is what the stylesheets read; see the
 * "mode switch" section of `app.css` for what each region does with it.
 */
export const MODE_SWITCHING_ATTRIBUTE = "data-mode-switching";

/**
 * How long the switch takes, in milliseconds.
 *
 * This is `--shell-duration` (tokens.css, Motion) restated, for the same reason
 * `AgentPresence.DOCK_TRANSITION_MS` restates it: a `setTimeout` cannot read a
 * custom property that has not been applied to an element yet. The two numbers
 * being equal is not a coincidence to be tidied away — the docked column's
 * collapse *is* part of this transition, and the presence holds its panel's
 * content for exactly that long so the column never animates shut around an
 * empty box. Change one and change all three.
 */
export const MODE_TRANSITION_MS = 280;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(REDUCED_MOTION);
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const media = reducedMotionQuery();
  if (!media) return () => {};
  // `addListener` is the pre-2021 spelling; WKWebView on the oldest macOS this
  // ships to has the modern one, but a shim that only ever registers nothing
  // would make the hook silently static, so both are tried.
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }
  media.addListener(onChange);
  return () => media.removeListener(onChange);
}

const readReducedMotion = () => reducedMotionQuery()?.matches === true;

/**
 * The system's Reduce motion switch, live.
 *
 * The CSS half of this preference is already handled — `tokens.css` collapses
 * `--shell-duration` to 1ms under the same query — but the JavaScript half
 * matters too: with the attribute set for the length of the transition, the
 * workspace would still be pinned out of flow while nothing moved. Reading it
 * here means a
 * reduced-motion switch is genuinely instantaneous rather than an animation
 * with its durations zeroed.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, readReducedMotion, () => false);
}

/**
 * Marks the shell as mid-mode-change for exactly one transition.
 *
 * Returns the ref to put on the shell root. The attribute is written straight
 * to the DOM rather than rendered from state, which is deliberate on two
 * counts:
 *
 *  - React never re-renders for it. A mode change already re-renders the whole
 *    shell once; adding a second render when the flag goes up and a third when
 *    it comes down would put two full reconciliations inside the transition
 *    the animation is trying to keep smooth.
 *  - A `useLayoutEffect` runs after the commit and *before paint*, so the
 *    attribute lands in the same frame as the new `data-mode`. That is the
 *    whole ballgame for the canvas: if the workspace were pinned one frame
 *    late, the embedded editor would already have been laid out once at an
 *    intermediate width.
 *
 * `reduceMotion` is the in-app preference (`useReduceMotion`); the system
 * preference is read here. Either one skips the animated path entirely — the
 * mode changes in one frame, with no attribute and therefore no rule from the
 * mode-switch section applying to anything.
 */
export function useModeTransition(mode: Mode, reduceMotion: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const previousMode = useRef(mode);
  const timer = useRef<number | null>(null);
  const systemReducedMotion = usePrefersReducedMotion();
  const still = reduceMotion || systemReducedMotion;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const changed = previousMode.current !== mode;
    previousMode.current = mode;

    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }

    // `!changed` covers the first commit and a change of the motion preference
    // itself; `still` covers a real mode change the user has asked not to be
    // animated. Both end in the same resting state, written rather than absent
    // so the root always says which of the two phases it is in.
    if (!changed || still) {
      root.setAttribute(MODE_SWITCHING_ATTRIBUTE, "false");
      return;
    }

    root.setAttribute(MODE_SWITCHING_ATTRIBUTE, "true");
    timer.current = window.setTimeout(() => {
      timer.current = null;
      // Through the ref, not the captured `root`: the shell can be torn down
      // inside the window, and a detached node is not worth writing to.
      ref.current?.setAttribute(MODE_SWITCHING_ATTRIBUTE, "false");
    }, MODE_TRANSITION_MS);
  }, [mode, still]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return ref;
}

import { useEffect, useRef } from "react";

import flatInkSvg from "../assets/dex/officedex-agent-flat-ink.svg?raw";
import { useReduceMotion } from "../composer/useComposerSettings";
import { mountDexFace, type DexFaceHandle, type DexState } from "./faceRenderer";

/** The approved round Dex, as markup — the renderer adopts its nodes. */
export const DEX_FLAT_INK_SVG = flatInkSvg;

/**
 * The rounded-square brand face: Home tab (22px), author label (20px).
 *
 * Quiet mood and no pointer tracking, as the prototype mounts every `.face`.
 * The size comes from the stylesheet (`.dx-face`, `.dx-face.tiny`, `.large`).
 */
export function DexFace({
  state = "ready",
  variant,
}: {
  state?: DexState;
  variant?: "tiny" | "large";
}) {
  const host = useRef<HTMLSpanElement>(null);
  const handle = useRef<DexFaceHandle | null>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!host.current) return;
    handle.current = mountDexFace(host.current, { state, mood: "quiet", look: "float" });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    // Mounted once; state and motion are pushed through the handle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.setState(state);
  }, [state]);

  useEffect(() => {
    handle.current?.setAnimate(!reduceMotion);
  }, [reduceMotion]);

  return <span ref={host} className={variant ? `dx-face dx-${variant}` : "dx-face"} data-face={state} aria-hidden="true" />;
}

/**
 * The round flat-ink Dex with live expressions — the 42px bubble's drawing.
 */
export function DexAvatar({ state, track = true }: { state: DexState; track?: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const handle = useRef<DexFaceHandle | null>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!host.current) return;
    handle.current = mountDexFace(host.current, {
      svg: DEX_FLAT_INK_SVG,
      state,
      track,
      mood: "friendly",
      look: "float",
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.setState(state);
  }, [state]);

  useEffect(() => {
    handle.current?.setAnimate(!reduceMotion);
  }, [reduceMotion]);

  return <span ref={host} className="dx-dex-avatar" aria-hidden="true" />;
}

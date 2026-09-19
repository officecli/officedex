import { useEffect, useState } from "react";

import type { Viewport } from "./presenceLayout";

/** SSR and jsdom have no window; the shell's design size stands in. */
const FALLBACK: Viewport = { width: 1440, height: 900 };

function read(): Viewport {
  if (typeof window === "undefined") return FALLBACK;
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * The viewport, as state.
 *
 * `useDraggable` used to read `window.innerWidth` inside a callback, which
 * meant a resize could not re-render anything by itself — so the only way the
 * presence could follow a window change was to *write* a clamped position into
 * persisted state on every resize. That is what destroyed the "never placed"
 * sentinel and left the presence stranded mid-canvas after the window grew
 * (S4-015). Reading the viewport as state instead lets the default landing
 * point re-derive itself and keeps the persisted position untouched until the
 * user actually drags something.
 */
export function useViewportSize(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(read);

  useEffect(() => {
    const onResize = () => {
      setViewport((current) => {
        const next = read();
        return next.width === current.width && next.height === current.height ? current : next;
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return viewport;
}

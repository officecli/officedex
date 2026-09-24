import { useEffect, useRef } from "react";

import bodyDark from "./assets/od-mark/agent-body.png";
import inkDark from "./assets/od-mark/agent-body-ink.png";
import dotDark from "./assets/od-mark/agent-dot.png";
import bodyLight from "./assets/od-mark/agent-body-light.png";
import inkLight from "./assets/od-mark/agent-body-ink-light.png";
import dotLight from "./assets/od-mark/agent-dot-light.png";
import "./odMark.css";

export interface OdMarkProps {
  /** Display size in CSS pixels. Canvas rider is 96; cursor badge is 20. */
  size?: number;
  /**
   * Eyes may look at `--gaze-x/--gaze-y`. Off for marks that sit outside the
   * canvas (a 20px header face would pin at the extremes).
   */
  tracksGaze?: boolean;
  /**
   * `dark` is the ink plate, for a light surface (the sidebar brand, a menu
   * row, the canvas rider). `light` is the white plate, for a dark surface.
   */
  tone?: "dark" | "light";
  className?: string;
}

const DARK = { body: bodyDark, ink: inkDark, dot: dotDark };
const LIGHT = { body: bodyLight, ink: inkLight, dot: dotLight };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * The brand mark, layered so only the eyes and the top-right square move.
 *
 * Artwork is the official 512×512 agent PNG split offline into body / ink /
 * square. Do not redraw it, and do not add limbs or props.
 */
export function OdMark({ size = 96, tracksGaze = false, tone = "dark", className }: OdMarkProps) {
  const markRef = useRef<HTMLSpanElement>(null);
  const assets = tone === "light" ? LIGHT : DARK;

  useEffect(() => {
    const mark = markRef.current;
    if (!mark || prefersReducedMotion()) return;
    let cancelled = false;
    let timer = 0;
    const schedule = (delay: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        mark.classList.remove("is-blink");
        void mark.offsetWidth;
        mark.classList.add("is-blink");
        window.setTimeout(() => mark.classList.remove("is-blink"), 240);
        const again = Math.random() < 0.18;
        if (again) {
          window.setTimeout(() => {
            if (cancelled) return;
            mark.classList.remove("is-blink");
            void mark.offsetWidth;
            mark.classList.add("is-blink");
            window.setTimeout(() => mark.classList.remove("is-blink"), 240);
          }, 220);
        }
        schedule(2200 + Math.random() * 3000);
      }, delay);
    };
    schedule(900 + Math.random() * 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const mark = markRef.current;
    if (!mark || tracksGaze) return;
    mark.style.setProperty("--gaze-x", "0");
    mark.style.setProperty("--gaze-y", "0");
  }, [tracksGaze]);

  return (
    <span
      ref={markRef}
      className={["od-mark", className].filter(Boolean).join(" ")}
      style={{ ["--mark-size" as string]: `${size}px` }}
      data-tone={tone}
      data-gaze={tracksGaze ? "on" : "off"}
      aria-hidden="true"
    >
      <img className="od-mark__ink" src={assets.ink} alt="" />
      <span className="od-mark__eye od-mark__eye--l"><i /></span>
      <span className="od-mark__eye od-mark__eye--r"><i /></span>
      <img className="od-mark__body" src={assets.body} alt="" />
      <img className="od-mark__dot" src={assets.dot} alt="" />
    </span>
  );
}

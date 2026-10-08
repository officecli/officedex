import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { DesktopTask } from "../../../shared/types";
import { useT } from "../../../renderer/i18n";
import { AttentionOverlay } from "../../agent/attentionOverlay";
import { OdMark } from "../../agent/OdMark";
import { gazeToward } from "./markGaze";
import {
  pickSpot,
  riderCandidates,
  ringEdgeRects,
  type Rect,
  type RiderTarget,
} from "./markPlacement";
import {
  generationCanvasPhase,
  generationMotionQuiet,
  type GenerationCanvasPhase,
} from "./pptxGenerationPhase";
import { slideCopyFromTask } from "./slideCopy";
import "./slidesGenerating.css";

const MARK_SIZE = 128;
const PHASE_STATUS: Record<GenerationCanvasPhase, string> = {
  research: "shell.canvas.gen.research",
  outline: "shell.canvas.gen.outline",
  writing: "shell.canvas.gen.writing",
  drawing: "shell.canvas.gen.drawing",
  polish: "shell.canvas.gen.polish",
};

function shownNow(element: Element | null, root: HTMLElement): boolean {
  if (!element || !(element as HTMLElement).offsetParent) return false;
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.05) return false;
  }
  return true;
}

function localBox(element: Element, origin: DOMRect): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
}

export function SlidesGenerating({ task }: { task: DesktopTask }) {
  const t = useT();
  const phase = generationCanvasPhase(task) ?? "outline";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, []);
  const quiet = generationMotionQuiet(task, now) && (phase === "drawing" || phase === "polish");
  const status = t(PHASE_STATUS[phase]);
  const copy = slideCopyFromTask(task, phase);
  const showFilmstrip = phase !== "research";
  const showPaper = phase !== "research";
  const thumbCount = Math.min(8, Math.max(5, copy.totalSlides));
  const currentThumb = Math.max(0, Math.min(thumbCount - 1, copy.currentSlide - 1));

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const riderRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<AttentionOverlay | null>(null);
  const ringRectRef = useRef<Rect | null>(null);
  const lastPointRef = useRef({ x: 40, y: 40 });
  const riderTargetRef = useRef<RiderTarget | null>(null);
  const focusRef = useRef<{ x: number; y: number; sweep: number | null } | null>(null);

  const [land, setLand] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const overlay = new AttentionOverlay(stage);
    overlayRef.current = overlay;
    return () => {
      overlay.dispose();
      overlayRef.current = null;
    };
  }, []);

  const place = () => {
    const stage = stageRef.current;
    const slide = slideRef.current;
    const rider = riderRef.current;
    if (!stage || !rider) return;
    const origin = stage.getBoundingClientRect();
    const boxOf = (el: Element | null): Rect | null => (el ? localBox(el, origin) : null);
    const stageBox: Rect = { x: 0, y: 0, w: stage.clientWidth, h: stage.clientHeight };

    const targets: Record<string, Rect | null> = {
      panel: boxOf(panelRef.current),
      copy: boxOf(copyRef.current),
      visual: boxOf(visualRef.current),
      slide: slide ? boxOf(slide) : stageBox,
    };

    const ringAnchor = phase === "research" ? "panel" : "slide";
    const cursorAnchor = phase === "writing" ? "copy"
      : phase === "drawing" ? "visual"
      : ringAnchor;
    let ringTarget = targets[ringAnchor] ?? targets.slide;
    if (!ringTarget || ringTarget.w < 2 || ringTarget.h < 2) ringTarget = targets.slide ?? stageBox;
    if (!ringTarget) return;
    let cursorTarget = targets[cursorAnchor] ?? ringTarget;
    if (!cursorTarget || cursorTarget.w < 2 || cursorTarget.h < 2) cursorTarget = ringTarget;

    const inset = ringAnchor === "slide";
    const px = cursorTarget.x + cursorTarget.w * (phase === "writing" ? 0.28 : 0.5);
    const py = cursorTarget.y + cursorTarget.h * 0.42;
    lastPointRef.current = { x: px, y: py };
    riderTargetRef.current = inset ? { ...ringTarget, inset: true } : cursorTarget;

    const cursor = cursorRef.current;
    if (cursor && !quiet) {
      cursor.classList.add("is-on", "is-move");
      cursor.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
      cursor.classList.remove("is-click");
      void cursor.offsetWidth;
      cursor.classList.add("is-click");
    } else if (cursor) {
      cursor.classList.remove("is-on");
    }

    const overlay = overlayRef.current;
    if (overlay && !quiet) {
      const ring = { x: ringTarget.x - 8, y: ringTarget.y - 8, w: ringTarget.w, h: ringTarget.h };
      ringRectRef.current = ring;
      overlay.focus({ left: ring.x, top: ring.y, width: Math.max(1, ringTarget.w + 16), height: Math.max(1, ringTarget.h + 16), radius: 14 });
    } else {
      ringRectRef.current = null;
      overlay?.hide(true);
    }

    const blocks: Rect[] = [];
    const push = (rect: DOMRect | Rect, soft: boolean) => {
      const local: Rect = "left" in rect
        ? { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height, soft }
        : { ...rect, soft };
      if (local.w < 1.5 || local.h < 1.5) return;
      blocks.push(local);
    };

    if (panelRef.current && (phase === "research" || shownNow(panelRef.current, stage))) {
      push(panelRef.current.getBoundingClientRect(), false);
    }
    if (ringRectRef.current) blocks.push(...ringEdgeRects(ringRectRef.current));

    const size = rider.offsetWidth || MARK_SIZE;
    const maxX = stage.clientWidth - size - 6;
    const maxY = stage.clientHeight - size - 6;
    const fits = (x: number, y: number) => x >= 4 && y >= 4 && x <= maxX && y <= maxY;
    const candidates = riderCandidates(riderTargetRef.current, lastPointRef.current, size);
    const picked = pickSpot(candidates, size, fits, blocks);
    const x = Math.max(4, Math.min(picked.spot[0], maxX));
    const y = Math.max(4, Math.min(picked.spot[1], maxY));
    if (phase === "research") rider.style.removeProperty("transform");
    else rider.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    rider.dataset.pick = String(picked.index);
    rider.dataset.forced = picked.forced ? "1" : "0";

    focusRef.current = { x: cursorTarget.x + cursorTarget.w * 0.5, y: cursorTarget.y + cursorTarget.h * 0.5, sweep: null };
    setLand(true);
  };

  useLayoutEffect(() => {
    place();
    // phase/quiet are the placement triggers; resize is observed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, quiet, currentThumb, thumbCount]);

  useEffect(() => {
    if (!land) return;
    const handle = window.setTimeout(() => setLand(false), 520);
    return () => window.clearTimeout(handle);
  }, [land]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place());
    observer.observe(stage);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const stage = stageRef.current;
      const rider = riderRef.current;
      const mark = rider?.querySelector(".od-mark") as HTMLElement | null;
      if (stage && mark && focusRef.current) {
        const origin = stage.getBoundingClientRect();
        const focus = focusRef.current;
        const box = mark.getBoundingClientRect();
        if (box.width) {
          const { gx, gy } = gazeToward(focus, {
            x: box.left - origin.left + box.width / 2,
            y: box.top - origin.top + box.height / 2,
          }, focus.sweep);
          mark.style.setProperty("--gaze-x", gx.toFixed(3));
          mark.style.setProperty("--gaze-y", gy.toFixed(3));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  return (
    <div
      ref={rootRef}
      className="shell-canvas-scroll shell-canvas-scroll--slides shell-gen"
      data-phase={phase}
      data-quiet={quiet ? "true" : "false"}
      data-testid="shell-slides-generating"
    >
      {showFilmstrip ? (
        <div className="shell-gen-filmstrip" aria-hidden="true">
          {Array.from({ length: thumbCount }, (_, index) => (
            <span
              key={index}
              className={`shell-gen-thumb${index === currentThumb ? " is-current" : ""}`}
              style={{ ["--i" as string]: String(index) }}
            >
              <i className="shell-gen-thumb-title" />
              <i className="shell-gen-thumb-line" />
              <i className="shell-gen-thumb-line" />
              <i className="shell-gen-thumb-block" />
            </span>
          ))}
        </div>
      ) : null}
      <div className="shell-gen-stage" ref={stageRef}>
        {showPaper ? (
          <div className="shell-gen-slide is-sketch" ref={slideRef} data-phase={phase} key={phase}>
            <div className="shell-gen-sketch-copy" ref={copyRef}>
              <span className="shell-skeleton-line shell-skeleton-line--title" />
              <span className="shell-skeleton-line" style={{ width: "48%" }} />
              <span className="shell-skeleton-line" style={{ width: "88%" }} />
              <span className="shell-skeleton-line" style={{ width: "76%" }} />
              <span className="shell-skeleton-line" style={{ width: "62%" }} />
            </div>
            <div className="shell-gen-sketch-visual" ref={visualRef}>
              <span className="shell-skeleton-block shell-skeleton-block--slide" />
            </div>
          </div>
        ) : null}

        <div className="shell-gen-overlay" aria-hidden="true">
          <div className="shell-gen-cast">
            <div className={`shell-gen-rider actor${land ? " is-land" : ""}`} ref={riderRef}>
              <OdMark size={MARK_SIZE} tracksGaze />
            </div>
            <div className="shell-gen-panel" ref={panelRef}>
              <div className="hd"><i />{t("shell.canvas.gen.searching")}</div>
              <div className="row"><span className="fav" /><span className="ln" style={{ ["--w" as string]: "86%" }} /></div>
              <div className="row"><span className="fav" /><span className="ln" style={{ ["--w" as string]: "64%" }} /></div>
              <div className="row"><span className="fav" /><span className="ln" style={{ ["--w" as string]: "78%" }} /></div>
              <div className="row"><span className="fav" /><span className="ln" style={{ ["--w" as string]: "56%" }} /></div>
              <div className="shell-gen-scan" />
            </div>
          </div>
          <div className="shell-gen-cursor" ref={cursorRef}>
            <span className="ripple" />
            <svg className="arrow" width="20" height="22" viewBox="0 0 16 18" aria-hidden="true">
              <path
                d="M1 1 L1 14.4 L4.6 11 L6.9 16.6 L9.4 15.5 L7.1 10.1 L11.7 9.7 Z"
                fill="currentColor"
                stroke="var(--shell-ink-inverse)"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
            <span className="label">{status}</span>
          </div>
        </div>

        <div className="shell-gen-pill" role="status" aria-live="polite">
          <span>{status}</span>
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        </div>
      </div>
    </div>
  );
}

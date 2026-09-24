import { useEffect, useRef } from "react";

import { useCanvasSurface } from "../editor/canvasSurface";
import { AttentionOverlay, type AttentionBox } from "./attentionOverlay";
import "./agent.css";

/**
 * How far the border keeps off the edge it is framing.
 *
 * Ten was too tight once an editor filled the canvas: the workspace's edge is
 * the *canvas host's* edge, so the frame landed on the embedded editor's
 * scrollbar and grazed its bottom controls. Sixteen clears both and still reads
 * as a frame around the document rather than a box floating inside it.
 *
 * It is a fixed inset rather than a proportional one because the strokes are a
 * fixed width: the number that matters is "wider than the glow", not a fraction
 * of the pane.
 */
const INSET = 16;

export interface AttentionBorderProps {
  /**
   * Draw the border now.
   *
   * Deliberately not "the agent is working": this component paints, it does
   * not decide. Two callers switch it on for two unrelated reasons — the
   * workspace because a run is touching the document (App.tsx), Agent Home
   * because the composer has focus (Hero.tsx) — and neither reason is
   * derivable from the other. Naming the prop after one of them would have
   * made the second caller lie about the first.
   */
  active: boolean;
  /**
   * Where, in the host's pixels. Null frames the whole host.
   *
   * Nothing passes a box yet: the shell cannot see inside a mounted editor, so
   * paragraph-level coordinates have to come from the canvas adapter, and
   * `CanvasAdapter` has no channel for them. Framing the document is the
   * honest version of the same signal — "the agent is working in here" — and
   * the day the adapter can say "this paragraph", it says it through here.
   */
  box?: AttentionBox | null;
  /**
   * Margin between the host's edge and the frame, when framing the whole host.
   *
   * The canvas wants breathing room — the border is around the document, not
   * on it. The hero composer wants zero: there the border *is* the composer's
   * edge lighting up, and an inset would draw a second, smaller rectangle
   * floating inside the input.
   */
  inset?: number;
  /** Corner radius of the frame; see `AttentionBox.radius`. */
  radius?: number;
  /**
   * The shell's own reduced-motion setting (`ShellSettings.reduceMotion`).
   *
   * Passed in rather than read here: this component is mounted in two subtrees
   * and reading settings would make it fetch them twice, and the callers hold
   * the value already.
   */
  reducedMotion?: boolean;
}

/**
 * The border the prototype drew around whatever the agent was working on.
 *
 * Mounted permanently and told when to show, like everything else on the
 * canvas seam (decision 4): the overlay owns a clock, and a component that
 * unmounts between runs restarts it — the light would jump back to the same
 * corner every time the agent started.
 *
 * ## Why Agent Home's focus glow is this component and not a new one
 *
 * The hero composer's glow (`agent-home-glow` in the prototype) says something
 * different from the workspace border: it is input-focus feedback, and it has
 * nothing to do with whether the agent is busy. That argued for a plain CSS
 * ring instead — a different meaning usually wants a different control.
 *
 * It is this component anyway, for one reason that outweighs it: in the
 * prototype the two are *the same light*. Home mounted an `AttentionOverlay`
 * on `.agent-home-glow` and called `focusWhole()` on focusin. The four-stop
 * gradient, the stroke stack and the two masked spots travelling the perimeter
 * are the agent's signature across two products (see attentionOverlay.ts), so
 * a hand-rolled CSS ring would be a second, slightly-wrong copy of it that
 * drifts the first time anyone retunes the real one.
 *
 * What stays separate is the *reason*, which is why `active` is named that and
 * why Home mounts its own instance rather than App reaching into it: Home is a
 * different subtree, the two are never on screen together, and Hero must not
 * have to consult the task to know whether its own input has focus.
 */
export function AttentionBorder({
  active,
  box = null,
  inset = INSET,
  radius,
  reducedMotion = false,
}: AttentionBorderProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<AttentionOverlay | null>(null);
  /*
   * Controls the editor draws for itself along the canvas edges.
   *
   * The frame has to clear those, not just the canvas box: the deck runs its
   * own status bar 32px tall along the bottom and a scrollbar down the side,
   * and a frame drawn INSET pixels inside the box sits on them. This is the
   * channel that already knows — the same numbers the floating agent panel
   * keeps out of the way with (`editorChrome.ts`) — so the frame uses them
   * rather than carrying a second, soon-stale guess.
   *
   * It also makes the border honest about what it frames: what is inside the
   * editor's own chrome is the document, which is the thing the light is about.
   *
   * ── Which is why the box has to be there too ────────────────────────────────
   *
   * `insets` are measured inward from the *canvas box* (`CanvasInsets` in
   * canvasSurface.ts), so with no canvas on screen they are not a distance from
   * anything. That is not hypothetical, and it is the bug the hero glow shipped
   * with: the canvas host is kept mounted behind Home on purpose
   * (`EditorCanvasHost visible={false}`, so a document keeps its session, its
   * scroll position and its undo stack), and an editor that is merely hidden
   * keeps reporting. Home's composer then read the open *deck's* 32px status bar
   * as though it were its own and lit the top 129px of a 161px input, its
   * bottom edge crossing the scope chips. `canvasKeepOut` in the same module
   * answers "no information" the same way, for the same reason: either half
   * missing is silence.
   */
  const { box: canvasBox, chrome } = useCanvasSurface();
  const insets = canvasBox ? chrome?.insets : undefined;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const overlay = new AttentionOverlay(host);
    overlayRef.current = overlay;
    return () => {
      overlayRef.current = null;
      overlay.dispose();
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;

    overlay.setReducedMotion(reducedMotion);

    if (!active) {
      overlay.hide();
      return;
    }

    // The whole-host box is a layout answer, so it is re-asked whenever the
    // layout changes — the agent column opening is a resize, not a re-render,
    // and so is the hero composer growing a line as you type into it.
    const paint = () => {
      if (box) {
        overlay.focus({ ...box, radius: box.radius ?? radius });
        return;
      }
      const rect = host.getBoundingClientRect();
      // Editor-drawn controls push the frame further in, per edge, on top of
      // the glow's own clearance.
      const left = inset + (insets?.left ?? 0);
      const top = inset + (insets?.top ?? 0);
      const right = inset + (insets?.right ?? 0);
      const bottom = inset + (insets?.bottom ?? 0);
      const width = rect.width - left - right;
      const height = rect.height - top - bottom;
      // A host smaller than its own inset would be framed inside out.
      if (width < 1 || height < 1) {
        overlay.hide(true);
        return;
      }
      overlay.focus({ left, top, width, height, radius });
    };

    paint();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => observer.disconnect();
  }, [
    active,
    box,
    inset,
    radius,
    reducedMotion,
    insets?.bottom,
    insets?.left,
    insets?.right,
    insets?.top,
  ]);

  return <div ref={hostRef} className="shell-attention" aria-hidden="true" />;
}

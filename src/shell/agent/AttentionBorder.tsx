import { useEffect, useRef } from "react";

import { AttentionOverlay, type AttentionBox } from "./attentionOverlay";
import "./agent.css";

/** How far inside the workspace the border sits when it frames the whole canvas. */
const INSET = 10;

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
      const width = rect.width - 2 * inset;
      const height = rect.height - 2 * inset;
      // A host smaller than its own inset would be framed inside out.
      if (width < 1 || height < 1) {
        overlay.hide(true);
        return;
      }
      overlay.focus({ left: inset, top: inset, width, height, radius });
    };

    paint();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => observer.disconnect();
  }, [active, box, inset, radius, reducedMotion]);

  return <div ref={hostRef} className="shell-attention" aria-hidden="true" />;
}

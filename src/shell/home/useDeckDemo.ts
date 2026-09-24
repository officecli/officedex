import { useCallback } from "react";

import { useShell } from "../state/ShellContext";

/**
 * Starts the bundled recording: legacy's **Watch PPT generation**.
 *
 * 141 drawing ops (8 slides, 123 shapes) recovered from a real generation,
 * replayed op by op into a real `workspaceDir/live/` draft through the same
 * sequencer, editor and controller a live run uses. Nothing is generated, no
 * credits are spent, and no document the user owns is touched.
 *
 * One function for both entries — Editor Home's action row and Agent Home's
 * "watch it drawn" prompt — because they have to agree about what starting it
 * means: leave Home with `demo` set, which is what puts the canvas on screen
 * and tells it to show a recording rather than wait for a run.
 *
 * It lives here rather than beside either entry so the second one could not
 * quietly grow its own version. It needs a real backend: the draft is a real
 * file and the editor is the real embedded one, so in a plain browser this
 * leaves Home onto a canvas that can only draw its skeleton.
 */
export function useDeckDemo(): () => void {
  const { dispatch } = useShell();
  return useCallback(() => {
    dispatch({ type: "enter-workspace", demo: true });
  }, [dispatch]);
}

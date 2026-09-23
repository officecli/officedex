import { useAgentTask } from "../agent/useAgentTask";
import { useShell } from "../state/ShellContext";
import { useImageSeries } from "./useImageSeries";

/**
 * The version the next message would change, when there is one.
 *
 * An image instruction is always *about* a picture — "make the light warmer"
 * means warmer than something — and the something is whatever is on the canvas.
 * The composer sends it as `ImageGenerationInput.baseFileId`, which is what
 * joins the new run to this series instead of starting an unrelated one, and
 * the panel says so above the input ("Editing Version 2").
 *
 * Null on Home and with anything but a picture open: there is no version to
 * change, so a message is a new image rather than an edit of an old one.
 */
export function useImageEditTarget(): { fileId: string; version: number } | null {
  const { state, activeFile } = useShell();
  const agent = useAgentTask();
  const series = useImageSeries(agent.task);

  if (state.home) return null;
  if (activeFile?.type !== "image") return null;
  const selected = series.selected;
  if (!selected) return null;
  return { fileId: selected.file.id, version: selected.version };
}

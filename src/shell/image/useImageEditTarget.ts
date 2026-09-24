import type { FileMeta } from "../../shared/uiPort";
import { useAgentTask } from "../agent/useAgentTask";
import { useShell } from "../state/ShellContext";
import { useImageSeries, type ImageSeries } from "./useImageSeries";

/**
 * The version a message changes.
 *
 * `source` says how it was chosen, because the user has to be told differently:
 * a picture on the canvas is one they are looking at, while `latest` is one the
 * shell picked for them — the panel is a picture's conversation but nothing is
 * open — and has to say so, show which, and offer the way out.
 */
export interface ImageEditTarget {
  fileId: string;
  version: number;
  source: "open" | "latest";
}

/**
 * The version the next message would change, when there is one.
 *
 * An image instruction is always *about* a picture — "make the light warmer"
 * means warmer than something. The composer sends it as
 * `ImageGenerationInput.baseFileId`, which is what joins the new run to this
 * series instead of starting an unrelated one, and the composer's header says
 * which picture that is.
 *
 * Normally the something is whatever is on the canvas. With nothing open —
 * the tab was closed, the canvas is empty — a message typed under a picture's
 * conversation is still a follow-up to it, and used to become a brand new,
 * unrelated image instead. It now continues from the newest version, and the
 * header marks that as the shell's choice rather than the user's.
 *
 * Null on Home and with a document open: there is no version to change, so a
 * message is a new image, or about the document.
 */
export function imageEditTargetFor(input: {
  home: boolean;
  activeFile: Pick<FileMeta, "type"> | null;
  series: Pick<ImageSeries, "isImageTask" | "selected">;
}): ImageEditTarget | null {
  const { home, activeFile, series } = input;
  if (home) return null;
  const selected = series.selected;
  if (!selected) return null;
  if (activeFile?.type === "image") {
    return { fileId: selected.file.id, version: selected.version, source: "open" };
  }
  // Something else is open: the message is about that.
  if (activeFile) return null;
  if (!series.isImageTask) return null;
  return { fileId: selected.file.id, version: selected.version, source: "latest" };
}

export function useImageEditTarget(): ImageEditTarget | null {
  const { state, activeFile } = useShell();
  const agent = useAgentTask();
  const series = useImageSeries(agent.task);
  return imageEditTargetFor({ home: state.home, activeFile, series });
}

/**
 * A picture's conversation, with a document on the canvas instead of the picture.
 *
 * Closing the picture's tab lands on whichever tab is next, and that is usually
 * a document: the panel still shows the picture's conversation, but a message
 * typed there now goes to the document — the composer's rule, kept because
 * "summarise this deck" must not be locked into image mode. What changes is
 * that it is said, with the picture one click away: which of the two a message
 * is about is exactly what the user cannot see from the panel.
 */
export interface ImageBesideDocument {
  documentName: string;
  documentType: FileMeta["type"];
  fileId: string;
  version: number;
}

export function imageBesideDocumentFor(input: {
  home: boolean;
  activeFile: Pick<FileMeta, "type" | "name"> | null;
  series: Pick<ImageSeries, "isImageTask" | "selected">;
}): ImageBesideDocument | null {
  const { home, activeFile, series } = input;
  if (home || !activeFile || activeFile.type === "image") return null;
  if (!series.isImageTask || !series.selected) return null;
  // With a document open, `selected` is the newest version.
  return { documentName: activeFile.name, documentType: activeFile.type, fileId: series.selected.file.id, version: series.selected.version };
}

export function useImageBesideDocument(): ImageBesideDocument | null {
  const { state, activeFile } = useShell();
  const agent = useAgentTask();
  const series = useImageSeries(agent.task);
  return imageBesideDocumentFor({ home: state.home, activeFile, series });
}

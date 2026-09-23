import type { ImageCameraSettings, ImageGenerationInput } from "../../../shared/uiPort";
import { DEFAULT_CAMERA } from "../../../shared/imageGeneration";

/**
 * What the composer holds for an image message while it is being written.
 *
 * Wider than `ImageGenerationInput` in two places, both because the user can
 * switch something off without losing what they had set: the camera keeps its
 * four choices while disabled, and a reference keeps its display name next to
 * the path the runtime will get.
 */
export interface ImageDraft {
  modelId: string;
  ratio: ImageGenerationInput["ratio"];
  resolution: ImageGenerationInput["resolution"];
  count: number;
  width?: number;
  height?: number;
  style: ImageGenerationInput["style"];
  camera: ImageCameraSettings & { enabled: boolean };
  references: ImageReference[];
}

export interface ImageReference {
  path: string;
  name: string;
}

export const EMPTY_IMAGE_DRAFT: ImageDraft = {
  modelId: "auto",
  ratio: "auto",
  resolution: "2K",
  count: 1,
  style: "auto",
  camera: { ...DEFAULT_CAMERA, enabled: false },
  references: [],
};

/** Reads a saved draft from before a field existed without losing the rest of it. */
export function restoreImageDraft(saved: Partial<ImageDraft> | undefined): ImageDraft {
  return {
    ...EMPTY_IMAGE_DRAFT,
    ...saved,
    camera: { ...EMPTY_IMAGE_DRAFT.camera, ...saved?.camera },
    references: saved?.references ?? [],
  };
}

export function toImageGenerationInput(
  draft: ImageDraft,
  prompt: string,
  baseFileId: string | null,
): ImageGenerationInput {
  const { enabled, ...camera } = draft.camera;
  return {
    modelId: draft.modelId,
    ratio: draft.ratio,
    resolution: draft.resolution,
    count: draft.count,
    ...(draft.ratio === "custom" && draft.width && draft.height ? { width: draft.width, height: draft.height } : {}),
    style: draft.style,
    camera: enabled ? camera : null,
    references: draft.references.map((reference) => reference.path),
    ...(baseFileId ? { baseFileId } : {}),
    prompt,
  };
}

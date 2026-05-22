import { useCallback, useEffect, useState } from "react";
import { officecli } from "./bridge";
import { getAttachmentSpec } from "../shared/types";
import type { AttachmentSpec, DocumentType } from "../shared/types";

export interface AttachmentBundle {
  sourceFile?: string;
  referenceImages?: string[];
}

export interface UseAttachmentsResult {
  sourceWorkbookSpec?: AttachmentSpec;
  referenceImagesSpec?: AttachmentSpec;
  sourceFile: string | null;
  referenceImages: string[];
  pickSourceFile: () => Promise<void>;
  clearSourceFile: () => void;
  pickReferenceImages: () => Promise<void>;
  removeReferenceImage: (path: string) => void;
  isReferenceLimitReached: boolean;
  collect: () => AttachmentBundle;
  validateForSubmit: () => { ok: true } | { ok: false; reason: string };
}

export function useAttachments(documentType: DocumentType): UseAttachmentsResult {
  const sourceWorkbookSpec = getAttachmentSpec(documentType, "sourceWorkbook");
  const referenceImagesSpec = getAttachmentSpec(documentType, "referenceImages");

  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  useEffect(() => {
    if (!sourceWorkbookSpec) {
      setSourceFile(null);
    }
  }, [sourceWorkbookSpec]);

  useEffect(() => {
    if (!referenceImagesSpec) {
      setReferenceImages([]);
    }
  }, [referenceImagesSpec]);

  const pickSourceFile = useCallback(async () => {
    if (!sourceWorkbookSpec) return;
    const picked = await officecli.openFileDialog({
      filters: [{ name: sourceWorkbookSpec.label, extensions: sourceWorkbookSpec.extensions }],
    });
    if (picked) {
      setSourceFile(picked);
    }
  }, [sourceWorkbookSpec]);

  const clearSourceFile = useCallback(() => {
    setSourceFile(null);
  }, []);

  const pickReferenceImages = useCallback(async () => {
    if (!referenceImagesSpec) return;
    const picked = await officecli.openMultiFileDialog({
      filters: [{ name: referenceImagesSpec.label, extensions: referenceImagesSpec.extensions }],
    });
    if (!picked || picked.length === 0) return;
    setReferenceImages((current) => mergeUnique(current, picked, referenceImagesSpec.maxCount));
  }, [referenceImagesSpec]);

  const removeReferenceImage = useCallback((path: string) => {
    setReferenceImages((current) => current.filter((entry) => entry !== path));
  }, []);

  const isReferenceLimitReached = referenceImagesSpec ? referenceImages.length >= referenceImagesSpec.maxCount : false;

  const collect = useCallback((): AttachmentBundle => {
    const bundle: AttachmentBundle = {};
    if (sourceWorkbookSpec && sourceFile) {
      bundle.sourceFile = sourceFile;
    }
    if (referenceImagesSpec && referenceImages.length > 0) {
      bundle.referenceImages = referenceImages.slice(0, referenceImagesSpec.maxCount);
    }
    return bundle;
  }, [sourceWorkbookSpec, referenceImagesSpec, sourceFile, referenceImages]);

  const validateForSubmit = useCallback((): { ok: true } | { ok: false; reason: string } => {
    if (sourceWorkbookSpec?.required && !sourceFile) {
      return {
        ok: false,
        reason: `${sourceWorkbookSpec.label} is required for ${documentType.toUpperCase()} generation. Attach a .${sourceWorkbookSpec.extensions[0]} file to continue.`,
      };
    }
    if (referenceImagesSpec?.required && referenceImages.length === 0) {
      return {
        ok: false,
        reason: `${referenceImagesSpec.label} is required.`,
      };
    }
    return { ok: true };
  }, [documentType, sourceWorkbookSpec, referenceImagesSpec, sourceFile, referenceImages]);

  return {
    sourceWorkbookSpec,
    referenceImagesSpec,
    sourceFile,
    referenceImages,
    pickSourceFile,
    clearSourceFile,
    pickReferenceImages,
    removeReferenceImage,
    isReferenceLimitReached,
    collect,
    validateForSubmit,
  };
}

function mergeUnique(current: string[], incoming: string[], maxCount: number): string[] {
  const merged = [...current];
  for (const entry of incoming) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!merged.includes(entry)) merged.push(entry);
  }
  return merged.slice(0, maxCount);
}

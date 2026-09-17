import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopApi } from "./services/desktopApi";
import { getAttachmentSpec } from "../shared/types";
import type { AttachmentSpec, DocumentType } from "../shared/types";

export interface AttachmentBundle {
  sourceFile?: string;
  referenceImages?: string[];
}

export interface UseAttachmentsOptions {
  sourceFile?: string | null;
  referenceImages?: string[];
  onChange?: (next: AttachmentBundle) => void;
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
  addReferenceImagePaths: (paths: string[]) => number;
  isReferenceLimitReached: boolean;
  supportsPaste: boolean;
  handlePastedFiles: (files: File[]) => Promise<number>;
  collect: () => AttachmentBundle;
  validateForSubmit: () => { ok: true } | { ok: false; reason: string };
}

export function useAttachments(documentType: DocumentType, options: UseAttachmentsOptions = {}): UseAttachmentsResult {
  const api = useDesktopApi();
  const sourceWorkbookSpec = getAttachmentSpec(documentType, "sourceWorkbook");
  const referenceImagesSpec = getAttachmentSpec(documentType, "referenceImages");
  const sourceFileControlled = options.sourceFile !== undefined;
  const referenceImagesControlled = options.referenceImages !== undefined;

  const [internalSourceFile, setInternalSourceFile] = useState<string | null>(null);
  const [internalReferenceImages, setInternalReferenceImages] = useState<string[]>([]);
  const sourceFile = sourceFileControlled ? options.sourceFile ?? null : internalSourceFile;
  const referenceImages = referenceImagesControlled ? options.referenceImages ?? [] : internalReferenceImages;
  const referenceImagesRef = useRef<string[]>(referenceImages);
  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  const updateSourceFile = useCallback((next: string | null) => {
    if (sourceFileControlled) {
      options.onChange?.({
        sourceFile: next || undefined,
        referenceImages,
      });
      return;
    }
    setInternalSourceFile(next);
  }, [sourceFileControlled, options, referenceImages]);

  const updateReferenceImages = useCallback((next: string[]) => {
    referenceImagesRef.current = next;
    if (referenceImagesControlled) {
      options.onChange?.({
        sourceFile: sourceFile || undefined,
        referenceImages: next,
      });
      return;
    }
    setInternalReferenceImages(next);
  }, [referenceImagesControlled, options, sourceFile]);

  useEffect(() => {
    if (!sourceWorkbookSpec && sourceFile) {
      updateSourceFile(null);
    }
  }, [sourceWorkbookSpec, sourceFile, updateSourceFile]);

  useEffect(() => {
    if (!referenceImagesSpec && referenceImages.length > 0) {
      updateReferenceImages([]);
    }
  }, [referenceImagesSpec, referenceImages.length, updateReferenceImages]);

  const pickSourceFile = useCallback(async () => {
    if (!sourceWorkbookSpec) return;
    const picked = await api.openFileDialog({
      filters: [{ name: sourceWorkbookSpec.label, extensions: sourceWorkbookSpec.extensions }],
    });
    if (picked) {
      updateSourceFile(picked);
    }
  }, [sourceWorkbookSpec, updateSourceFile]);

  const clearSourceFile = useCallback(() => {
    updateSourceFile(null);
  }, [updateSourceFile]);

  const pickReferenceImages = useCallback(async () => {
    if (!referenceImagesSpec) return;
    const picked = await api.openMultiFileDialog({
      filters: [{ name: referenceImagesSpec.label, extensions: referenceImagesSpec.extensions }],
    });
    if (!picked || picked.length === 0) return;
    updateReferenceImages(mergeUnique(referenceImagesRef.current, picked, referenceImagesSpec.maxCount));
  }, [referenceImagesSpec, updateReferenceImages]);

  const removeReferenceImage = useCallback((path: string) => {
    updateReferenceImages(referenceImagesRef.current.filter((entry) => entry !== path));
  }, [updateReferenceImages]);

  const addReferenceImagePaths = useCallback((paths: string[]): number => {
    if (!referenceImagesSpec) return 0;
    const allowedExtensions = new Set(referenceImagesSpec.extensions.map((ext) => ext.toLowerCase()));
    const incoming = paths.filter((path) => hasAllowedImageExtension(path, allowedExtensions));
    if (incoming.length === 0) return 0;
    const current = referenceImagesRef.current;
    const next = mergeUnique(current, incoming, referenceImagesSpec.maxCount);
    if (next.length === current.length) return 0;
    updateReferenceImages(next);
    return next.length - current.length;
  }, [referenceImagesSpec, updateReferenceImages]);

  const isReferenceLimitReached = referenceImagesSpec ? referenceImages.length >= referenceImagesSpec.maxCount : false;

  const supportsPaste = Boolean(referenceImagesSpec);

  const handlePastedFiles = useCallback(
    async (files: File[]): Promise<number> => {
      if (!referenceImagesSpec) return 0;
      const allowedExtensions = new Set(referenceImagesSpec.extensions.map((ext) => ext.toLowerCase()));
      const maxCount = referenceImagesSpec.maxCount;
      if (referenceImagesRef.current.length >= maxCount) return 0;
      const savedPaths: string[] = [];
      for (const file of files) {
        if (referenceImagesRef.current.length + savedPaths.length >= maxCount) break;
        if (!file.type.startsWith("image/")) continue;
        const ext = inferImageExtension(file, allowedExtensions);
        if (!ext) continue;
        const buffer = await readFileAsArrayBuffer(file);
        const path = await api.savePastedImage(new Uint8Array(buffer), ext);
        if (path && !referenceImagesRef.current.includes(path) && !savedPaths.includes(path)) {
          savedPaths.push(path);
        }
      }
      if (savedPaths.length === 0) return 0;
      updateReferenceImages(mergeUnique(referenceImagesRef.current, savedPaths, maxCount));
      return savedPaths.length;
    },
    [referenceImagesSpec, updateReferenceImages],
  );

  const collect = useCallback((): AttachmentBundle => {
    const bundle: AttachmentBundle = {};
    if (sourceWorkbookSpec && sourceFile) {
      bundle.sourceFile = sourceFile;
    }
    const currentReferenceImages = referenceImagesRef.current;
    if (referenceImagesSpec && currentReferenceImages.length > 0) {
      bundle.referenceImages = currentReferenceImages.slice(0, referenceImagesSpec.maxCount);
    }
    return bundle;
  }, [sourceWorkbookSpec, referenceImagesSpec, sourceFile]);

  const validateForSubmit = useCallback((): { ok: true } | { ok: false; reason: string } => {
    if (sourceWorkbookSpec?.required && !sourceFile) {
      return {
        ok: false,
        reason: `${sourceWorkbookSpec.label} is required for ${documentType.toUpperCase()} generation. Attach a .${sourceWorkbookSpec.extensions[0]} file to continue.`,
      };
    }
    if (referenceImagesSpec?.required && referenceImagesRef.current.length === 0) {
      return {
        ok: false,
        reason: `${referenceImagesSpec.label} is required.`,
      };
    }
    return { ok: true };
  }, [documentType, sourceWorkbookSpec, referenceImagesSpec, sourceFile]);

  return {
    sourceWorkbookSpec,
    referenceImagesSpec,
    sourceFile,
    referenceImages,
    pickSourceFile,
    clearSourceFile,
    pickReferenceImages,
    removeReferenceImage,
    addReferenceImagePaths,
    isReferenceLimitReached,
    supportsPaste,
    handlePastedFiles,
    collect,
    validateForSubmit,
  };
}

function hasAllowedImageExtension(path: string, allowed: Set<string>): boolean {
  const extension = path.includes(".") ? path.split(".").pop()?.toLowerCase() : undefined;
  return Boolean(extension && allowed.has(extension));
}

function inferImageExtension(file: File, allowed: Set<string>): string | undefined {
  const fromName = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : undefined;
  if (fromName && allowed.has(fromName)) return fromName;
  const subtype = file.type.startsWith("image/") ? file.type.slice("image/".length).toLowerCase() : "";
  const fromMime = subtype === "jpeg" ? "jpeg" : subtype;
  if (fromMime && allowed.has(fromMime)) return fromMime;
  if (allowed.has("png")) return "png";
  return undefined;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  const nativeArrayBuffer = (file as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  if (typeof nativeArrayBuffer === "function") {
    return nativeArrayBuffer.call(file);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Failed to read ${file.name} as ArrayBuffer`));
    };
    reader.readAsArrayBuffer(file);
  });
}

function mergeUnique(current: string[], incoming: string[], maxCount: number): string[] {
  const merged = [...current];
  for (const entry of incoming) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!merged.includes(entry)) merged.push(entry);
  }
  return merged.slice(0, maxCount);
}

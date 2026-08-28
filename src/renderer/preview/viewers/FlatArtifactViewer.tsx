import { useEffect, useMemo, useState } from "react";
import type { Artifact, ArtifactStageEditIntent } from "../../../shared/types";
import { officecli } from "../../bridge";
import {
  FlatArtifactStage,
  createFlatArtifactSelection,
  createFlatArtifactStageIntent,
  type FlatArtifactDescriptor,
} from "../../flatArtifactStage";
import { uint8ArrayToBase64 } from "../../utils/bytes";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PreviewToolbar } from "../components/PreviewToolbar";

interface FlatArtifactViewerProps {
  previewToken: string;
  fileName: string;
  documentType: "img" | "gif";
  artifact?: Artifact | null;
  onArtifactStageEdit?: (intent: ArtifactStageEditIntent) => Promise<void> | void;
}

export default function FlatArtifactViewer({
  previewToken,
  fileName,
  documentType,
  artifact,
  onArtifactStageEdit,
}: FlatArtifactViewerProps) {
  const [previewSrc, setPreviewSrc] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retryKey, setRetryKey] = useState(0);
  const [gifFrameCount, setGifFrameCount] = useState(1);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const descriptor = useMemo<FlatArtifactDescriptor>(() => ({
    artifactId: artifact?.fileID || artifact?.taskId || artifact?.filePath || fileName,
    artifactPath: artifact?.filePath || fileName,
    kind: documentType === "gif" ? "gif" : "image",
    width: dimensions.width,
    height: dimensions.height,
    frameCount: documentType === "gif" ? gifFrameCount : 1,
  }), [artifact?.fileID, artifact?.filePath, artifact?.taskId, dimensions.height, dimensions.width, documentType, fileName, gifFrameCount]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setGifFrameCount(1);
    setDimensions({ width: 1, height: 1 });
    void officecli.readArtifactFile(previewToken).then(({ data }) => {
      if (cancelled) return;
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const mime = documentType === "gif" ? "image/gif" : mimeForFileName(fileName);
      const source = `data:${mime};base64,${uint8ArrayToBase64(bytes)}`;
      setPreviewSrc(source);
      const image = new Image();
      image.onload = () => {
        if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
          setDimensions({ width: image.naturalWidth, height: image.naturalHeight });
        }
      };
      image.src = source;
      if (documentType === "gif") setGifFrameCount(countGifFrames(bytes));
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentType, fileName, previewToken, retryKey]);

  if (loading) return <LoadingState fileName={fileName} />;
  if (error) return <ErrorState message={error} fileName={fileName} onRetry={() => setRetryKey((value) => value + 1)} />;

  return (
    <div className="flat-artifact-viewer">
      <PreviewToolbar fileName={fileName} documentType={documentType} />
      <FlatArtifactStage
        artifact={descriptor}
        previewSrc={previewSrc}
        alt={fileName}
        onEditRequest={onArtifactStageEdit ? (request) => {
          const selection = createFlatArtifactSelection(descriptor, {
            region: request.scope.kind === "region" ? request.scope.region : null,
            frameSelection: request.frameSelection,
          });
          return Promise.resolve(onArtifactStageEdit(createFlatArtifactStageIntent({
            selection,
            instruction: request.instruction,
          })));
        } : undefined}
      />
    </div>
  );
}

function mimeForFileName(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/png";
}

/** Count GIF image descriptors without decoding or guessing from the filename. */
function countGifFrames(bytes: Uint8Array): number {
  if (bytes.length < 13 || String.fromCharCode(...bytes.subarray(0, 3)) !== "GIF") return 1;
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const block = bytes[offset++];
    if (block === 0x3b) break;
    if (block === 0x2c) {
      if (offset + 9 > bytes.length) break;
      const imagePacked = bytes[offset + 8] ?? 0;
      offset += 9;
      if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      if (offset >= bytes.length) break;
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      frames += 1;
      continue;
    }
    if (block === 0x21) {
      if (offset >= bytes.length) break;
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    break;
  }
  return Math.max(1, frames);
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (!size) break;
    offset += size;
  }
  return offset;
}

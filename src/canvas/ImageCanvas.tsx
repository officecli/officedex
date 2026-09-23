import { useEffect, useState } from "react";

import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import { IMAGE_MIME_TYPES } from "../renderer/preview/viewers/imageViewport";

/**
 * A generated picture, shown in the document slot.
 *
 * A viewer, not an editor: there is nothing to save, nothing to select and
 * nothing to edit in place, so it reports none of the handles the other leaves
 * do. `CanvasContent` withdraws those when it routes here.
 *
 * The bytes come the same way the other leaves get theirs — record, preview
 * token, then `readArtifactFile` — and are shown from a blob URL. Reading
 * through the token rather than pointing an `<img>` at the path is what keeps
 * this working in the packaged build, where the webview cannot load `file://`.
 */

export interface ImageCanvasProps {
  api: DesktopAPI;
  file: FileMeta;
  onUnavailable: (reason: string) => void;
}

function mimeOf(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_TYPES[extension] ?? "image/png";
}

export function ImageCanvas({ api, file, onUnavailable }: ImageCanvasProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url = "";
    let token = "";
    setSrc(null);
    void (async () => {
      try {
        const record = await api.getDocument(file.id);
        const grant = await api.issuePreviewToken({
          filePath: record.filePath,
          fileName: record.fileName,
          documentType: record.documentType,
          ...(record.currentArtifactTaskId ? { taskId: record.currentArtifactTaskId } : {}),
        });
        token = grant.token;
        if (cancelled) return;
        const { data } = await api.readArtifactFile(grant.token);
        if (cancelled) return;
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
        url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(record.fileName) }));
        setSrc(url);
      } catch (reason) {
        if (!cancelled) onUnavailable(reason instanceof Error ? reason.message : String(reason));
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      if (token) void api.revokePreviewToken(token).catch(() => {});
    };
    // onUnavailable is stable per adapter; including it would re-read the image
    // on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, file.id]);

  // The host's skeleton shows through until the bytes are in.
  if (!src) return null;

  return (
    <div className="shell-image-canvas">
      <img src={src} alt={file.name} draggable={false} />
    </div>
  );
}

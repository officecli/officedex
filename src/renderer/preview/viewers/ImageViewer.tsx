import { useEffect, useState } from "react";
import { LoadingState } from "../components/LoadingState";
import type { PreviewViewerProps } from "./previewViewers";

export default function ImageViewer({ previewToken, fileName }: PreviewViewerProps) {
  const [src, setSrc] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    fetch(previewToken)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.blob(); })
      .then((blob) => { if (!cancelled) setSrc(URL.createObjectURL(blob)); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; if (src) URL.revokeObjectURL(src); };
  }, [previewToken]);
  if (error) return <div className="preview-error"><p>Unable to preview {fileName}</p><small>{error}</small></div>;
  if (!src) return <LoadingState fileName={fileName} />;
  return <div className="preview-image"><img src={src} alt={fileName} /></div>;
}

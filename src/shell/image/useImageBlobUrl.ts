import { useEffect, useState } from "react";

import { usePort } from "../port/PortContext";

/**
 * A picture's bytes, as something an `<img>` can point at.
 *
 * The canvas slot cannot answer this. `EditorCanvasHost` shows the open file
 * through the desktop adapter, and there is no adapter in a browser — so the
 * image surfaces draw their own picture, from `images.readFile`, rather than
 * relying on something that is a placeholder half the time.
 *
 * One cache for the whole shell, reference-counted, because the same file is on
 * screen up to three times at once: the main figure, its thumbnail in the
 * versions strip, and the result card in the transcript. Three components each
 * calling `readFile` would hold three copies of the same bytes and three object
 * URLs to leak. The count is what makes revoking safe — the URL goes when the
 * last of the three unmounts, not when the first does.
 *
 * `URL.createObjectURL` is missing in jsdom and the hook resolves to null
 * there. That is deliberately not a polyfill: a test asserting on the picture's
 * *shape* (a figure, a caption, a selected thumbnail) should not need a blob
 * implementation, and one asserting on the bytes would be testing jsdom.
 */

interface Entry {
  url: string;
  refs: number;
}

const cache = new Map<string, Entry>();

function createObjectUrl(blob: Blob): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(blob);
}

function revokeObjectUrl(url: string): void {
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

function release(fileId: string): void {
  const entry = cache.get(fileId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  cache.delete(fileId);
  revokeObjectUrl(entry.url);
}

export function useImageBlobUrl(fileId: string | null): string | null {
  const port = usePort();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!fileId) {
      setUrl(null);
      return;
    }

    const cached = cache.get(fileId);
    if (cached) {
      cached.refs += 1;
      setUrl(cached.url);
      return () => release(fileId);
    }

    setUrl(null);
    const images = port.images;
    if (!images) return;

    let cancelled = false;
    let retained = false;
    void (async () => {
      let blob: Blob;
      try {
        blob = await images.readFile(fileId);
      } catch {
        // A picture that cannot be read shows as no picture. The surfaces
        // around it — name, version, Download — are still true.
        return;
      }
      if (cancelled) return;
      const objectUrl = createObjectUrl(blob);
      if (!objectUrl) return;
      // Another consumer may have finished first while this read was in flight.
      const existing = cache.get(fileId);
      if (existing) {
        revokeObjectUrl(objectUrl);
        existing.refs += 1;
        retained = true;
        setUrl(existing.url);
        return;
      }
      cache.set(fileId, { url: objectUrl, refs: 1 });
      retained = true;
      setUrl(objectUrl);
    })();

    return () => {
      cancelled = true;
      if (retained) release(fileId);
    };
  }, [fileId, port]);

  return url;
}

const MOP_IMPORT_PATH = "/api/osuite/mop/import";
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read the PowerPoint upload."));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("Unable to read the PowerPoint upload."));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * WKWebView drops Blob-backed multipart bodies before they reach Wails' custom
 * asset handler. The embedded presentation source still creates FormData, so
 * translate only the local PPTX import request to raw bytes at the OfficeDex
 * integration boundary. The handler already supports this transport shape.
 */
export function installPptxImportTransport(): () => void {
  const originalFetch = window.fetch;
  const nativeFetch = originalFetch.bind(window);

  const patchedFetch: typeof window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "POST" || !url.pathname.endsWith(MOP_IMPORT_PATH) || !(init?.body instanceof FormData)) {
      return nativeFetch(input, init);
    }

    const file = init.body.get("file");
    if (!(file instanceof Blob)) return nativeFetch(input, init);

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("Content-Type", file.type || PPTX_CONTENT_TYPE);
    if (!headers.has("X-PPTX-File-Name") && file instanceof File) {
      headers.set("X-PPTX-File-Name", encodeURIComponent(file.name));
    }
    return nativeFetch(input, {
      ...init,
      headers,
      body: new Uint8Array(await readBlobBytes(file)),
    });
  };

  window.fetch = patchedFetch;
  return () => {
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
  };
}

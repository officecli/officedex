import { afterEach, describe, expect, it, vi } from "vitest";
import { installPptxImportTransport } from "./pptx-import-transport";

const originalFetch = window.fetch;

afterEach(() => {
  window.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("installPptxImportTransport", () => {
  it("converts the local PPTX multipart upload to raw bytes for Wails", async () => {
    const nativeFetch = vi.fn(async () => new Response(null, { status: 201 }));
    window.fetch = nativeFetch;
    const uninstall = installPptxImportTransport();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "演示文稿.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    const form = new FormData();
    form.append("file", file, file.name);

    await window.fetch("/api/osuite/mop/import", { method: "POST", body: form });

    expect(nativeFetch).toHaveBeenCalledTimes(1);
    const [, request] = nativeFetch.mock.calls[0];
    expect(request?.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(request?.body as Uint8Array)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const headers = new Headers(request?.headers);
    expect(headers.get("Content-Type")).toBe(file.type);
    expect(headers.get("X-PPTX-File-Name")).toBe(encodeURIComponent(file.name));

    uninstall();
    expect(window.fetch).toBe(nativeFetch);
  });

  it("leaves unrelated requests untouched", async () => {
    const nativeFetch = vi.fn(async () => new Response(null, { status: 200 }));
    window.fetch = nativeFetch;
    installPptxImportTransport();
    const form = new FormData();

    await window.fetch("/api/other", { method: "POST", body: form });

    expect(nativeFetch).toHaveBeenCalledWith("/api/other", { method: "POST", body: form });
  });
});

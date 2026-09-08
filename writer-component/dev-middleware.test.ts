// The dev middlewares stand in for internal/word2mowhttp and
// internal/writerfonts on the Vite dev server, so they have to agree with those
// handlers on the parts a client can observe: which paths resolve, which are
// refused, and how an encoding is chosen. These tests cover the pure resolution
// and archive layers; the Go tests cover the packaged side.
import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync } from "fflate";

import {
  FONTS_PREFIX,
  fontContentType,
  normalizeMowArchivePath,
  readMowDirectory,
  resolveFontRequest,
  writeMowDirectory,
} from "./dev-middleware";

const HASH = "a".repeat(64);

async function withFontClosure(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "officedex-writer-fonts-test-"));
  try {
    await mkdir(path.join(root, "prebuilt"), { recursive: true });
    await mkdir(path.join(root, "files"), { recursive: true });
    await mkdir(path.join(root, "draw"), { recursive: true });
    await writeFile(path.join(root, "prebuilt", `${HASH}.json`), '{"identity":true}');
    await writeFile(path.join(root, "prebuilt", `${HASH}.json.br`), "brotli-bytes");
    await writeFile(path.join(root, "prebuilt", `${HASH}.json.gz`), "gzip-bytes");
    await writeFile(path.join(root, "files", "Arial.woff"), "woff-bytes");
    await writeFile(path.join(root, "draw", "Arial.ttf"), "ttf-bytes");
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("resolveFontRequest", () => {
  it("serves a prebuilt manifest as immutable, identity by default", async () => {
    await withFontClosure(async (root) => {
      const resolved = await resolveFontRequest(root, `${FONTS_PREFIX}prebuilt/${HASH}.json`, "");
      expect(resolved.status).toBe(200);
      expect(resolved.cacheControl).toBe("public, max-age=31536000, immutable");
      expect(resolved.contentEncoding).toBeUndefined();
      expect(resolved.filePath).toBe(path.join(root, "prebuilt", `${HASH}.json`));
    });
  });

  it("prefers brotli over gzip when the client rates them equally", async () => {
    await withFontClosure(async (root) => {
      const resolved = await resolveFontRequest(root, `${FONTS_PREFIX}prebuilt/${HASH}.json`, "gzip, deflate, br");
      expect(resolved.contentEncoding).toBe("br");
      expect(resolved.filePath?.endsWith(".json.br")).toBe(true);
    });
  });

  it("falls back to gzip when brotli is refused", async () => {
    await withFontClosure(async (root) => {
      const resolved = await resolveFontRequest(root, `${FONTS_PREFIX}prebuilt/${HASH}.json`, "br;q=0, gzip");
      expect(resolved.contentEncoding).toBe("gzip");
    });
  });

  it("answers 406 when every encoding including identity is refused", async () => {
    await withFontClosure(async (root) => {
      const resolved = await resolveFontRequest(root, `${FONTS_PREFIX}prebuilt/${HASH}.json`, "identity;q=0, *;q=0");
      expect(resolved.status).toBe(406);
    });
  });

  it("never content-encodes files/ and draw/, which revalidate instead", async () => {
    await withFontClosure(async (root) => {
      for (const [requestPath, contentType] of [
        [`${FONTS_PREFIX}files/Arial.woff`, "font/woff"],
        [`${FONTS_PREFIX}draw/Arial.ttf`, "font/ttf"],
      ] as const) {
        const resolved = await resolveFontRequest(root, requestPath, "br, gzip");
        expect(resolved.status).toBe(200);
        expect(resolved.cacheControl).toBe("public, max-age=0, must-revalidate");
        expect(resolved.contentEncoding).toBeUndefined();
        expect(resolved.contentType).toBe(contentType);
      }
    });
  });

  it("refuses traversal, nesting, and names outside each root's pattern", async () => {
    await withFontClosure(async (root) => {
      for (const requestPath of [
        `${FONTS_PREFIX}files/../../etc/passwd`,
        `${FONTS_PREFIX}files/%2e%2e%2fpasswd`,
        `${FONTS_PREFIX}files/nested/Arial.woff`,
        `${FONTS_PREFIX}prebuilt/not-a-hash.json`,
        `${FONTS_PREFIX}secrets/key.pem`,
        `${FONTS_PREFIX}files/`,
        `${FONTS_PREFIX}files`,
      ]) {
        const resolved = await resolveFontRequest(root, requestPath, "");
        expect(resolved.status, requestPath).not.toBe(200);
      }
    });
  });

  it("answers 400 on a malformed percent-escape", async () => {
    await withFontClosure(async (root) => {
      const resolved = await resolveFontRequest(root, `${FONTS_PREFIX}files/%zz`, "");
      expect(resolved.status).toBe(400);
    });
  });

  it("answers 404 when the closure was never staged", async () => {
    const resolved = await resolveFontRequest("/nonexistent/writer-fonts", `${FONTS_PREFIX}files/Arial.woff`, "");
    expect(resolved.status).toBe(404);
  });
});

describe("fontContentType", () => {
  it("maps the closure's extensions and defaults to octet-stream", () => {
    expect(fontContentType("a.json")).toBe("application/json; charset=utf-8");
    expect(fontContentType("a.woff2")).toBe("font/woff2");
    expect(fontContentType("a.otf")).toBe("font/otf");
    expect(fontContentType("a.bin")).toBe("application/octet-stream");
  });
});

describe("normalizeMowArchivePath", () => {
  it("accepts only content.json, image/** and embedding/**", () => {
    expect(normalizeMowArchivePath("content.json")).toBe("content.json");
    expect(normalizeMowArchivePath("image/a.png")).toBe("image/a.png");
    expect(normalizeMowArchivePath("embedding/deep/a.bin")).toBe("embedding/deep/a.bin");
  });

  it("rejects escapes, absolute paths, backslashes and foreign roots", () => {
    for (const bad of ["", "/content.json", "image\\a.png", "../content.json", "image/../../x", "secrets/key.pem"]) {
      expect(() => normalizeMowArchivePath(bad), bad).toThrow(TypeError);
    }
  });
});

describe("MOW package round-trip", () => {
  it("unpacks an archive and reads it back with sorted entries", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "officedex-mow-test-"));
    try {
      const root = path.join(scratch, "document.mow.dir");
      const archive = Buffer.from(
        zipSync({
          "image/b.png": new Uint8Array([2]),
          "content.json": new TextEncoder().encode('{"blocks":[]}'),
          "image/a.png": new Uint8Array([1]),
        }),
      );
      await writeMowDirectory(root, archive);
      const entries = await readMowDirectory(root);
      expect(Object.keys(entries)).toEqual(["content.json", "image/a.png", "image/b.png"]);
      expect(new TextDecoder().decode(entries["content.json"])).toBe('{"blocks":[]}');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses an archive whose entries escape the package root", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "officedex-mow-test-"));
    try {
      const archive = Buffer.from(zipSync({ "../escape.json": new Uint8Array([1]) }));
      await expect(writeMowDirectory(path.join(scratch, "document.mow.dir"), archive)).rejects.toThrow(TypeError);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("refuses an archive with no content.json at its root", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "officedex-mow-test-"));
    try {
      const archive = Buffer.from(zipSync({ "image/a.png": new Uint8Array([1]) }));
      await expect(writeMowDirectory(path.join(scratch, "document.mow.dir"), archive)).rejects.toThrow(
        /content\.json/u,
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});

// Dev-server counterparts to internal/word2mowhttp and internal/writerfonts.
//
// `npm run dev:browser` serves the renderer from Vite, which never reaches the
// Go asset server, so the embedded Writer editor would otherwise have no
// converter and no fonts. These middlewares answer the same two APIs at the
// same paths. They are development-only by construction (`apply: "serve"`); the
// packaged app always goes through Go, and the Go handlers remain the reference
// implementation whenever the two disagree.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import type { Plugin } from "vite";

export const IMPORT_ROUTE = "/api/import";
export const EXPORT_ROUTE = "/api/export";
export const FONTS_PREFIX = "/writer-next-default-fonts/";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ZIP_MIME = "application/zip";
const CONTENT_FILE_NAME = "content.json";
const MAX_BODY_BYTES = 128 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 180_000;

/**
 * The MOW path whitelist, kept identical to `normalizeMowArchivePath` in
 * writer's `mow-archive.ts` and in `internal/word2mowhttp/archive.go`. All three
 * read the same archives, so a divergence drops a file from a round-trip
 * instead of reporting an error.
 */
export function normalizeMowArchivePath(archivePath: string): string {
  if (archivePath.length === 0 || archivePath.startsWith("/") || archivePath.includes("\\")) {
    throw new TypeError(`Invalid MOW archive path: ${archivePath}`);
  }
  const segments = archivePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError(`Invalid MOW archive path: ${archivePath}`);
  }
  if (archivePath !== CONTENT_FILE_NAME && segments[0] !== "image" && segments[0] !== "embedding") {
    throw new TypeError(`Unsupported MOW archive entry: ${archivePath}`);
  }
  return archivePath;
}

/** The three delivery roots `writerNextDefaultFontsPlugin` writes. */
const FONT_ROUTES = [
  {
    kind: "prebuilt",
    cacheControl: "public, max-age=31536000, immutable",
    namePattern: /^[0-9a-f]{64}\.json$/u,
    negotiates: true,
  },
  {
    kind: "files",
    cacheControl: "public, max-age=0, must-revalidate",
    namePattern: /^[^/\\\0?#%]+$/u,
    negotiates: false,
  },
  {
    kind: "draw",
    cacheControl: "public, max-age=0, must-revalidate",
    namePattern: /^[^/\\\0?#%]+$/u,
    negotiates: false,
  },
] as const;

export function fontContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".json":
      return "application/json; charset=utf-8";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".otf":
      return "font/otf";
    default:
      return "application/octet-stream";
  }
}

export interface FontRequestResolution {
  readonly status: number;
  readonly filePath?: string;
  readonly cacheControl?: string;
  readonly contentType?: string;
  readonly contentEncoding?: string;
}

/**
 * Resolve one font request against the staged closure. Split out from the
 * middleware so the path and negotiation rules can be exercised without a
 * server; `internal/writerfonts` covers the same cases on the packaged side.
 */
export async function resolveFontRequest(
  root: string,
  pathname: string,
  acceptEncoding: string,
): Promise<FontRequestResolution> {
  const relative = pathname.slice(FONTS_PREFIX.length);
  const separator = relative.indexOf("/");
  if (separator < 0) return { status: 404 };
  const route = FONT_ROUTES.find((entry) => entry.kind === relative.slice(0, separator));
  const rawName = relative.slice(separator + 1);
  if (route === undefined || rawName.length === 0 || rawName.includes("/")) return { status: 404 };

  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    return { status: 400 };
  }
  if (!route.namePattern.test(name)) return { status: 404 };

  const routeRoot = path.resolve(root, route.kind);
  const filePath = path.resolve(routeRoot, name);
  if (!filePath.startsWith(`${routeRoot}${path.sep}`)) return { status: 403 };
  if (!(await isPlainFile(filePath))) return { status: 404 };

  const base = { cacheControl: route.cacheControl, contentType: fontContentType(filePath) };
  if (!route.negotiates) return { status: 200, filePath, ...base };

  // br, then gzip, then identity -- the order `createStaticFontMiddleware` uses,
  // so a client that rates br and gzip equally still gets the smaller body.
  for (const sidecar of [
    { suffix: ".br", encoding: "br" },
    { suffix: ".gz", encoding: "gzip" },
  ]) {
    if (!acceptsEncoding(acceptEncoding, sidecar.encoding)) continue;
    const sidecarPath = `${filePath}${sidecar.suffix}`;
    if (await isPlainFile(sidecarPath)) {
      return { status: 200, filePath: sidecarPath, ...base, contentEncoding: sidecar.encoding };
    }
  }
  if (!acceptsEncoding(acceptEncoding, "identity")) return { status: 406 };
  return { status: 200, filePath, ...base };
}

function acceptsEncoding(header: string, encoding: string): boolean {
  if (header.trim().length === 0) return encoding === "identity";
  let wildcard: number | undefined;
  for (const item of header.split(",")) {
    const match = /^\s*([A-Za-z0-9*_.\-]+)\s*(?:;\s*q\s*=\s*([0-9.]+))?\s*$/u.exec(item);
    const token = match?.[1];
    if (token === undefined) continue;
    const quality = match?.[2] === undefined ? 1 : Number(match[2]);
    if (token.toLowerCase() === encoding) return quality > 0;
    if (token === "*") wildcard = quality;
  }
  if (wildcard !== undefined) return wildcard > 0;
  return encoding === "identity";
}

// Symlinks are rejected rather than followed, the same way sdkSheetDevAssets
// does it: the staged closure is generated, so a link inside it would only ever
// be a way out of the root.
async function isPlainFile(filePath: string): Promise<boolean> {
  try {
    const info = await lstat(filePath);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

export function writerFontsDevAssets(input: { readonly root: string }): Plugin {
  return {
    name: "officedex-writer-fonts-dev-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (!pathname.startsWith(FONTS_PREFIX)) {
          next();
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end();
          return;
        }
        void (async () => {
          const resolved = await resolveFontRequest(
            input.root,
            pathname,
            String(request.headers["accept-encoding"] ?? ""),
          );
          if (resolved.status !== 200 || resolved.filePath === undefined) {
            response.statusCode = resolved.status;
            response.end();
            return;
          }
          const bytes = await readFile(resolved.filePath);
          response.statusCode = 200;
          response.setHeader("Vary", "Accept-Encoding");
          response.setHeader("Cache-Control", resolved.cacheControl ?? "no-store");
          response.setHeader("Content-Type", resolved.contentType ?? "application/octet-stream");
          response.setHeader("Content-Length", String(bytes.byteLength));
          // The ETag covers the bytes actually sent, so a cached brotli body
          // never revalidates against the identity digest.
          response.setHeader("ETag", `"${createHash("sha256").update(bytes).digest("hex")}"`);
          if (resolved.contentEncoding !== undefined) {
            response.setHeader("Content-Encoding", resolved.contentEncoding);
          }
          if (request.method === "HEAD") {
            response.end();
            return;
          }
          createReadStream(resolved.filePath).pipe(response);
        })();
      });
    },
  };
}

export function word2mowDevConverter(input: { readonly convertPath: string }): Plugin {
  const convertPath = input.convertPath.trim();
  return {
    name: "officedex-word2mow-dev-converter",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname !== IMPORT_ROUTE && pathname !== EXPORT_ROUTE) {
          next();
          return;
        }
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.setHeader("Allow", "POST, OPTIONS");
          response.end();
          return;
        }
        if (convertPath.length === 0) {
          sendText(response, 503, "word2mow convert is not staged; run `npm run prefetch:word2mow`.");
          return;
        }
        void (async () => {
          let scratch: string | undefined;
          try {
            const body = await readBody(request);
            scratch = await mkdtemp(path.join(tmpdir(), "officedex-word2mow-"));
            const importing = pathname === IMPORT_ROUTE;
            const output = importing
              ? await runImport(convertPath, scratch, body)
              : await runExport(convertPath, scratch, body);
            response.statusCode = 200;
            response.setHeader("Content-Type", importing ? ZIP_MIME : DOCX_MIME);
            response.setHeader("Content-Length", String(output.byteLength));
            response.setHeader("Cache-Control", "no-store");
            response.end(output);
          } catch (cause) {
            sendText(response, 400, cause instanceof Error ? cause.message : "Conversion failed.");
          } finally {
            if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
          }
        })();
      });
    },
  };
}

async function runImport(convertPath: string, scratch: string, body: Buffer): Promise<Buffer> {
  if (body.byteLength === 0) throw new TypeError("The DOCX upload was empty.");
  const inputPath = path.join(scratch, "input.docx");
  const packageDirectory = path.join(scratch, "document.mow.dir");
  await writeFile(inputPath, body);
  await runConvert(convertPath, ["import", "-i", inputPath, "-m", packageDirectory]);

  const entries = await readMowDirectory(packageDirectory);
  if (entries[CONTENT_FILE_NAME] === undefined || entries[CONTENT_FILE_NAME].byteLength === 0) {
    throw new TypeError("word2mow import did not produce content.json.");
  }
  return Buffer.from(zipSync(entries, { level: 6 }));
}

async function runExport(convertPath: string, scratch: string, body: Buffer): Promise<Buffer> {
  const packageDirectory = path.join(scratch, "document.mow.dir");
  const outputPath = path.join(scratch, "output.docx");
  await writeMowDirectory(packageDirectory, body);
  await dropWriterRuntimeNodeIdsFile(path.join(packageDirectory, CONTENT_FILE_NAME));
  await runConvert(convertPath, ["export", "-m", packageDirectory, "-o", outputPath]);

  const output = await readFile(outputPath);
  if (output.byteLength === 0) throw new TypeError("word2mow produced an empty DOCX file.");
  return output;
}

/**
 * Writer stamps `nodeId` on live blocks. It is not an OOXML field, and the
 * pinned converter rejects it on any table. Drop only that key; other unknown
 * keys stay so the converter still fails closed.
 *
 * Rewrites the file only when a key was removed.
 */
export async function dropWriterRuntimeNodeIdsFile(contentPath: string): Promise<void> {
  const raw = await readFile(contentPath, "utf8");
  const snapshot: unknown = JSON.parse(raw);
  if (!dropWriterRuntimeNodeIds(snapshot)) return;
  await writeFile(contentPath, JSON.stringify(snapshot));
}

export function dropWriterRuntimeNodeIds(value: unknown): boolean {
  let removed = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (Object.hasOwn(record, "nodeId")) {
      delete record.nodeId;
      removed = true;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return removed;
}

/** The export the Vite dev server serves. E2E hits this, not the Go handler. */
export async function exportDocxFromMowZip(convertPath: string, body: Buffer): Promise<Buffer> {
  const scratch = await mkdtemp(path.join(tmpdir(), "officedex-word2mow-"));
  try {
    return await runExport(convertPath, scratch, body);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Unpack a MOW ZIP into `root`, applying the shared path whitelist. */
export async function writeMowDirectory(root: string, archive: Buffer): Promise<void> {
  if (archive.byteLength === 0) throw new TypeError("The MOW package was empty.");
  const entries = unzipSync(new Uint8Array(archive));
  await mkdir(root, { recursive: true });
  let sawContent = false;
  for (const [archivePath, bytes] of Object.entries(entries)) {
    if (archivePath.endsWith("/")) continue;
    const safePath = normalizeMowArchivePath(archivePath);
    if (safePath === CONTENT_FILE_NAME) sawContent = bytes.byteLength > 0;
    const destination = path.join(root, safePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  if (!sawContent) throw new TypeError("The MOW package has no content.json at its root.");
}

/** Read a MOW directory the converter produced, sorted for a stable archive. */
export async function readMowDirectory(root: string): Promise<Record<string, Uint8Array>> {
  const entries: Record<string, Uint8Array> = {};
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(directory, child.name);
      if (child.isDirectory()) {
        await visit(full);
      } else if (child.isFile()) {
        const archivePath = normalizeMowArchivePath(path.relative(root, full).split(path.sep).join("/"));
        entries[archivePath] = new Uint8Array(await readFile(full));
      }
    }
  };
  await visit(root);
  return entries;
}

function runConvert(convertPath: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(convertPath, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, CONVERT_TIMEOUT_MS);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4096) stderr += chunk.slice(0, 4096 - stderr.length);
    });
    child.once("error", (cause: Error) => {
      clearTimeout(timeout);
      reject(cause);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      const how = signal === null ? `exit ${String(code)}` : signal;
      reject(new Error(`word2mow convert failed (${how}): ${stderr.trim()}`));
    });
  });
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) throw new RangeError(`The request exceeds ${String(MAX_BODY_BYTES)} bytes.`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function sendText(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
}

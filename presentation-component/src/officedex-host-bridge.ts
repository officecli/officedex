const PROTOCOL_VERSION = 1;
// This must match the pinned fegit presentation runtime and mop-convert revision in
// officedex-component.json. The runtime treats a missing header as schema 0.
const MOP_SCHEMA_VERSION = 975;
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

interface LoadedPresentation {
  /** data: URI → original mop-asset:/ URI, applied before content reaches the host. */
  assetUriRestore: Map<string, string>;
  sessionId: string;
  fileId: string;
  title: string;
  sourceFileName: string;
  content: Uint8Array;
  documentRevision: number;
  assets: Map<string, { contentType: string; data: Uint8Array }>;
}

interface HostResponse {
  type: "presentation:response";
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const pending = new Map<
  string,
  { resolve(value: unknown): void; reject(error: Error): void; timeout: number }
>();
let requestSequence = 0;
let loaded: LoadedPresentation | undefined;
const snapshotWaiters = new Set<() => void>();

function notifySnapshotSaved() {
  const waiters = [...snapshotWaiters];
  snapshotWaiters.clear();
  for (const resolve of waiters) resolve();
}

/** Resolves `true` when the editor persists a snapshot within `timeoutMs`. */
function waitForSnapshot(timeoutMs: number): Promise<boolean> {
  if (timeoutMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onSaved = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    const timer = window.setTimeout(() => {
      snapshotWaiters.delete(onSaved);
      resolve(false);
    }, timeoutMs);
    snapshotWaiters.add(onSaved);
  });
}

function post(message: unknown, transfer: Transferable[] = []) {
  window.parent.postMessage(message, "*", transfer);
}

function requestHost<T>(
  type: string,
  payload: Record<string, unknown>,
  transfer: Transferable[] = [],
): Promise<T> {
  const requestId = `officedex-presentation-${Date.now()}-${++requestSequence}`;
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`OfficeDex Presentation request timed out: ${type}`));
    }, 120_000);
    pending.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timeout,
    });
    post({ type, requestId, ...payload }, transfer);
  });
}

function normalizeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: URL; method: string; headers: Headers; body?: BodyInit | null } {
  if (input instanceof Request) {
    return {
      url: new URL(input.url, window.location.href),
      method: (init?.method ?? input.method ?? "GET").toUpperCase(),
      headers: new Headers(init?.headers ?? input.headers),
      body: init?.body,
    };
  }
  return {
    url: new URL(String(input), window.location.href),
    method: (init?.method ?? "GET").toUpperCase(),
    headers: new Headers(init?.headers),
    body: init?.body,
  };
}

async function requestBytes(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Uint8Array> {
  if (init?.body instanceof ArrayBuffer) return new Uint8Array(init.body);
  if (ArrayBuffer.isView(init?.body)) {
    const view = init.body as ArrayBufferView;
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (input instanceof Request) return new Uint8Array(await input.clone().arrayBuffer());
  if (init?.body instanceof Blob) return new Uint8Array(await init.body.arrayBuffer());
  return new Uint8Array();
}

function mopEndpoint(url: URL): string | undefined {
  const marker = "/api/osuite/mop/";
  const index = url.pathname.indexOf(marker);
  return index < 0 ? undefined : url.pathname.slice(index + marker.length);
}

/**
 * MOP asset references resolve against an HTTP asset base the engine loads via
 * plain <img>/SVG hrefs — which bypass the patched fetch and 404 against the
 * embedding origin. Inlining every known asset as a data: URI on load makes
 * images render in every context (canvas, SVG defs, the thumbnail worker);
 * restoreAssetUris swaps them back before content reaches the host so the
 * mop-convert export keeps its mop-asset:/ contract.
 */
function base64FromBytes(data: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < data.length; index += CHUNK) {
    binary += String.fromCharCode(...data.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

function visitResourceUris(node: unknown, replace: (uri: string) => string | undefined) {
  if (Array.isArray(node)) {
    for (const item of node) visitResourceUris(item, replace);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.resourceUri === "string") {
    const next = replace(record.resourceUri);
    if (next !== undefined) record.resourceUri = next;
  }
  for (const value of Object.values(record)) visitResourceUris(value, replace);
}

export function inlineAssetUris(
  content: Uint8Array,
  assets: Map<string, { contentType: string; data: Uint8Array }>,
): { content: Uint8Array; restore: Map<string, string> } {
  const restore = new Map<string, string>();
  if (assets.size === 0) return { content, restore };
  try {
    const document = JSON.parse(new TextDecoder().decode(content));
    const inlined = new Map<string, string>();
    visitResourceUris(document, (uri) => {
      if (!uri.startsWith("mop-asset:/")) return undefined;
      const cached = inlined.get(uri);
      if (cached) return cached;
      const asset = assets.get(uri.slice("mop-asset:/".length));
      if (!asset) return undefined;
      const dataUri = `data:${asset.contentType || "application/octet-stream"};base64,${base64FromBytes(asset.data)}`;
      inlined.set(uri, dataUri);
      restore.set(dataUri, uri);
      return dataUri;
    });
    if (restore.size === 0) return { content, restore };
    return { content: new TextEncoder().encode(JSON.stringify(document)), restore };
  } catch {
    return { content, restore };
  }
}

export function restoreAssetUris(content: Uint8Array, restore: Map<string, string>): Uint8Array {
  if (restore.size === 0) return content;
  try {
    const document = JSON.parse(new TextDecoder().decode(content));
    let changed = false;
    visitResourceUris(document, (uri) => {
      const original = restore.get(uri);
      if (original) {
        changed = true;
        return original;
      }
      return undefined;
    });
    return changed ? new TextEncoder().encode(JSON.stringify(document)) : content;
  } catch {
    return content;
  }
}

function packageHeaders(state: LoadedPresentation): Headers {
  return new Headers({
    "Content-Type": "application/octet-stream",
    "X-MOP-Magic": "mop0",
    "X-MOP-Protocol-Version": "1",
    "X-MOP-Schema-Version": String(MOP_SCHEMA_VERSION),
    "X-MOP-Revision": String(state.documentRevision),
    "X-MOP-Title": encodeURIComponent(state.title),
    "X-MOP-Source-File-Name": encodeURIComponent(state.sourceFileName),
  });
}

function installFetchBridge() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = normalizeRequest(input, init);
    const endpoint = mopEndpoint(request.url);
    if (!endpoint) return nativeFetch(input, init);
    const state = loaded;
    if (!state) return new Response("Presentation is not loaded", { status: 409 });

    if (endpoint === "content" && request.method === "GET") {
      return new Response(state.content.slice(), {
        status: 200,
        headers: packageHeaders(state),
      });
    }

    if (endpoint === "content" && request.method === "PUT") {
      const content = await requestBytes(input, init);
      const baseRevision = Number(request.headers.get("X-MOP-Base-Revision") ?? state.documentRevision);
      const revision = Number(request.headers.get("X-MOP-Revision") ?? baseRevision + 1);
      const buffer = restoreAssetUris(content, state.assetUriRestore).slice().buffer;
      await requestHost("presentation:save-snapshot", {
        sessionId: state.sessionId,
        content: buffer,
        baseRevision,
        revision,
      }, [buffer]);
      state.content = content;
      state.documentRevision = revision;
      post({ type: "presentation:dirty-changed", dirty: true });
      notifySnapshotSaved();
      return new Response(null, {
        status: 204,
        headers: { "X-MOP-Revision": String(revision) },
      });
    }

    if (endpoint === "examples" && request.method === "GET") {
      return Response.json({
        items: [
          {
            fileId: state.fileId,
            title: state.title,
            sourceFileName: state.sourceFileName,
            route: `/p/${state.fileId}`,
            slideCount: 0,
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }

    if (endpoint.startsWith("assets/")) {
      const relativePath = decodeURIComponent(endpoint.slice("assets/".length));
      if (!relativePath) return new Response("Asset path is required", { status: 400 });
      if (request.method === "GET") {
        const asset = state.assets.get(relativePath);
        if (!asset) return new Response("Not found", { status: 404 });
        return new Response(asset.data.slice(), {
          status: 200,
          headers: { "Content-Type": asset.contentType || "application/octet-stream" },
        });
      }
      if (request.method === "PUT") {
        const data = await requestBytes(input, init);
        const buffer = data.slice().buffer;
        const result = await requestHost<Record<string, unknown>>(
          "presentation:save-asset",
          {
            sessionId: state.sessionId,
            relativePath,
            contentType: request.headers.get("Content-Type") ?? "application/octet-stream",
            data: buffer,
          },
          [buffer],
        );
        state.assets.set(relativePath, {
          contentType: request.headers.get("Content-Type") ?? "application/octet-stream",
          data,
        });
        return Response.json(result);
      }
    }

    if (endpoint === "export" && request.method === "POST") {
      const revision = Number(request.url.searchParams.get("revision") ?? state.documentRevision);
      const result = await requestHost<{
        revision: number;
        fileName: string;
        data: ArrayBuffer;
      }>("presentation:export-pptx", {
        sessionId: state.sessionId,
        revision,
      });
      post({ type: "presentation:dirty-changed", dirty: false });
      return new Response(result.data, {
        status: 200,
        headers: {
          "Content-Type": PPTX_CONTENT_TYPE,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName || state.sourceFileName)}`,
          "X-MOP-Revision": String(result.revision ?? revision),
        },
      });
    }

    if (endpoint === "rendered-pictures") {
      return Response.json({}, { status: 200 });
    }
    return new Response("Unsupported OfficeDex Presentation endpoint", { status: 405 });
  };
}

function waitForPresentation(): Promise<LoadedPresentation> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (message?.type === "presentation:response") {
        const response = message as HostResponse;
        const request = pending.get(response.requestId);
        if (!request) return;
        pending.delete(response.requestId);
        window.clearTimeout(request.timeout);
        if (response.ok) request.resolve(response.result);
        else request.reject(new Error(response.error || "OfficeDex Presentation request failed"));
        return;
      }
      if (message?.type !== "presentation:load") return;
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        reject(new Error(`Unsupported OfficeDex Presentation protocol ${message.protocolVersion}`));
        return;
      }
      const assets = new Map<string, { contentType: string; data: Uint8Array }>();
      for (const asset of Array.isArray(message.assets) ? message.assets : []) {
        assets.set(asset.path, {
          contentType: asset.contentType,
          data: new Uint8Array(asset.data),
        });
      }
      const { content: inlinedContent, restore } = inlineAssetUris(new Uint8Array(message.content), assets);
      loaded = {
        sessionId: message.sessionId,
        fileId: message.fileId,
        title: message.title,
        sourceFileName: message.sourceFileName,
        content: inlinedContent,
        documentRevision: message.documentRevision ?? 0,
        assets,
        assetUriRestore: restore,
      };
      window.history.replaceState({}, "", `/p/${encodeURIComponent(message.fileId)}?officedexEmbed=1`);
      resolve(loaded);
    };
    window.addEventListener("message", onMessage);
    post({
      type: "presentation:embed-ready",
      protocolVersion: PROTOCOL_VERSION,
    });
  });
}

const OFFICE_JS_READY_TIMEOUT_MS = 30_000;
const DEFAULT_AWAIT_SNAPSHOT_MS = 8_000;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/**
 * The editor installs `PowerPoint`/`Office`/`OfficeExtension` on this window
 * once the workbench mounts (installLocalMopEditorOfficeJs). Wait for it
 * instead of failing when a script arrives during the editor boot.
 */
function waitForOfficeJs(timeoutMs = OFFICE_JS_READY_TIMEOUT_MS): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const globals = window as unknown as Record<string, unknown>;
      const powerPoint = globals.PowerPoint as { run?: unknown } | undefined;
      if (powerPoint && typeof powerPoint.run === "function") {
        resolve(globals);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("The presentation editor is not ready for scripts (Office.js is unavailable)."));
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function cloneScriptResult(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * The local (browser-local/desktop-local) presentation session journals
 * edits and only persists a snapshot on an explicit save: it listens for
 * Ctrl/Cmd+S on the window (capture phase). Dispatch that shortcut so the
 * Office.js edit is flushed through `PUT /api/osuite/mop/content` before the
 * host exports the deck.
 */
function requestExplicitSave() {
  for (const modifier of ["metaKey", "ctrlKey"] as const) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        [modifier]: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

async function executeScript(source: string, awaitSnapshotMs: number): Promise<{
  result: unknown;
  snapshotSaved: boolean;
}> {
  const globals = await waitForOfficeJs();
  const fn = new AsyncFunction("PowerPoint", "Office", "OfficeExtension", source);
  const snapshot = waitForSnapshot(awaitSnapshotMs);
  const result = await fn(globals.PowerPoint, globals.Office, globals.OfficeExtension);
  if (awaitSnapshotMs > 0) requestExplicitSave();
  const snapshotSaved = await snapshot;
  return { result: cloneScriptResult(result), snapshotSaved };
}

/**
 * The editor exposes one host operation beyond scripts: replace the open
 * document. Stepping through a deck's recorded history reuses the running
 * editor instead of reloading the iframe, which would cost a full runtime boot
 * and read as a page refresh.
 */
interface EmbeddedDocumentHost {
  readonly version: number;
  replace(
    descriptor: Record<string, unknown>,
    options?: { persist?: boolean; activeSlide?: number },
  ): Promise<void>;
}

function embeddedDocumentHost(): EmbeddedDocumentHost | undefined {
  const host = (window as unknown as Record<string, unknown>).__presentationEmbeddedDocument;
  if (!host || typeof (host as EmbeddedDocumentHost).replace !== "function") return undefined;
  return host as EmbeddedDocumentHost;
}

/** Waits for the editor to publish its host API; it appears as the editor mounts. */
async function waitForDocumentHost(timeoutMs = 15_000): Promise<EmbeddedDocumentHost> {
  const started = Date.now();
  for (;;) {
    const host = embeddedDocumentHost();
    if (host) return host;
    if (Date.now() - started > timeoutMs) {
      throw new Error("This presentation runtime cannot swap documents in place.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

async function swapDocument(message: Record<string, unknown>): Promise<number> {
  const state = loaded;
  if (!state) throw new Error("No presentation is open.");
  const host = await waitForDocumentHost();
  const assets = new Map<string, { contentType: string; data: Uint8Array }>();
  for (const asset of Array.isArray(message.assets) ? message.assets : []) {
    const entry = asset as { path: string; contentType: string; data: ArrayBuffer };
    assets.set(entry.path, { contentType: entry.contentType, data: new Uint8Array(entry.data) });
  }
  const revision = Number(message.documentRevision ?? 0);
  const { content, restore } = inlineAssetUris(new Uint8Array(message.content as ArrayBuffer), assets);
  await host.replace(
    {
      content,
      magic: "mop0",
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: MOP_SCHEMA_VERSION,
      documentRevision: revision,
      assetBaseUrl: `${window.location.origin}/api/osuite/mop/assets/?fileId=${encodeURIComponent(state.fileId)}`,
    },
    {
      persist: message.persist === true,
      activeSlide: typeof message.activeSlide === "number" ? message.activeSlide : undefined,
    },
  );
  // Only once the editor holds the new document does it become what this
  // session serves and saves; a failed swap must leave the old one in place.
  state.content = content;
  state.assets = assets;
  state.assetUriRestore = restore;
  state.documentRevision = revision;
  if (typeof message.title === "string" && message.title) state.title = message.title;
  return revision;
}

function installDocumentSwapBridge() {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.type !== "presentation:swap-document") return;
    const requestId = String(message.requestId ?? "");
    void swapDocument(message as Record<string, unknown>).then(
      (documentRevision) => post({ type: "presentation:swap-result", requestId, ok: true, documentRevision }),
      (error: unknown) =>
        post({
          type: "presentation:swap-result",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  });
}

function installScriptBridge() {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.type !== "presentation:execute-script") return;
    const requestId = String(message.requestId ?? "");
    const source = typeof message.source === "string" ? message.source : "";
    const awaitSnapshotMs =
      typeof message.awaitSnapshotMs === "number" ? message.awaitSnapshotMs : DEFAULT_AWAIT_SNAPSHOT_MS;
    void executeScript(source, awaitSnapshotMs).then(
      ({ result, snapshotSaved }) =>
        post({ type: "presentation:script-result", requestId, ok: true, result, snapshotSaved }),
      (error: unknown) =>
        post({
          type: "presentation:script-result",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          snapshotSaved: false,
        }),
    );
  });
}

export async function installOfficeDexPresentationBridge(): Promise<void> {
  installFetchBridge();
  installScriptBridge();
  installDocumentSwapBridge();
  await waitForPresentation();
}

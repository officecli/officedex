import { embeddedPresentationDocumentPath } from "./embedded-runtime";

const PROTOCOL_VERSION = 1;
/**
 * Stamped on every package this bridge hands the editor. The runtime's
 * `assertPackageCapabilities` rejects anything that does not match the schema
 * its bundled WASM reports, and it treats a missing header as schema 0.
 *
 * The same pair lives in Go, at `internal/mophttp/capabilities.go`, for the
 * packaged app's HTTP path. Two copies, and only one of them was updated when
 * the runtime went to 1081 — so every presentation opened to
 * "MOP schema mismatch: package=975, runtime=1081" with nothing else wrong.
 *
 * Both are now pinned: Go's against the real mop-wasm engine
 * (TestDefaultCapabilitiesMatchBundledWasm), and this one against Go's
 * (presentation-component/src/schemaVersion.test.ts). Updating one alone fails.
 */
const MOP_SCHEMA_VERSION = 1097;
const PPTX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

interface LoadedPresentation {
  /** Inlined URI → original mop-asset:/ URI, applied before content reaches the host. */
  assetUriRestore: Map<string, string>;
  /** Object URLs minted for assets too large to inline; revoked when replaced. */
  assetObjectUrls: string[];
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
 *
 * The document codec refuses any single string over 8 MiB, and one such
 * string fails the whole deck ("resource limit exceeded for string bytes"), so
 * a deck with one large photo could not be opened at all. An asset whose data:
 * URI would come near that is handed over as a blob: object URL instead, which
 * the engine also accepts. It is a few dozen characters long, at the cost that
 * a context which cannot follow external references (an SVG rasterised on its
 * own) draws that picture blank.
 */
export const INLINE_ASSET_BYTE_LIMIT = 4 * 1024 * 1024;

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
): { content: Uint8Array; restore: Map<string, string>; objectUrls: string[] } {
  const restore = new Map<string, string>();
  const objectUrls: string[] = [];
  if (assets.size === 0) return { content, restore, objectUrls };
  try {
    const document = JSON.parse(new TextDecoder().decode(content));
    const inlined = new Map<string, string>();
    visitResourceUris(document, (uri) => {
      if (!uri.startsWith("mop-asset:/")) return undefined;
      const cached = inlined.get(uri);
      if (cached) return cached;
      const asset = assets.get(uri.slice("mop-asset:/".length));
      if (!asset) return undefined;
      const contentType = asset.contentType || "application/octet-stream";
      let inlineUri: string;
      if (asset.data.byteLength > INLINE_ASSET_BYTE_LIMIT) {
        inlineUri = URL.createObjectURL(new Blob([asset.data.slice()], { type: contentType }));
        objectUrls.push(inlineUri);
      } else {
        inlineUri = `data:${contentType};base64,${base64FromBytes(asset.data)}`;
      }
      inlined.set(uri, inlineUri);
      restore.set(inlineUri, uri);
      return inlineUri;
    });
    if (restore.size === 0) return { content, restore, objectUrls };
    return { content: new TextEncoder().encode(JSON.stringify(document)), restore, objectUrls };
  } catch {
    revokeAssetObjectUrls(objectUrls);
    return { content, restore: new Map(), objectUrls: [] };
  }
}

export function revokeAssetObjectUrls(objectUrls: string[]) {
  for (const url of objectUrls) URL.revokeObjectURL(url);
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
      const { content: inlinedContent, restore, objectUrls } = inlineAssetUris(new Uint8Array(message.content), assets);
      loaded = {
        sessionId: message.sessionId,
        fileId: message.fileId,
        title: message.title,
        sourceFileName: message.sourceFileName,
        content: inlinedContent,
        documentRevision: message.documentRevision ?? 0,
        assets,
        assetUriRestore: restore,
        assetObjectUrls: objectUrls,
      };
      window.history.replaceState(
        {},
        "",
        `${embeddedPresentationDocumentPath(message.fileId)}?officedexEmbed=1`,
      );
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

/**
 * What the editor's own save session reports: how many edits it still holds in
 * memory and what it last did with them. Mirrors `OfficeDexPptxSaveState` in
 * the presentation app's `officedex-embed-bridge.ts`.
 */
export interface EditorSaveState {
  readonly documentRevision: number;
  readonly pendingChangeCount: number;
  readonly status: string;
}

/**
 * The handle the editor hands out when its workbench mounts
 * (`officedex:pptx-workbench-ready`, dispatched by the presentation runtime
 * whenever the route carries `officedexEmbed=1`). `flush` is the session's own
 * save: it writes the journaled edits through `PUT /api/osuite/mop/content`
 * and resolves with the persisted revision, or resolves immediately when there
 * is nothing to write.
 */
export interface EditorWorkbenchHandle {
  readonly fileId: string;
  /** Mounted workbench identity and its pending notes input buffer. */
  readonly workbench?: {
    core?: { view?: { notesArea?: { flushPendingNotesText?(): void } } };
  };
  flush(reason?: "explicit-save" | "export" | "close"): Promise<number>;
  getSaveState?(): EditorSaveState | undefined;
  subscribeSaveState?(listener: (state: EditorSaveState) => void): () => void;
}

/** The editor is holding, or failing to persist, edits that are not in a snapshot yet. */
export function editorHoldsEdits(state: EditorSaveState | undefined): boolean {
  if (!state) return false;
  return state.pendingChangeCount > 0 || ["dirty", "saving", "failed", "offline"].includes(state.status);
}

export interface EditorSaveBridge {
  /** The mounted workbench, once the runtime has announced one. */
  readonly workbench: EditorWorkbenchHandle | undefined;
  /** Writes the editor's in-memory edits to the host's snapshot. */
  flush(): Promise<{ revision: number }>;
  dispose(): void;
}

const WORKBENCH_READY_TIMEOUT_MS = 15_000;

/**
 * Hands the editor's save session to the host.
 *
 * Two things cross here, and before this neither did:
 *
 *   - **Dirty.** The host's only word that a deck had changed was the snapshot
 *     PUT, and the local session only PUTs on an explicit save. A user who
 *     typed a title and never pressed ⌘S was therefore never dirty: the tab
 *     showed no dot, the bar said Saved, and a save exported the previous
 *     snapshot. The session's own save state is subscribed to here and
 *     forwarded as `presentation:dirty-changed`, so an edit is dirty the moment
 *     it is made.
 *
 *   - **Flush.** The host could only ask for a save by dispatching ⌘S into the
 *     window and hoping a snapshot followed, which cannot tell "nothing to
 *     save" from "the save never happened". `presentation:flush` calls the
 *     session's `flush` and answers with the revision it persisted — or with
 *     the error, so the host can refuse to call the deck saved.
 *
 * Only the editor's own half is reported here. A snapshot that reached the
 * host but is not yet exported is unsaved too, and the host already knows:
 * it answered the snapshot write. Folding that in here would mean this side
 * could never say "clean" again after the first flush — and a change that
 * never changes is never announced, so every edit after the first save would
 * go unreported.
 */
export function createEditorSaveBridge(
  target: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">,
  post: (message: { type: "presentation:dirty-changed"; dirty: boolean }) => void,
  options: { workbenchReadyTimeoutMs?: number } = {},
): EditorSaveBridge {
  let workbench: EditorWorkbenchHandle | undefined;
  let unsubscribe: (() => void) | undefined;
  let editorHolds = false;
  let announced: boolean | undefined;
  const readyWaiters = new Set<(handle: EditorWorkbenchHandle) => void>();
  const readyTimeoutMs = options.workbenchReadyTimeoutMs ?? WORKBENCH_READY_TIMEOUT_MS;

  const announce = () => {
    if (editorHolds === announced) return;
    announced = editorHolds;
    post({ type: "presentation:dirty-changed", dirty: editorHolds });
  };

  const onReady = (event: Event) => {
    const detail = (event as CustomEvent<EditorWorkbenchHandle | undefined>).detail;
    if (!detail || typeof detail.flush !== "function") return;
    unsubscribe?.();
    workbench = detail;
    editorHolds = editorHoldsEdits(detail.getSaveState?.());
    announce();
    unsubscribe = detail.subscribeSaveState?.((state) => {
      if (workbench !== detail) return;
      editorHolds = editorHoldsEdits(state);
      announce();
    });
    for (const resolve of [...readyWaiters]) resolve(detail);
    readyWaiters.clear();
  };

  const onDetached = (event: Event) => {
    const detail = (event as CustomEvent<{ workbench?: object } | undefined>).detail;
    if (!workbench) return;
    // A different workbench detaching (a swap's old one) says nothing about this one.
    if (detail?.workbench && workbench.workbench && detail.workbench !== workbench.workbench) return;
    unsubscribe?.();
    unsubscribe = undefined;
    workbench = undefined;
    editorHolds = false;
    announce();
  };

  target.addEventListener("officedex:pptx-workbench-ready", onReady);
  target.addEventListener("officedex:pptx-workbench-detached", onDetached);

  const waitForWorkbench = () =>
    new Promise<EditorWorkbenchHandle>((resolve, reject) => {
      if (workbench) {
        resolve(workbench);
        return;
      }
      const timer = target.setTimeout(() => {
        readyWaiters.delete(onReadyOnce);
        reject(new Error("The presentation editor has not finished mounting, so its edits cannot be saved yet."));
      }, readyTimeoutMs);
      const onReadyOnce = (handle: EditorWorkbenchHandle) => {
        target.clearTimeout(timer);
        resolve(handle);
      };
      readyWaiters.add(onReadyOnce);
    });

  return {
    get workbench() {
      return workbench;
    },
    async flush() {
      const handle = await waitForWorkbench();
      // Notes debounce input by 100ms. Saving immediately after typing must
      // commit that buffer before the session snapshots the document, without
      // blurring the editor or requiring a second Cmd+S.
      handle.workbench?.core?.view?.notesArea?.flushPendingNotesText?.();
      const revision = await handle.flush("explicit-save");
      // The session's state subscription says "saved" on its own; reading it
      // here as well means the host never sees a flush succeed while the
      // bridge still calls the editor dirty.
      editorHolds = editorHoldsEdits(handle.getSaveState?.());
      announce();
      return { revision };
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      workbench = undefined;
      target.removeEventListener("officedex:pptx-workbench-ready", onReady);
      target.removeEventListener("officedex:pptx-workbench-detached", onDetached);
      readyWaiters.clear();
    },
  };
}

/** Mirrors `PresentationZoom` in `src/shared/presentationProtocol.ts`. */
export type EditorZoom = number | "fit";

/**
 * What the zoom bridge needs from a mounted workbench: the editor facade's view
 * controller (`editorFacade.views`), and the main area's zoom mode, which the
 * controller does not expose — it is the one way to tell a fitted slide that a
 * resize rescaled from a percentage the user picked.
 */
export interface EditorZoomWorkbench {
  readonly editorFacade?: {
    views?: {
      getScale(): number;
      setScale(scale: number): void;
      zoomToFit(): void;
      on(event: "zoomScaleDidChange", listener: () => void): () => void;
    };
  };
  readonly core?: { view?: { mainArea?: { zoomMode?: "fit" | "custom" } } };
}

export interface EditorZoomBridge {
  /** The host's zoom: applied to the mounted workbench, or kept for the next. */
  set(zoom: EditorZoom): void;
  dispose(): void;
}

function sameZoom(left: EditorZoom, right: EditorZoom): boolean {
  return typeof left === "number" && typeof right === "number"
    ? Math.round(left) === Math.round(right)
    : left === right;
}

/**
 * Opens each workbench at the host's zoom and reports the user's changes.
 *
 * A workbench mounts fitted to the window, so the host's zoom is applied when
 * it says it is ready. What is on screen after that is the baseline; only a
 * zoom that differs from it is the user's. A fitted slide reports as `"fit"`
 * however the window rescales it — a resize is not a choice.
 */
export function createEditorZoomBridge(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  post: (message: { type: "presentation:zoom-changed"; zoom: EditorZoom }) => void,
): EditorZoomBridge {
  let expected: EditorZoom | undefined;
  let workbench: EditorZoomWorkbench | undefined;
  let baseline: EditorZoom | undefined;
  let unsubscribe: (() => void) | undefined;

  const current = (): EditorZoom | undefined => {
    const views = workbench?.editorFacade?.views;
    if (!views) return undefined;
    if (workbench?.core?.view?.mainArea?.zoomMode === "fit") return "fit";
    const scale = views.getScale();
    return Number.isFinite(scale) ? Math.round(scale * 100) : undefined;
  };

  const observe = () => {
    const zoom = current();
    if (zoom === undefined) return;
    if (baseline === undefined) {
      if (expected === undefined || sameZoom(zoom, expected)) baseline = zoom;
      return;
    }
    if (sameZoom(zoom, baseline)) return;
    baseline = zoom;
    // A workbench mounted later (a swap) opens where the user left this one.
    expected = zoom;
    post({ type: "presentation:zoom-changed", zoom });
  };

  const apply = () => {
    const views = workbench?.editorFacade?.views;
    if (!views || expected === undefined) return;
    if (expected === "fit") views.zoomToFit();
    else views.setScale(expected / 100);
  };

  const onReady = (event: Event) => {
    const detail = (event as CustomEvent<{ workbench?: EditorZoomWorkbench } | undefined>).detail;
    unsubscribe?.();
    workbench = detail?.workbench;
    baseline = undefined;
    unsubscribe = workbench?.editorFacade?.views?.on("zoomScaleDidChange", observe);
    apply();
    observe();
  };

  const onDetached = (event: Event) => {
    const detail = (event as CustomEvent<{ workbench?: object } | undefined>).detail;
    if (!workbench || (detail?.workbench && detail.workbench !== workbench)) return;
    unsubscribe?.();
    unsubscribe = undefined;
    workbench = undefined;
  };

  target.addEventListener("officedex:pptx-workbench-ready", onReady);
  target.addEventListener("officedex:pptx-workbench-detached", onDetached);

  return {
    set(zoom) {
      expected = zoom;
      baseline = undefined;
      apply();
      observe();
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      workbench = undefined;
      target.removeEventListener("officedex:pptx-workbench-ready", onReady);
      target.removeEventListener("officedex:pptx-workbench-detached", onDetached);
    },
  };
}

function isEditorZoom(value: unknown): value is EditorZoom {
  return value === "fit" || (typeof value === "number" && Number.isFinite(value) && value > 0);
}

function installZoomBridge() {
  const zoomBridge = createEditorZoomBridge(window, post);
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.type !== "presentation:set-zoom" || !isEditorZoom(message.zoom)) return;
    zoomBridge.set(message.zoom);
  });
}

let saveBridge: EditorSaveBridge = {
  workbench: undefined,
  flush: () => Promise.reject(new Error("The presentation host bridge is not installed.")),
  dispose() {},
};

function installFlushBridge() {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message?.type !== "presentation:flush") return;
    const requestId = String(message.requestId ?? "");
    void saveBridge.flush().then(
      ({ revision }) => post({ type: "presentation:flush-result", requestId, ok: true, revision }),
      (error: unknown) =>
        post({
          type: "presentation:flush-result",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  });
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
  const { content, restore, objectUrls } = inlineAssetUris(new Uint8Array(message.content as ArrayBuffer), assets);
  try {
    await replaceDocument(host, state, content, revision, message);
  } catch (error) {
    revokeAssetObjectUrls(objectUrls);
    throw error;
  }
  // Only once the editor holds the new document does it become what this
  // session serves and saves; a failed swap must leave the old one in place.
  revokeAssetObjectUrls(state.assetObjectUrls);
  state.content = content;
  state.assets = assets;
  state.assetUriRestore = restore;
  state.assetObjectUrls = objectUrls;
  state.documentRevision = revision;
  if (typeof message.title === "string" && message.title) state.title = message.title;
  return revision;
}

async function replaceDocument(
  host: Awaited<ReturnType<typeof waitForDocumentHost>>,
  state: LoadedPresentation,
  content: Uint8Array,
  revision: number,
  message: Record<string, unknown>,
) {
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

/** Exposes the narrow desktop video sink consumed by the presentation app. */
function installDesktopHostBridge() {
  const host = {
    sessionMode: "desktop-local" as const,
    saveVideo: async (request: {
      content: ArrayBuffer;
      contentType: "video/mp4";
      fileName: string;
    }) => {
      const state = loaded;
      if (!state) throw new Error("No presentation is loaded.");
      const content = request.content.slice(0);
      return requestHost<{ fileName: string; path?: string }>(
        "presentation:save-video",
        {
          sessionId: state.sessionId,
          revision: state.documentRevision,
          fileName: request.fileName,
          contentType: request.contentType,
          content,
        },
        [content],
      );
    },
  };
  Object.defineProperty(window, "__PRESENTATION_DESKTOP_HOST__", {
    configurable: true,
    value: host,
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
          /*
           * The stack, not just the message.
           *
           * A script that dies inside the editor returns a bare string, and the
           * host records exactly that string in the renderer log. For
           * `Editing is not permitted` that is not enough to tell the two gates
           * apart — `AccessPolicy.canEdit` and `assertCanApply` throw identical
           * text — which cost two wrong diagnoses of the live-draw failure. The
           * stack names the frame that threw, and it is worth the bytes.
           *
           * `PresentationEditorFrame` surfaces this string as the sequencer's
           * `status.error`, and `useLiveDeckReplay` writes that to the app log,
           * so it is what makes a packaged failure diagnosable after the fact.
           */
          error:
            error instanceof Error
              ? `${error.message}\n${error.stack ?? "(no stack)"}`
              : String(error),
          snapshotSaved: false,
        }),
    );
  });
}

/**
 * How long a burst of clicks or keystrokes is allowed to settle before the
 * host is told the selection may have moved.
 *
 * Long enough that a drag across three shapes is one message rather than
 * forty, short enough that letting go of the mouse and seeing the agent open
 * reads as the same action.
 */
const SELECTION_NOTIFY_DEBOUNCE_MS = 120;

/**
 * Tells the host that the user did something that may have changed what is
 * selected — a click on a shape, an arrow key, a Tab between placeholders.
 *
 * Deliberately *not* the selection itself. Reading it needs Office.js, the
 * host already has the script for that (`PRESENTATION_SELECTION_SOURCE`), and
 * keeping a second copy of it in this bundle would mean two definitions of
 * "what is selected" that drift apart. So the embed reports the gesture and
 * the host decides whether it is worth a round trip.
 *
 * `pointerup`/`keyup` rather than `down`: the editor sets its selection during
 * the gesture, so asking after it has ended is what returns the shape the user
 * just picked instead of the one they had before. Capture phase, because the
 * editor stops plenty of these before they reach the document.
 *
 * Exported for the test; `installOfficeDexPresentationBridge` wires the real
 * window.
 */
export function installSelectionNotifier(
  target: Window,
  notify: () => void,
  debounceMs = SELECTION_NOTIFY_DEBOUNCE_MS,
): () => void {
  let timer = 0;
  const schedule = () => {
    target.clearTimeout(timer);
    timer = target.setTimeout(notify, debounceMs);
  };
  target.addEventListener("pointerup", schedule, true);
  target.addEventListener("keyup", schedule, true);
  return () => {
    target.clearTimeout(timer);
    target.removeEventListener("pointerup", schedule, true);
    target.removeEventListener("keyup", schedule, true);
  };
}

export async function installOfficeDexPresentationBridge(): Promise<void> {
  // Before the fetch bridge, so a workbench that mounts and saves early is
  // never missed; before the load, so a `presentation:flush` sent during the
  // boot waits for the workbench instead of being dropped.
  saveBridge = createEditorSaveBridge(window, post);
  // Before the load too: the host sends its zoom ahead of the deck.
  installZoomBridge();
  installFetchBridge();
  installScriptBridge();
  installDocumentSwapBridge();
  installFlushBridge();
  await waitForPresentation();
  installDesktopHostBridge();
  installSelectionNotifier(window, () => post({ type: "presentation:selection-changed" }));
}

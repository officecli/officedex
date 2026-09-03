import {
  PRESENTATION_PPTX_PROTOCOL,
  isPresentationPptxEditorContext,
  isPresentationPptxEditorMessage,
  type PresentationPptxEditorContext,
  type PresentationPptxEditorMessage,
  type PresentationPptxHostMessage,
  type PresentationPptxHostPayload,
} from "../../../../shared/presentationPptxProtocol";

export type PresentationPptxEmbedPhase =
  | "booting" // iframe created, waiting for `officedex:pptx-ready`
  | "ready" // editor shell answered, PPTX can be loaded
  | "loading" // PPTX bytes sent, waiting for import + editor mount
  | "editor-ready" // MOP editor mounted, inspect/execute/export are available
  | "detached"; // editor unmounted (route change / dispose)

export interface PresentationPptxEmbedState {
  phase: PresentationPptxEmbedPhase;
  fileId: string | null;
  lastError: string | null;
  dirty: boolean;
  revision: number | null;
}

export interface PresentationPptxExportResult {
  buffer: ArrayBuffer;
  fileName: string;
  revision: number | null;
}

interface PendingRequest {
  resolve: (message: PresentationPptxEditorMessage) => void;
  reject: (error: Error) => void;
  timer: number;
  type: PresentationPptxEditorMessage["type"];
}

export interface PresentationPptxEmbedClientOptions {
  channel: string;
  /** Returns the iframe's window; messages from any other source are ignored. */
  getTargetWindow: () => Window | null;
  /** Injected for tests; defaults to `window`. */
  hostWindow?: Window;
  timeouts?: Partial<{
    ready: number;
    load: number;
    editorReady: number;
    inspect: number;
    execute: number;
    export: number;
  }>;
}

const DEFAULT_TIMEOUTS = {
  ready: 30_000,
  load: 120_000,
  editorReady: 120_000,
  inspect: 30_000,
  execute: 60_000,
  export: 120_000,
};

/**
 * Host-side driver for the embedded presentation compatibility protocol. Every request carries
 * the session channel nonce and a request id; replies from any other window,
 * protocol, or channel are dropped. Nothing here evaluates JavaScript — the
 * `executeJs` source is shipped to the editor, which runs it in its own Worker.
 */
export class PresentationPptxEmbedClient {
  readonly channel: string;
  private readonly getTargetWindow: () => Window | null;
  private readonly hostWindow: Window;
  private readonly timeouts: typeof DEFAULT_TIMEOUTS;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly stateListeners = new Set<
    (state: PresentationPptxEmbedState) => void
  >();
  private readonly dirtyListeners = new Set<
    (dirty: boolean, revision: number | null) => void
  >();
  private readyWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: number;
  }> = [];
  private editorReadyWaiters: Array<{
    resolve: (fileId: string) => void;
    reject: (error: Error) => void;
    timer: number;
  }> = [];
  private state: PresentationPptxEmbedState = {
    phase: "booting",
    fileId: null,
    lastError: null,
    dirty: false,
    revision: null,
  };
  private sequence = 0;
  private detachListener: (() => void) | null = null;
  private disposed = false;
  private editorBootstrapError: Error | null = null;

  constructor(options: PresentationPptxEmbedClientOptions) {
    this.channel = options.channel;
    this.getTargetWindow = options.getTargetWindow;
    this.hostWindow = options.hostWindow ?? window;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  getState(): PresentationPptxEmbedState {
    return this.state;
  }

  subscribe(listener: (state: PresentationPptxEmbedState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeDirty(
    listener: (dirty: boolean, revision: number | null) => void,
  ): () => void {
    this.dirtyListeners.add(listener);
    return () => this.dirtyListeners.delete(listener);
  }

  attach(): () => void {
    if (this.detachListener) return this.detachListener;
    const onMessage = (event: MessageEvent) => this.handleMessage(event);
    this.hostWindow.addEventListener("message", onMessage);
    this.detachListener = () => {
      this.hostWindow.removeEventListener("message", onMessage);
      this.detachListener = null;
    };
    return this.detachListener;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachListener?.();
    const error = new Error("The presentation editor was closed.");
    for (const pending of this.pending.values()) {
      this.hostWindow.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.readyWaiters) {
      this.hostWindow.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.readyWaiters = [];
    for (const waiter of this.editorReadyWaiters) {
      this.hostWindow.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.editorReadyWaiters = [];
    this.stateListeners.clear();
    this.dirtyListeners.clear();
  }

  /** Resolves once the editor shell has posted `officedex:pptx-ready`. */
  waitForReady(timeoutMs = this.timeouts.ready): Promise<void> {
    if (this.state.phase !== "booting") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = this.hostWindow.setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter(
          (waiter) => waiter.timer !== timer,
        );
        reject(
          new Error(
            `The presentation editor did not answer within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.readyWaiters.push({ resolve, reject, timer });
    });
  }

  /** Resolves with the file id once the MOP editor is mounted for the loaded deck. */
  waitForEditorReady(timeoutMs = this.timeouts.editorReady): Promise<string> {
    if (this.state.phase === "editor-ready" && this.state.fileId)
      return Promise.resolve(this.state.fileId);
    if (this.editorBootstrapError)
      return Promise.reject(this.editorBootstrapError);
    return new Promise((resolve, reject) => {
      const timer = this.hostWindow.setTimeout(() => {
        this.editorReadyWaiters = this.editorReadyWaiters.filter(
          (waiter) => waiter.timer !== timer,
        );
        reject(
          new Error(
            `The presentation editor did not finish opening within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.editorReadyWaiters.push({ resolve, reject, timer });
    });
  }

  /** Sends the PPTX bytes (transferred) and resolves once the editor imported them. */
  async load(
    buffer: ArrayBuffer,
    fileName: string,
  ): Promise<{ fileId: string; fileName: string }> {
    this.setState({
      phase: "loading",
      fileId: null,
      lastError: null,
      dirty: false,
      revision: null,
    });
    this.editorBootstrapError = null;
    const reply = await this.request(
      { type: "officedex:pptx-load", buffer, fileName },
      "officedex:pptx-loaded",
      this.timeouts.load,
      [buffer],
      "officedex:pptx-load-error",
    );
    if (reply.type === "officedex:pptx-load-error") {
      this.setState({ ...this.state, lastError: reply.error });
      throw new Error(reply.error || "The presentation could not be imported.");
    }
    if (reply.type !== "officedex:pptx-loaded")
      throw new Error("Unexpected editor reply.");
    return { fileId: reply.fileId, fileName: reply.fileName };
  }

  async inspect(): Promise<PresentationPptxEditorContext> {
    this.assertEditorReady();
    const reply = await this.request(
      { type: "officedex:pptx-inspect" },
      "officedex:pptx-inspect-result",
      this.timeouts.inspect,
    );
    if (reply.type !== "officedex:pptx-inspect-result")
      throw new Error("Unexpected editor reply.");
    if (reply.error) throw new Error(reply.error);
    if (!isPresentationPptxEditorContext(reply.context))
      throw new Error("The editor returned an invalid slide context.");
    return reply.context;
  }

  async executeJs(source: string): Promise<unknown> {
    this.assertEditorReady();
    if (typeof source !== "string" || !source.trim())
      throw new Error("No script to execute.");
    const reply = await this.request(
      { type: "officedex:pptx-execute-js", source },
      "officedex:pptx-execute-result",
      this.timeouts.execute,
    );
    if (reply.type !== "officedex:pptx-execute-result")
      throw new Error("Unexpected editor reply.");
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }

  async export(): Promise<PresentationPptxExportResult> {
    this.assertEditorReady();
    const reply = await this.request(
      { type: "officedex:pptx-export" },
      "officedex:pptx-export-result",
      this.timeouts.export,
    );
    if (reply.type !== "officedex:pptx-export-result")
      throw new Error("Unexpected editor reply.");
    if (reply.error) throw new Error(reply.error);
    const buffer = reply.buffer;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
      throw new Error("The editor returned an empty PowerPoint export.");
    }
    const head = new Uint8Array(buffer, 0, 2);
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error("The editor returned an invalid PowerPoint export.");
    }
    return {
      buffer,
      fileName: reply.fileName || "presentation.pptx",
      revision: typeof reply.revision === "number" ? reply.revision : null,
    };
  }

  private assertEditorReady(): void {
    if (this.disposed) throw new Error("The presentation editor was closed.");
    if (this.state.phase !== "editor-ready")
      throw new Error("The presentation editor is not ready.");
  }

  private setState(next: PresentationPptxEmbedState): void {
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private request(
    payload: PresentationPptxHostPayload,
    replyType: PresentationPptxEditorMessage["type"],
    timeoutMs: number,
    transfer: Transferable[] = [],
    errorType?: PresentationPptxEditorMessage["type"],
  ): Promise<PresentationPptxEditorMessage> {
    if (this.disposed)
      return Promise.reject(new Error("The presentation editor was closed."));
    const target = this.getTargetWindow();
    if (!target)
      return Promise.reject(
        new Error("The presentation editor frame is not available."),
      );
    const requestId = `officedex-${Date.now().toString(36)}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = this.hostWindow.setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `The presentation editor did not respond to ${payload.type} within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, type: replyType });
      if (errorType) {
        // The load request has a dedicated error reply type; register it under the same id.
        this.pending.set(`${requestId}:error`, {
          resolve,
          reject,
          timer,
          type: errorType,
        });
      }
      const message: PresentationPptxHostMessage = {
        ...payload,
        protocol: PRESENTATION_PPTX_PROTOCOL,
        channel: this.channel,
        requestId,
      } as PresentationPptxHostMessage;
      try {
        target.postMessage(message, "*", transfer);
      } catch (error) {
        this.hostWindow.clearTimeout(timer);
        this.pending.delete(requestId);
        this.pending.delete(`${requestId}:error`);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private settle(
    requestId: string,
    message: PresentationPptxEditorMessage,
  ): boolean {
    const direct = this.pending.get(requestId);
    const viaError = this.pending.get(`${requestId}:error`);
    const match =
      direct && direct.type === message.type
        ? direct
        : viaError && viaError.type === message.type
          ? viaError
          : null;
    if (!match) return false;
    this.hostWindow.clearTimeout(match.timer);
    this.pending.delete(requestId);
    this.pending.delete(`${requestId}:error`);
    match.resolve(message);
    return true;
  }

  private handleMessage(event: MessageEvent): void {
    if (this.disposed) return;
    const target = this.getTargetWindow();
    if (!target) return;
    // Cross-origin WindowProxy identity is not stable in WKWebView. The
    // cryptographically random channel and protocol are the authentication
    // boundary; requiring object identity here drops legitimate editor events.
    if (!isPresentationPptxEditorMessage(event.data, this.channel)) return;
    const message = event.data;
    switch (message.type) {
      case "officedex:pptx-ready": {
        if (this.state.phase === "booting")
          this.setState({ ...this.state, phase: "ready" });
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const waiter of waiters) {
          this.hostWindow.clearTimeout(waiter.timer);
          waiter.resolve();
        }
        return;
      }
      case "officedex:pptx-editor-ready": {
        this.editorBootstrapError = null;
        this.setState({
          phase: "editor-ready",
          fileId: message.fileId,
          lastError: null,
          dirty: false,
          revision: null,
        });
        const waiters = this.editorReadyWaiters;
        this.editorReadyWaiters = [];
        for (const waiter of waiters) {
          this.hostWindow.clearTimeout(waiter.timer);
          waiter.resolve(message.fileId);
        }
        return;
      }
      case "officedex:pptx-editor-error": {
        const error = new Error(
          message.error || "The presentation editor failed to initialize.",
        );
        this.editorBootstrapError = error;
        this.setState({
          ...this.state,
          lastError: error.message,
        });
        const waiters = this.editorReadyWaiters;
        this.editorReadyWaiters = [];
        for (const waiter of waiters) {
          this.hostWindow.clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        return;
      }
      case "officedex:pptx-editor-detached": {
        if (
          this.state.fileId === message.fileId ||
          this.state.phase === "editor-ready"
        ) {
          this.setState({
            phase: "detached",
            fileId: null,
            lastError: null,
            dirty: false,
            revision: null,
          });
        }
        return;
      }
      case "officedex:pptx-dirty-changed": {
        if (this.state.fileId && this.state.fileId !== message.fileId) return;
        const revision =
          typeof message.revision === "number" ? message.revision : null;
        this.setState({ ...this.state, dirty: message.dirty, revision });
        for (const listener of this.dirtyListeners)
          listener(message.dirty, revision);
        return;
      }
      case "officedex:pptx-loaded":
      case "officedex:pptx-load-error":
      case "officedex:pptx-inspect-result":
      case "officedex:pptx-execute-result":
      case "officedex:pptx-export-result":
        this.settle(message.requestId, message);
        return;
    }
  }
}

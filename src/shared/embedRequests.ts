// Request/reply bookkeeping for postMessage conversations with an embedded
// editor. Both presentation clients (the presentation:* stage frame and the
// officedex:pptx-* workbench client) kept their own pending map, timer
// handling and disposal sweep; the two drifted (different timeout tables,
// one cleared timers on dispose and one did not). This is the one copy.

export interface PendingReply<T> {
  resolve(value: T): void;
  reject(error: Error): void;
}

/** The subset of Window the ledger needs; the host window, or a fake in tests. */
export type TimerHost = Pick<Window, "setTimeout" | "clearTimeout">;

export interface PendingRequestsOptions {
  /** Where timers run; injectable for tests. Defaults to the page's window. */
  readonly timers?: TimerHost;
  /** Prefix for generated request ids, so two clients on one page never collide. */
  readonly idPrefix: string;
}

export class PendingRequests {
  private readonly timers: TimerHost;
  private readonly idPrefix: string;
  private readonly pending = new Map<string, { reply: PendingReply<unknown>; timer: number }>();
  private sequence = 0;

  constructor(options: PendingRequestsOptions) {
    this.timers = options.timers ?? window;
    this.idPrefix = options.idPrefix;
  }

  /** Number of requests still waiting for a reply. */
  get size(): number {
    return this.pending.size;
  }

  nextId(): string {
    return `${this.idPrefix}-${Date.now().toString(36)}-${++this.sequence}`;
  }

  /**
   * Registers a request and returns the promise its reply will settle. When
   * timeoutMs passes first, the request is dropped and the promise rejects with
   * the given message.
   */
  open<T>(requestId: string, timeoutMs: number, timeoutMessage: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.timers.setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error(timeoutMessage));
      }, Math.max(timeoutMs, 0));
      this.pending.set(requestId, { reply: { resolve: resolve as (value: unknown) => void, reject }, timer });
    });
  }

  /** Settles a request; returns false when nothing was waiting under that id. */
  resolve(requestId: string, value: unknown): boolean {
    const entry = this.take(requestId);
    if (!entry) return false;
    entry.reply.resolve(value);
    return true;
  }

  reject(requestId: string, error: Error): boolean {
    const entry = this.take(requestId);
    if (!entry) return false;
    entry.reply.reject(error);
    return true;
  }

  /** Rejects everything still waiting, e.g. when the frame goes away. */
  rejectAll(error: Error): void {
    for (const requestId of [...this.pending.keys()]) this.reject(requestId, error);
  }

  private take(requestId: string) {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    this.pending.delete(requestId);
    this.timers.clearTimeout(entry.timer);
    return entry;
  }
}

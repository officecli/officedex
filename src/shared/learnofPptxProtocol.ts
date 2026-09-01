// postMessage protocol between OfficeDex and the embedded learnof/pptx editor.
//
// This mirrors `packages/presentation-app/src/bootstrap/officedex-embed-protocol.ts`
// in the learnof/pptx repository. The two files are kept in sync by hand on
// purpose: OfficeDex must not import learnof/pptx sources across repositories.

export const LEARNOF_PPTX_PROTOCOL = "officedex-pptx-embed/1" as const;

export const LEARNOF_PPTX_EMBED_QUERY = Object.freeze({
  embed: "officedexEmbed",
  channel: "channel",
  sessionMode: "sessionMode",
} as const);

interface LearnofPptxMessageBase {
  readonly protocol: typeof LEARNOF_PPTX_PROTOCOL;
  readonly channel: string;
}

/** Messages OfficeDex (the host) sends to the editor iframe. */
export type LearnofPptxHostMessage = LearnofPptxMessageBase &
  (
    | {
        readonly type: "officedex:pptx-load";
        readonly requestId: string;
        readonly buffer: ArrayBuffer;
        readonly fileName: string;
      }
    | { readonly type: "officedex:pptx-inspect"; readonly requestId: string }
    | {
        readonly type: "officedex:pptx-execute-js";
        readonly requestId: string;
        readonly source: string;
      }
    | { readonly type: "officedex:pptx-export"; readonly requestId: string }
  );

/** Messages the editor iframe sends back to OfficeDex. */
export type LearnofPptxEditorMessage = LearnofPptxMessageBase &
  (
    | { readonly type: "officedex:pptx-ready" }
    | {
        readonly type: "officedex:pptx-loaded";
        readonly requestId: string;
        readonly fileId: string;
        readonly fileName: string;
      }
    | {
        readonly type: "officedex:pptx-load-error";
        readonly requestId: string;
        readonly error: string;
      }
    | { readonly type: "officedex:pptx-editor-ready"; readonly fileId: string }
    | {
        readonly type: "officedex:pptx-editor-detached";
        readonly fileId: string;
      }
    | {
        readonly type: "officedex:pptx-dirty-changed";
        readonly fileId: string;
        readonly dirty: boolean;
        readonly revision?: number;
      }
    | {
        readonly type: "officedex:pptx-inspect-result";
        readonly requestId: string;
        readonly context?: unknown;
        readonly error?: string;
      }
    | {
        readonly type: "officedex:pptx-execute-result";
        readonly requestId: string;
        readonly result?: unknown;
        readonly error?: string;
      }
    | {
        readonly type: "officedex:pptx-export-result";
        readonly requestId: string;
        readonly buffer?: ArrayBuffer;
        readonly fileName?: string;
        readonly revision?: number;
        readonly error?: string;
      }
  );

export type LearnofPptxEditorMessageType = LearnofPptxEditorMessage["type"];

/** `Omit` distributed over a union (plain `Omit` collapses discriminated unions). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** A host message minus the envelope fields the client adds itself. */
export type LearnofPptxHostPayload = DistributiveOmit<
  LearnofPptxHostMessage,
  "protocol" | "channel" | "requestId"
>;

const EDITOR_MESSAGE_TYPES: ReadonlySet<string> =
  new Set<LearnofPptxEditorMessageType>([
    "officedex:pptx-ready",
    "officedex:pptx-loaded",
    "officedex:pptx-load-error",
    "officedex:pptx-editor-ready",
    "officedex:pptx-editor-detached",
    "officedex:pptx-dirty-changed",
    "officedex:pptx-inspect-result",
    "officedex:pptx-execute-result",
    "officedex:pptx-export-result",
  ]);

export function isLearnofPptxEditorMessage(
  value: unknown,
  channel: string,
): value is LearnofPptxEditorMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.protocol !== LEARNOF_PPTX_PROTOCOL) return false;
  if (!channel || record.channel !== channel) return false;
  return (
    typeof record.type === "string" && EDITOR_MESSAGE_TYPES.has(record.type)
  );
}

/** Shape summary reported by the editor's inspect step. */
export interface LearnofPptxShapeContext {
  id: string;
  name: string;
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  text?: string;
}

export interface LearnofPptxSlideContext {
  id: string;
  index: number;
  shapes: LearnofPptxShapeContext[];
}

/** Editor context handed to the AI planner. */
export interface LearnofPptxEditorContext {
  slides: LearnofPptxSlideContext[];
  selectedSlideIds: string[];
  selectedShapes: Array<Pick<LearnofPptxShapeContext, "id" | "name" | "type">>;
}

export function isLearnofPptxEditorContext(
  value: unknown,
): value is LearnofPptxEditorContext {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.slides) &&
    Array.isArray(record.selectedSlideIds) &&
    Array.isArray(record.selectedShapes)
  );
}

/** Cryptographically random channel nonce for one editor session. */
export function createLearnofPptxChannel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Builds the iframe URL for the editor: `<base>?officedexEmbed=1&channel=<nonce>&sessionMode=browser-local`.
 * Relative bases (for example the packaged `/pptx/` asset route) are resolved
 * against the current Wails/web document; absolute bases must be HTTP(S).
 * Returns `null` when no editor base URL is configured or the URL is invalid.
 */
export function buildLearnofPptxEmbedUrl(
  baseUrl: string | undefined | null,
  channel: string,
): string | null {
  const trimmed = (baseUrl ?? "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(
      trimmed,
      typeof window !== "undefined"
        ? window.location.href
        : "http://127.0.0.1/",
    );
  } catch {
    return null;
  }
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(trimmed);
  if (
    absolute &&
    url.protocol !== "http:" &&
    url.protocol !== "https:" &&
    url.protocol !== "wails:"
  )
    return null;
  url.searchParams.set(LEARNOF_PPTX_EMBED_QUERY.embed, "1");
  url.searchParams.set(LEARNOF_PPTX_EMBED_QUERY.channel, channel);
  url.searchParams.set(LEARNOF_PPTX_EMBED_QUERY.sessionMode, "browser-local");
  return url.toString();
}

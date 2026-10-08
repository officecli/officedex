/**
 * What went wrong with a file, in terms the shell can show and retry.
 *
 * A failure is recorded against the file rather than flashed once and lost:
 * the status bar read "Saved" while a write had been refused, and the only
 * trace of a document that could not be opened was a three-second notice
 * quoting an HTTP status and a temp path. Both are facts about the file that
 * stay true until a retry succeeds, so they live on `FileMeta.failure` and are
 * cleared by the thing that fixes them — a save that reaches the disk, an open
 * that reaches "document loaded".
 */
export type FileFailureKind = "open" | "save";

/**
 * Why, as a stable key the UI turns into words.
 *
 * The raw text from the host or the editor goes in `detail`, for the log and
 * a Details disclosure. It is never the sentence the user reads: that text is
 * written for whoever is debugging a converter, and it carried JSON bodies and
 * `/var/folders/…` scratch paths straight into the status line.
 */
export type FileFailureReason =
  | "permission-denied"
  | "source-changed"
  | "disk-full"
  | "invalid-docx"
  | "too-large"
  | "unknown";

export interface FileFailure {
  kind: FileFailureKind;
  reason: FileFailureReason;
  /** What the host or editor actually said. Diagnostics, not copy. */
  detail: string;
  /** Epoch millis; the status cell does not show it, the log does. */
  at: number;
}

/** The `error` code of a word2mowhttp JSON body, when the text carries one. */
export function embeddedErrorCode(text: string): string | null {
  const direct = text.match(/\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/);
  const start = text.indexOf("{");
  if (start >= 0) {
    const end = text.lastIndexOf("}");
    if (end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1)) as { error?: unknown };
        if (typeof parsed.error === "string" && parsed.error) return parsed.error;
      } catch {
        // Not JSON after all; fall through to the bare-code match.
      }
    }
  }
  return direct?.[1] ?? null;
}

const PERMISSION = /permission denied|EACCES|EPERM|operation not permitted|read-only file system|EROFS|not writable/i;
const SOURCE_CHANGED = /changed outside OfficeDex|changed externally/i;
const DISK_FULL = /no space left|ENOSPC|disk is full/i;
const INVALID_DOCX = /INVALID_DOCX_FILE|DOCX_CONVERSION_FAILED|not a valid (?:docx|zip)|zip: not a valid|invalid docx|corrupt|not a Word document/i;
const TOO_LARGE = /REQUEST_TOO_LARGE|too large|exceeds the allowed size/i;

/** Reads the host's error text for a cause the UI has words for. */
export function classifyFileFailure(kind: FileFailureKind, raw: unknown): FileFailureReason {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  const code = embeddedErrorCode(text);
  if (kind === "save") {
    if (SOURCE_CHANGED.test(text)) return "source-changed";
    if (PERMISSION.test(text)) return "permission-denied";
    if (DISK_FULL.test(text)) return "disk-full";
    return "unknown";
  }
  if (code === "REQUEST_TOO_LARGE" || TOO_LARGE.test(text)) return "too-large";
  if (code === "INVALID_DOCX_FILE" || code === "DOCX_CONVERSION_FAILED" || INVALID_DOCX.test(text)) {
    return "invalid-docx";
  }
  if (PERMISSION.test(text)) return "permission-denied";
  return "unknown";
}

export function describeFailure(kind: FileFailureKind, raw: unknown, at = Date.now()): FileFailure {
  const detail = raw instanceof Error ? raw.message : String(raw ?? "");
  return { kind, reason: classifyFileFailure(kind, raw), detail, at };
}

/** The dictionary key for the sentence the user reads. */
export function fileFailureMessageKey(failure: Pick<FileFailure, "kind" | "reason">): string {
  if (failure.kind === "save") {
    switch (failure.reason) {
      case "permission-denied":
        return "dx.failure.save.permission";
      case "source-changed":
        return "dx.failure.save.sourceChanged";
      case "disk-full":
        return "dx.failure.save.diskFull";
      default:
        return "dx.failure.save.unknown";
    }
  }
  switch (failure.reason) {
    case "invalid-docx":
      return "dx.failure.open.invalidDocx";
    case "too-large":
      return "dx.failure.open.tooLarge";
    case "permission-denied":
      return "dx.failure.open.permission";
    default:
      return "dx.failure.open.unknown";
  }
}

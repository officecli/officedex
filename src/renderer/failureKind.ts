// Failure kinds decide what the error banner offers: sign in, fix setup, retry
// the connection, or retry the task.
//
// Go tags its errors with `[kind:<kind>]` (internal/types/failure.go) and
// status events carry `payload.kind`; the renderer reads those. It used to
// guess from the message text -- "login", "enoent", "429", "饱和" -- which
// misfiled anything worded differently and broke on every rephrasing.
export type FailureKind = "connection" | "auth" | "task" | "setup" | "other";

const FAILURE_KINDS: readonly FailureKind[] = ["connection", "auth", "task", "setup", "other"];
const FAILURE_TAG = /\[kind:(auth|setup|connection|task|other)\]\s*/;

export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && (FAILURE_KINDS as readonly string[]).includes(value);
}

/** The kind an error carries, or "other" when it is untagged. */
export function classifyError(text: string, stderr?: string): FailureKind {
  const match = FAILURE_TAG.exec(`${text}\n${stderr || ""}`);
  return match ? (match[1] as FailureKind) : "other";
}

/** Prefer the kind a bridge status event states; fall back to the message tag. */
export function classifyStatusEvent(payloadKind: unknown, message: string, stderr?: string): FailureKind {
  return isFailureKind(payloadKind) ? payloadKind : classifyError(message, stderr);
}

/** Removes the kind tag so it never shows up in the banner. */
export function stripFailureTag(text: string): string {
  return text.replace(new RegExp(FAILURE_TAG.source, "g"), "").trim();
}

export function extractStderr(text: string): string | undefined {
  const marker = "stderr:\n";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(idx + marker.length).trim() : undefined;
}

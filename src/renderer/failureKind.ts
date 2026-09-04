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
// Go also tags the bridge's error.data.code (`[code:task_not_found]`), so a
// decision that used to match the sentence ("not found", "no pending input")
// reads the code instead.
const CODE_TAG = /\[code:([a-z_]+)\]\s*/;

/** Machine-readable bridge error codes the renderer acts on. */
export const BRIDGE_ERROR_CODES = {
  taskNotFound: "task_not_found",
  sessionNotFound: "session_not_found",
  noPendingInput: "no_pending_input",
} as const;

/** The bridge error code an error message carries, or undefined. */
export function errorCode(text: string): string | undefined {
  return CODE_TAG.exec(text)?.[1];
}

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
  return text.replace(new RegExp(FAILURE_TAG.source, "g"), "").replace(new RegExp(CODE_TAG.source, "g"), "").trim();
}

export function extractStderr(text: string): string | undefined {
  const marker = "stderr:\n";
  const idx = text.indexOf(marker);
  return idx >= 0 ? text.slice(idx + marker.length).trim() : undefined;
}

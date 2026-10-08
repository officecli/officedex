import { createElement } from "react";

import { toast } from "../../renderer/ui";
import { fileFailureMessageKey, type FileFailure } from "../../shared/fileFailure";
import { isNotImplemented } from "../../shared/notImplemented";
import { logShellEvent } from "./shellLog";
import { translate } from "../../renderer/i18n";
import { notice } from "../kit/layers";

/**
 * What the user sees when a port call does not go through.
 *
 * Every action in this shell is a promise handed back by the port, and the
 * three outcomes need three different things said:
 *
 *   - **not built yet** — a notice, the workspace's own (OD-UI-1.2 §08): one
 *     line at the foot of the window that goes away by itself. The control is
 *     where the design put it and it works the day the service layer catches
 *     up. Nothing is wrong with the file or the app, and nothing needs doing.
 *   - **a real failure** — an error, with whatever the port said. The user's
 *     work may be affected.
 *   - **success** — nothing. Silence is the reward.
 *
 * There is one notice at a time, so a double-click cannot stack two.
 *
 * This is the only place the shell decides how a rejected port call looks, and
 * it is why the hooks wrap their calls rather than letting them float off as
 * `void port.x()`: an unhandled rejection is a click that vanished, which the
 * user cannot tell apart from a bug in their own document.
 *
 * Everything reported here is also written to the app log. A toast is for the
 * person at the keyboard and is gone in three seconds; the log is what anyone
 * debugging a packaged build has, and the shell wrote nothing to it at all
 * until a blank canvas with no error turned out to be unreproducible from the
 * outside.
 */
export function reportPortFailure(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (isNotImplemented(reason)) {
    logShellEvent("not-implemented", { feature: reason.feature, message });
    notice(reason.message);
    return;
  }
  logShellEvent("port-failure", {
    message,
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
  });
  toast.error({
    content: translate("shell.port.failed"),
    description: message,
  });
}

/**
 * Runs a port action, reporting whatever comes back out.
 *
 * Returns whether it succeeded, so a caller can skip the state update that was
 * only valid if the call went through.
 */
export async function attempt(action: () => Promise<void>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (reason) {
    reportPortFailure(reason);
    return false;
  }
}

/**
 * For a control with nothing behind it at all.
 *
 * `attempt` covers the case where the port was asked and said no. This covers
 * the other one: a button the UI layer placed for a capability that has no
 * `UiPort` method yet, so there is nothing to call. Share, Settings, dictation
 * and the file menu are all in this state.
 *
 * They keep their place and say so when pressed. The alternative — hiding them
 * until the service layer catches up — would mean editing the UI layer's
 * layout twice and losing the record of what was designed.
 *
 * Each gap here has an entry in docs/not-implemented.md.
 */
export function notBuiltYet(feature: string, message: string): void {
  logShellEvent("not-implemented", { feature, message });
  notice(message);
}

/**
 * A file that could not be opened or saved — the one failure that outlives
 * the toast.
 *
 * It is written against the file (`FileMeta.failure`) by the caller; this is
 * the part the person at the keyboard sees. It stays until dismissed or
 * retried, because a refused write is not over when three seconds are: the
 * changes are still in the editor and still not on disk. One toast per file —
 * a shell-initiated save that fails is also seen by the editor's own failure
 * channel, and the second report replaces the first instead of stacking.
 *
 * The sentence is ours, from the cause. What the host or converter actually
 * said is behind Details: it is for whoever is debugging, and it has carried
 * JSON bodies and scratch paths straight into the status line before now.
 */
export function reportFileFailure(
  file: { id: string; name: string },
  failure: FileFailure,
  retry: () => void,
): void {
  logShellEvent("file-failure", {
    fileId: file.id,
    kind: failure.kind,
    reason: failure.reason,
    detail: failure.detail,
  });
  const id = toast.error({
    key: `file-failure:${file.id}`,
    content: `${file.name} · ${translate(fileFailureMessageKey(failure))}`,
    description: failure.detail
      ? createElement(
          "details",
          { className: "dx-failure-details" },
          createElement("summary", null, translate("dx.failure.details")),
          createElement("pre", null, failure.detail),
        )
      : undefined,
    duration: null,
    action: {
      label: translate(failure.kind === "save" ? "dx.action.retrySave" : "dx.action.reopen"),
      onClick: retry,
    },
  });
  failureToasts.set(file.id, id);
}

const failureToasts = new Map<string, string>();

/** Takes a file's failure toast down once the thing it reported has succeeded. */
export function clearFileFailureReport(fileId: string): void {
  const id = failureToasts.get(fileId);
  if (!id) return;
  failureToasts.delete(fileId);
  toast.dismiss(id);
}

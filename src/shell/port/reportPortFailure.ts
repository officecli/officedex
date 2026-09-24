import { toast } from "../../renderer/ui";
import { isNotImplemented } from "../../shared/notImplemented";
import { logShellEvent } from "./shellLog";
import { translate } from "../../renderer/i18n";

/**
 * What the user sees when a port call does not go through.
 *
 * Every action in this shell is a promise handed back by the port, and the
 * three outcomes need three different things said:
 *
 *   - **not built yet** — a notice. The control is where the UI layer put it
 *     and it works the day the service layer catches up. Nothing is wrong with
 *     the file or the app.
 *   - **a real failure** — an error, with whatever the port said. The user's
 *     work may be affected.
 *   - **success** — nothing. Silence is the reward.
 *
 * Keyed by feature so a double-click does not stack two identical notices.
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
    toast.warning({
      key: `not-implemented:${reason.feature}`,
      content: translate("shell.port.notBuilt"),
      description: reason.message,
    });
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
  toast.warning({
    key: `not-implemented:${feature}`,
    content: translate("shell.port.notBuilt"),
    description: message,
  });
}

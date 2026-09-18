import { toast } from "../../renderer/ui";
import { isNotImplemented } from "../../shared/notImplemented";

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
 */
export function reportPortFailure(reason: unknown): void {
  if (isNotImplemented(reason)) {
    toast.warning({
      key: `not-implemented:${reason.feature}`,
      content: "Not built yet",
      description: reason.message,
    });
    return;
  }
  toast.error({
    content: "That did not work",
    description: reason instanceof Error ? reason.message : String(reason),
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
 * `UiPort` method yet, so there is nothing to call. Share, Settings, zoom,
 * dictation and the ribbon are all in this state.
 *
 * They keep their place and say so when pressed. The alternative — hiding them
 * until the service layer catches up — would mean editing the UI layer's
 * layout twice and losing the record of what was designed.
 *
 * Each gap here has an entry in docs/not-implemented.md.
 */
export function notBuiltYet(feature: string, message: string): void {
  toast.warning({
    key: `not-implemented:${feature}`,
    content: "Not built yet",
    description: message,
  });
}

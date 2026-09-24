import { createContext, useContext, type ReactNode } from "react";

import type { DesktopAPI } from "../../shared/types";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import { LocaleProvider } from "../../renderer/i18n";
import { ForceUpdateOverlay } from "../../renderer/components/ForceUpdateOverlay";
import { useAppUpdate, type UseAppUpdateValue } from "../../renderer/useAppUpdate";

/**
 * The one thing that outranks the whole shell.
 *
 * A build the backend refuses to serve cannot be worked around by being careful
 * — every run would fail, and failing with a puzzle is worse than not starting.
 * So a mandatory update replaces the UI entirely rather than appearing beside
 * it. That was already true of the old entry point; this carries it across.
 *
 * Written down because it is the kind of thing that disappears quietly in a
 * rewrite: the gate lives in the *entry*, not in a feature, so a new entry with
 * no gate looks complete and is not. The whole update flow is reused as-is —
 * `useAppUpdate` needs only a desktop API, and the overlay is self-contained.
 *
 * The gate is also the shell's only updater. An *optional* update never reaches
 * the overlay, so the gate hands the same value down through context: the
 * sidebar's update button (`UpdateButton`) and Settings → About both act on it.
 * One poller, one download — the two cannot disagree about what is installed.
 *
 * Outside the desktop app there is no updater to ask, so `api` is null, this is
 * a pass-through, and `useShellAppUpdate()` answers null.
 */
export function UpdateGate({ api, children }: { api: DesktopAPI | null; children: ReactNode }) {
  if (!api) return <>{children}</>;
  return (
    <LocaleProvider>
      <DesktopApiProvider api={api}>
        <MandatoryUpdate>{children}</MandatoryUpdate>
      </DesktopApiProvider>
    </LocaleProvider>
  );
}

const AppUpdateContext = createContext<UseAppUpdateValue | null>(null);

/** The gate's updater, or null when nothing above is a desktop `UpdateGate`. */
export function useShellAppUpdate(): UseAppUpdateValue | null {
  return useContext(AppUpdateContext);
}

/**
 * The version an optional update would install, or null.
 *
 * Deliberately not dismissable: the sidebar button is how an optional update is
 * installed at all, so it stays until the update is. A mandatory update never
 * counts — the overlay already owns the whole window.
 */
export function optionalUpdateVersion(update: UseAppUpdateValue | null): string | null {
  if (!update?.release) return null;
  if (!update.status.updateAvailable || update.status.mandatory) return null;
  return update.release.version;
}

function MandatoryUpdate({ children }: { children: ReactNode }) {
  const update = useAppUpdate();
  if (!update.status.mandatory || !update.release) {
    return <AppUpdateContext.Provider value={update}>{children}</AppUpdateContext.Provider>;
  }
  return (
    <ForceUpdateOverlay
      release={update.release}
      phase={update.phase}
      progress={update.progress}
      error={update.error}
      currentVersion={update.status.currentVersion}
      onUpdate={() => void update.download()}
      onInstall={() => void update.install()}
    />
  );
}

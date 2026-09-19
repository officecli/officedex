import type { ReactNode } from "react";

import type { DesktopAPI } from "../../shared/types";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import { LocaleProvider } from "../../renderer/i18n";
import { ForceUpdateOverlay } from "../../renderer/components/ForceUpdateOverlay";
import { useAppUpdate } from "../../renderer/useAppUpdate";

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
 * Outside the desktop app there is no updater to ask, so `api` is null and this
 * is a pass-through.
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

function MandatoryUpdate({ children }: { children: ReactNode }) {
  const update = useAppUpdate();
  if (!update.status.mandatory || !update.release) return <>{children}</>;
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

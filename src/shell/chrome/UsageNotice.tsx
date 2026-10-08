import { useEffect, useState } from "react";

import { Button } from "../../renderer/ui";
import { useT } from "../../renderer/i18n";
import { useSettings } from "../../renderer/useSettings";
import "./usageNotice.css";

/** Bumped when what is reported changes enough that people should be told again. */
export const USAGE_NOTICE_KEY = "officedex:usage-notice:v2";

function alreadyShown(): boolean {
  try {
    return window.localStorage.getItem(USAGE_NOTICE_KEY) !== null;
  } catch {
    // Storage that cannot be read cannot remember either, and a notice that
    // returns on every launch is worse than one that is missed.
    return true;
  }
}

function remember() {
  try {
    window.localStorage.setItem(USAGE_NOTICE_KEY, new Date().toISOString());
  } catch {
    // See alreadyShown.
  }
}

/**
 * Says, once, that usage counts are shared and where to turn them off.
 *
 * Reporting is on by default, so without this the only place anyone could
 * learn of it is a row at the bottom of Settings → Advanced. It is a notice and
 * not a consent prompt: it does not hold anything back while it is up, and
 * dismissing it is the same as acknowledging it.
 *
 * It stays out of the way of an install that has already said no. "Turn off"
 * writes the same setting the Settings switch does, which is what clears the
 * pending queue on the Go side.
 */
export function UsageNotice() {
  const t = useT();
  const { settings, update, loading } = useSettings();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    setOpen(settings.usageAnalyticsEnabled !== false && !alreadyShown());
  }, [loading, settings.usageAnalyticsEnabled]);

  if (!open) return null;

  const close = () => {
    remember();
    setOpen(false);
  };

  return (
    <section className="shell-usage-notice" role="status" aria-labelledby="shell-usage-notice-title">
      <h2 id="shell-usage-notice-title">{t("usageNotice.title")}</h2>
      <p>{t("usageNotice.body")}</p>
      <div className="shell-usage-notice-actions">
        <Button
          onClick={() => {
            close();
            void update({ usageAnalyticsEnabled: false }).catch(() => undefined);
          }}
        >
          {t("usageNotice.decline")}
        </Button>
        <Button type="primary" onClick={close}>
          {t("usageNotice.accept")}
        </Button>
      </div>
    </section>
  );
}

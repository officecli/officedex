import { useT } from "../../renderer/i18n";
import { Icon } from "../kit/Icon";
import { notice } from "../kit/layers";
import { reconnect, useOnline } from "../state/useOnline";

/** Looks for a connection again and says what it found. */
export function useReconnect() {
  const t = useT();
  return () => notice(t(reconnect() ? "dx.offline.connected" : "dx.offline.still"));
}

/** Shown at the top of a file page while there is no connection. */
export function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  const onReconnect = useReconnect();
  if (online) return null;
  return (
    <div className="dx-banner">
      <Icon name="WifiOff" />
      <div>
        <strong>{t("dx.offline.title")}</strong>
        <p>{t("dx.offline.body")}</p>
        <button type="button" className="dx-btn" data-act="reconnect" onClick={onReconnect}>
          {t("dx.offline.reconnect")}
        </button>
      </div>
    </div>
  );
}

import { Button, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { officecli } from "../bridge";
import { useT } from "../i18n";

export function DiagnosticsPanel() {
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await officecli.exportLogs();
      setExported(true);
      void message.success(t("diagnostics.exportSuccess", { path: result.path }));
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : t("diagnostics.exportError"),
      );
    } finally {
      setExporting(false);
    }
  }, [t]);

  return (
    <div className="setting-row">
      <div>
        <h3>{t("diagnostics.title")}</h3>
        <p>{t("diagnostics.description")}</p>
      </div>
      <div className="setting-control">
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={handleExport}
          >
            {exported ? t("diagnostics.exported") : t("diagnostics.exportButton")}
          </Button>
          <span style={{ fontSize: 12, color: "#787671" }}>
            {t("diagnostics.feedbackHint")}
          </span>
        </div>
      </div>
    </div>
  );
}

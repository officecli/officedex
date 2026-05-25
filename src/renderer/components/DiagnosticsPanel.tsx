import { Button, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { useReportCapability } from "../useReportCapability";
import { ReportIssueDialog } from "./ReportIssueDialog";

export function DiagnosticsPanel() {
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);

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
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={handleExport}
            >
              {exported ? t("diagnostics.exported") : t("diagnostics.exportButton")}
            </Button>
            {capability?.enabled ? (
              <Button
                type="primary"
                onClick={() => setReportOpen(true)}
                style={{ borderRadius: 8 }}
              >
                {t("diagnostics.reportIssue")}
              </Button>
            ) : null}
          </div>
          <span style={{ fontSize: 12, color: "#787671" }}>
            {t("diagnostics.feedbackHint")}
          </span>
        </div>
      </div>
      <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

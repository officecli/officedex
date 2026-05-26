import { Button, Tag, message } from "antd";
import { CopyOutlined, DownloadOutlined, RocketOutlined } from "@ant-design/icons";
import { useCallback, useState } from "react";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { useReportCapability } from "../useReportCapability";
import { ReportIssueDialog } from "./ReportIssueDialog";
import type { ProviderTestResult } from "../../shared/types";

export function DiagnosticsPanel() {
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

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

  const handleProviderTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await officecli.testProvider();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleCopySnapshot = useCallback(async () => {
    try {
      const snapshot = await officecli.getBridgeRuntimeSnapshot();
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      void message.success(t("diagnostics.copySnapshot.copied"));
    } catch (err) {
      void message.error(err instanceof Error ? err.message : t("diagnostics.copySnapshot.error"));
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={handleExport}
            >
              {exported ? t("diagnostics.exported") : t("diagnostics.exportButton")}
            </Button>
            <Button icon={<RocketOutlined />} loading={testing} onClick={handleProviderTest}>
              {testing ? t("diagnostics.providerTest.running") : t("diagnostics.providerTest.button")}
            </Button>
            <Button icon={<CopyOutlined />} onClick={handleCopySnapshot}>
              {t("diagnostics.copySnapshot")}
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
          {testResult ? (
            <Tag color={testResult.ok ? "success" : "error"}>
              {testResult.ok
                ? (testResult.httpStatus > 0
                    ? t("settings.effective.testOkHttp")
                    : t("settings.effective.testOkBridge"))
                    .replace("{status}", String(testResult.httpStatus))
                    .replace("{latency}", String(testResult.latencyMs)) +
                  (testResult.responseMessage
                    ? ` · ${t("settings.effective.testReply")}: ${testResult.responseMessage}`
                    : "")
                : testResult.error
                  ? t("settings.effective.testNetworkError").replace("{error}", testResult.error)
                  : t("settings.effective.testFail").replace("{status}", String(testResult.httpStatus))}
            </Tag>
          ) : null}
          <span style={{ fontSize: 12, color: "#787671" }}>
            {t("diagnostics.feedbackHint")}
          </span>
        </div>
      </div>
      <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

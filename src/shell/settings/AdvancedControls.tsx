import { useCallback, useEffect, useState } from "react";
import { Copy, Download, Rocket } from "lucide-react";

import {
  Button,
  Empty,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
  toast,
  type TableColumn,
} from "../../renderer/ui";
import { ImeInput, ImePasswordInput } from "../../renderer/components/ImeInput";
import { ReportIssueDialog } from "../../renderer/components/ReportIssueDialog";
import { useT } from "../../renderer/i18n";
import { defaultProxySettings, isValidProxyUrl } from "../../renderer/defaults";
import { providerPresets } from "../../renderer/providerPresets";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { useReportCapability } from "../../renderer/useReportCapability";
import { errorMessage } from "../../renderer/utils/values";
import { isExternalAgentRuntimeRun, isHistoricalRuntimeRun, runtimeStatusColor } from "../../renderer/runtimeRuns";
import { AGENT_RUN_FETCH_LIMIT } from "../../renderer/constants/limits";
import { RUNS_POLL_INTERVAL_MS } from "../../renderer/constants/timing";
import { usePolling } from "../../renderer/utils/usePolling";
import type { AgentRun, LlmProvider, ProviderTestResult, ProxySettings } from "../../shared/types";
import { formatProviderTestResult, tagTone } from "./providerTestResult";

/**
 * The four controls in "Advanced & Support" that are more than a switch.
 *
 * Each is a port of a legacy component, and each was written out here rather
 * than imported for the same reason: the legacy versions write class names that
 * only `renderer/styles/settings.css` and `tasks.css` define, and the shell
 * loads neither — so importing `ProviderForm`, `RuntimeRunsPanel` or
 * `DiagnosticsPanel` would render an unstyled form and turn
 * `scripts/verify-shell-styles.mjs` red, which is the gate that exists because
 * exactly that once shipped.
 *
 * The behaviour is the legacy behaviour, including its deliberate details:
 * `testProvider` runs against the *saved* provider, the official probe asks for
 * a second confirmation because it spends credits, the runtime table poll is
 * the same interval, and the provider draft is only reconciled from the remote
 * value when the user has nothing in flight.
 */

const EMPTY_PROVIDER_DRAFT: LlmProvider = { type: "official", baseUrl: "", apiKey: "", model: "" };

function providerHasContent(provider: LlmProvider): boolean {
  return provider.type !== "official" && Boolean(provider.baseUrl.trim() || provider.apiKey.trim() || provider.model.trim());
}

export function ProviderControl({
  remote,
  onSave,
  clearLabel,
  customProviderEnabled,
  onOpenLogin,
}: {
  remote: LlmProvider | null;
  onSave: (next: LlmProvider | null) => void;
  clearLabel: string;
  customProviderEnabled: boolean;
  onOpenLogin?: () => void;
}) {
  const api = useDesktopApi();
  const t = useT();
  const [draft, setDraft] = useState<LlmProvider>(() => remote ?? { ...EMPTY_PROVIDER_DRAFT });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  /*
   * Reconcile when the stored value changes underneath us — a reset, or the
   * first load. A remote of `null` does not wipe the type the user just chose:
   * the backend drops an all-empty provider on the round trip, so "null" is
   * what a user who has picked "custom" but typed nothing yet looks like.
   */
  useEffect(() => {
    if (remote) {
      setDraft(remote);
      return;
    }
    setDraft((current) => (providerHasContent(current) ? current : { ...EMPTY_PROVIDER_DRAFT, type: current.type }));
  }, [remote]);

  const handleChange = useCallback(
    (patch: Partial<LlmProvider>) => {
      if (!customProviderEnabled && (patch.type === "custom" || draft.type !== "official")) return;
      const next = { ...draft, ...patch };
      setDraft(next);
      if (providerHasContent(next)) onSave(next);
      else if (remote !== null) onSave(null);
      // A saved draft makes any previous test result stale.
      setTestResult(null);
    },
    [customProviderEnabled, draft, onSave, remote],
  );

  const handleClear = useCallback(() => {
    setDraft({ ...EMPTY_PROVIDER_DRAFT });
    onSave(null);
    setTestResult(null);
  }, [onSave]);

  const runTest = useCallback(async () => {
    if (draft.type !== "official" && !customProviderEnabled) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result =
        draft.type === "official"
          ? await api.testProvider({ useProviderOverride: true, llmProvider: null, allowPaidOfficialProbe: true })
          : await api.testProvider();
      setTestResult(result);
    } catch (error) {
      setTestResult({
        ok: false,
        httpStatus: 0,
        latencyMs: 0,
        url: "",
        error: errorMessage(error),
      });
    } finally {
      setTesting(false);
    }
  }, [api, customProviderEnabled, draft.type]);

  const confirmAndRunTest = useCallback(() => {
    if (draft.type !== "official") {
      void runTest();
      return;
    }
    /*
     * The official probe costs a real generation, so it asks first. `Modal` is
     * the shared one: it portals into `#shell` and therefore keeps the token
     * bridge, which a dialog on `document.body` would not (audit S7-006).
     */
    Modal.confirm({
      title: t("onboarding.provider.paidProbeTitle"),
      content: t("onboarding.provider.paidProbeBody"),
      okText: t("onboarding.provider.paidProbeOk"),
      cancelText: t("settings.common.cancel"),
      onOk: () => runTest(),
    });
  }, [draft.type, runTest, t]);

  const canTest = draft.type === "official" || (customProviderEnabled && providerHasContent(draft));
  const testTag = testResult ? formatProviderTestResult(testResult, t) : null;

  return (
    <>
      <ProviderFields provider={draft} onChange={handleChange} customProviderEnabled={customProviderEnabled} />
      {!customProviderEnabled ? (
        <div className="shell-settings-hint">
          <span>{t("settings.row.provider.loginRequired")}</span>
          {onOpenLogin ? (
            <Button type="link" size="small" onClick={onOpenLogin}>
              {t("login.button.signIn")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="shell-settings-actions">
        <Button
          icon={<Rocket size={14} />}
          loading={testing}
          disabled={(!canTest && !testing) || (draft.type !== "official" && !customProviderEnabled)}
          onClick={confirmAndRunTest}
        >
          {testing ? t("settings.effective.testRunning") : t("settings.effective.testButton")}
        </Button>
        {testTag ? <Tag tone={tagTone(testTag.tone)}>{testTag.text}</Tag> : null}
        {remote || providerHasContent(draft) ? (
          <Button
            type="link"
            size="small"
            onClick={handleClear}
            disabled={draft.type !== "official" && !customProviderEnabled}
            style={{ marginLeft: "auto" }}
          >
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** The provider's own fields — the one/off switch between official and custom. */
function ProviderFields({
  provider,
  onChange,
  customProviderEnabled,
}: {
  provider: LlmProvider;
  onChange: (patch: Partial<LlmProvider>) => void;
  customProviderEnabled: boolean;
}) {
  const t = useT();
  const displayType: "official" | "custom" = provider.type === "official" ? "official" : "custom";
  const isCustom = displayType === "custom";
  const preset = isCustom ? providerPresets.custom : providerPresets.official;

  return (
    <>
      <Select
        ariaLabel={t("settings.row.provider.title")}
        value={displayType}
        disabled={isCustom && !customProviderEnabled}
        onChange={(value: string) => {
          if (value === "custom" && !customProviderEnabled) return;
          if (value === "official") {
            onChange({ type: "official", baseUrl: "", apiKey: "", model: "" });
            return;
          }
          onChange({
            type: "custom",
            baseUrl: provider.baseUrl || providerPresets.custom.defaultBaseUrl,
            model: provider.model || providerPresets.custom.defaultModel,
          });
        }}
        options={[
          { value: "official", label: t("onboarding.provider.official") },
          { value: "custom", label: t("onboarding.provider.custom"), disabled: !customProviderEnabled },
        ]}
      />
      {isCustom ? (
        <>
          <ImeInput
            aria-label={t("onboarding.provider.baseUrlPlaceholder")}
            placeholder={preset.defaultBaseUrl || t("onboarding.provider.baseUrlPlaceholder")}
            value={provider.baseUrl}
            onValueChange={(value) => onChange({ baseUrl: value })}
            disabled={!customProviderEnabled}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="shell-settings-hint">{t("onboarding.provider.customEndpointHint")}</span>
          <ImePasswordInput
            aria-label={t("onboarding.provider.apiKeyPlaceholder")}
            placeholder={t("onboarding.provider.apiKeyPlaceholder")}
            value={provider.apiKey}
            onValueChange={(value) => onChange({ apiKey: value })}
            disabled={!customProviderEnabled}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <ImeInput
            aria-label={t("onboarding.provider.modelPlaceholder")}
            placeholder={preset.defaultModel || t("onboarding.provider.modelPlaceholder")}
            value={provider.model}
            onValueChange={(value) => onChange({ model: value })}
            disabled={!customProviderEnabled}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * The network proxy. Every request the app makes — updates, generation, the
 * OfficeCLI subprocess — goes through it, which is why it lives on this page
 * and why the URL is validated before it is saved rather than after.
 */
export function ProxyControl({
  remote,
  onSave,
}: {
  remote: ProxySettings | null;
  onSave: (next: ProxySettings) => Promise<unknown>;
}) {
  const t = useT();
  const effectiveRemote = remote ?? defaultProxySettings;
  const [enabled, setEnabled] = useState<boolean>(effectiveRemote.enabled);
  const [url, setUrl] = useState<string>(effectiveRemote.url);
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const next = remote ?? defaultProxySettings;
    setEnabled(next.enabled);
    setUrl(next.url);
    setValidationError(undefined);
  }, [remote?.enabled, remote?.url]);

  const trimmedUrl = url.trim();
  const dirty = enabled !== effectiveRemote.enabled || trimmedUrl !== effectiveRemote.url;
  const canSave = dirty && !submitting && (!enabled || (trimmedUrl !== "" && isValidProxyUrl(trimmedUrl)));

  const handleSave = useCallback(async () => {
    if (enabled && (trimmedUrl === "" || !isValidProxyUrl(trimmedUrl))) {
      setValidationError(t("settings.row.proxy.invalidUrl"));
      return;
    }
    setSubmitting(true);
    setValidationError(undefined);
    try {
      await onSave(
        enabled ? { enabled: true, url: trimmedUrl } : { enabled: false, url: trimmedUrl || defaultProxySettings.url },
      );
      void toast.success({ content: t("settings.row.proxy.saveSuccess"), key: "settings-proxy-saved", duration: 2 });
    } catch {
      // `useSettings` already reports the failure through the page's own banner.
    } finally {
      setSubmitting(false);
    }
  }, [enabled, onSave, t, trimmedUrl]);

  return (
    <>
      <div className="shell-settings-toggle">
        <Switch
          ariaLabel={t("settings.row.proxy.enableLabel")}
          checked={enabled}
          onChange={(checked) => {
            setEnabled(checked);
            if (!checked) setValidationError(undefined);
          }}
        />
        <span>{t("settings.row.proxy.enableLabel")}</span>
      </div>
      {enabled ? (
        <ImeInput
          aria-label={t("settings.row.proxy.urlLabel")}
          placeholder={t("settings.row.proxy.urlPlaceholder")}
          value={url}
          onValueChange={(value) => {
            setUrl(value);
            if (validationError) setValidationError(undefined);
          }}
          status={validationError ? "error" : undefined}
        />
      ) : null}
      {validationError ? (
        <div className="shell-settings-error" role="alert">
          {validationError}
        </div>
      ) : null}
      <div className="shell-settings-actions" data-align="end">
        <Button type="primary" onClick={() => void handleSave()} disabled={!canSave} loading={submitting}>
          {t("settings.row.proxy.save")}
        </Button>
      </div>
    </>
  );
}

/**
 * Diagnostics: the four things a user can hand to support.
 *
 * The report dialog is the one legacy component this page reuses directly. It
 * is a self-contained form over the shared primitives, and its two class names
 * (`report-context-bar`, `report-context-item`) are given rules in
 * `settings.css` — they had none anywhere in the repository, which is why this
 * is the only import of its kind here and why the rules are commented where
 * they are.
 */
export function DiagnosticsControl() {
  const api = useDesktopApi();
  const t = useT();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const capability = useReportCapability();

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await api.exportLogs();
      setExported(true);
      void toast.success(t("diagnostics.exportSuccess", { path: result.path }));
    } catch (error) {
      void toast.error(errorMessage(error) || t("diagnostics.exportError"));
    } finally {
      setExporting(false);
    }
  }, [api, t]);

  const handleProviderTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testProvider());
    } catch (error) {
      setTestResult({ ok: false, httpStatus: 0, latencyMs: 0, url: "", error: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }, [api]);

  const handleCopySnapshot = useCallback(async () => {
    try {
      const snapshot = await api.getBridgeRuntimeSnapshot();
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      void toast.success(t("diagnostics.copySnapshot.copied"));
    } catch (error) {
      void toast.error(errorMessage(error) || t("diagnostics.copySnapshot.error"));
    }
  }, [api, t]);

  return (
    <>
      <div className="shell-settings-actions">
        <Button icon={<Download size={14} />} loading={exporting} onClick={() => void handleExport()}>
          {exported ? t("diagnostics.exported") : t("diagnostics.exportButton")}
        </Button>
        <Button icon={<Rocket size={14} />} loading={testing} onClick={() => void handleProviderTest()}>
          {testing ? t("diagnostics.providerTest.running") : t("diagnostics.providerTest.button")}
        </Button>
        <Button icon={<Copy size={14} />} onClick={() => void handleCopySnapshot()}>
          {t("diagnostics.copySnapshot")}
        </Button>
        {capability?.enabled ? (
          <Button type="primary" onClick={() => setReportOpen(true)}>
            {t("diagnostics.reportIssue")}
          </Button>
        ) : null}
      </div>
      {testResult ? (
        <Tag tone={testResult.ok ? "success" : "danger"}>
          {testResult.ok
            ? (testResult.httpStatus > 0 ? t("settings.effective.testOkHttp") : t("settings.effective.testOkBridge"))
                .replace("{status}", String(testResult.httpStatus))
                .replace("{latency}", String(testResult.latencyMs)) +
              (testResult.responseMessage ? ` · ${t("settings.effective.testReply")}: ${testResult.responseMessage}` : "")
            : testResult.error
              ? t("settings.effective.testNetworkError").replace("{error}", testResult.error)
              : t("settings.effective.testFail").replace("{status}", String(testResult.httpStatus))}
        </Tag>
      ) : null}
      <span className="shell-settings-note">{t("diagnostics.feedbackHint")}</span>
      <ReportIssueDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}

/**
 * The runtime runs table — the debug view of workflow runs: observe, cancel,
 * retry. It deliberately does not answer prompts; those belong on Home, where
 * the user can act on them without opening a debug surface.
 */
export function RuntimeRunsControl() {
  const api = useDesktopApi();
  const t = useT();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string>();
  const [busyRun, setBusyRun] = useState<string>();
  const [showHistorical, setShowHistorical] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRuns(await api.listAgentRuns(AGENT_RUN_FETCH_LIMIT));
      setError(undefined);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [api]);

  usePolling(refresh, RUNS_POLL_INTERVAL_MS);

  const actOnRun = async (run: AgentRun, action: "cancel" | "retry") => {
    setBusyRun(run.id);
    setError(undefined);
    try {
      if (action === "cancel") await api.cancelAgentRun(run.id);
      else await api.retryAgentRun(run.id);
      await refresh();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyRun(undefined);
    }
  };

  const historicalCount = runs.filter(isHistoricalRuntimeRun).length;
  const visibleRuns = showHistorical ? runs : runs.filter((run) => !isHistoricalRuntimeRun(run));

  const columns: TableColumn<AgentRun>[] = [
    {
      title: t("tasks.runtime.column.workflow"),
      dataIndex: "workflow",
      render: (workflow, run) => (
        <span className="shell-settings-runtime-run">
          <Tooltip title={run.id}>
            <strong>{String(workflow)}</strong>
          </Tooltip>
          {isHistoricalRuntimeRun(run) ? (
            <Tooltip title={t("tasks.runtime.historical.tooltip")}>
              <Tag color="gray">{t("tasks.runtime.historical.label")}</Tag>
            </Tooltip>
          ) : null}
          {isExternalAgentRuntimeRun(run) ? (
            <Tooltip title={t("tasks.runtime.externalAgent.tooltip")}>
              <Tag color="blue">{t("tasks.runtime.externalAgent.label")}</Tag>
            </Tooltip>
          ) : null}
        </span>
      ),
    },
    {
      title: t("tasks.runtime.column.status"),
      dataIndex: "status",
      render: (status: AgentRun["status"]) => <Tag color={runtimeStatusColor(status)}>{status}</Tag>,
    },
    {
      title: t("tasks.runtime.column.step"),
      dataIndex: "current_step",
      render: (step) => (typeof step === "string" && step) || "—",
    },
    {
      title: t("tasks.runtime.column.actions"),
      dataIndex: "id",
      render: (_value, run) => (
        <span className="shell-settings-actions">
          {["created", "running", "waiting_input", "waiting_approval", "waiting_client_tool", "review_ready"].includes(
            run.status,
          ) ? (
            <Button size="small" loading={busyRun === run.id} onClick={() => void actOnRun(run, "cancel")}>
              {t("tasks.runtime.cancel")}
            </Button>
          ) : null}
          {["failed", "cancelled"].includes(run.status) && !isHistoricalRuntimeRun(run) ? (
            <Button size="small" variant="secondary" loading={busyRun === run.id} onClick={() => void actOnRun(run, "retry")}>
              {t("tasks.runtime.retry")}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="shell-settings-actions">
        <span className="shell-settings-note">{t("tasks.runtime.subtitle")}</span>
        {historicalCount > 0 ? (
          <Button size="small" variant="secondary" onClick={() => setShowHistorical((current) => !current)}>
            {showHistorical
              ? t("tasks.runtime.historical.hide")
              : t("tasks.runtime.historical.show", { count: historicalCount })}
          </Button>
        ) : null}
      </div>
      {visibleRuns.length > 0 ? (
        <Table rowKey="id" columns={columns} dataSource={visibleRuns} pagination={{ pageSize: 8, showSizeChanger: false }} />
      ) : (
        <Empty description={t("tasks.runtime.empty")} />
      )}
      {error ? (
        <div className="shell-settings-error" role="alert">
          {error}
        </div>
      ) : null}
    </>
  );
}

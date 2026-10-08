/**
 * The dialogs Settings opens — OD-UI-1.2 §08 and §12.
 *
 * A row in Settings holds one control. Anything that needs a form, a list or a
 * sequence of stages is a dialog the row's button opens, which is where the
 * approved prototype puts them too. Each writes through the same calls the
 * previous settings page used; what changed is where the control sits, not what
 * it does.
 */
import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";

import { useT } from "../../../renderer/i18n";
import { defaultProxySettings, isValidProxyUrl } from "../../../renderer/defaults";
import { useDesktopApi } from "../../../renderer/services/desktopApi";
import { useAppUpdate, type UseAppUpdateValue } from "../../../renderer/useAppUpdate";
import { errorMessage } from "../../../renderer/utils/values";
import type { CreditStatus, LlmProvider, ProviderTestResult, ProxySettings, UserSettings } from "../../../shared/types";
import type { JiraAuthType, JiraConnectionSummary, JiraProbeResult } from "../../../shared/verticals";
import { useAgentTasks } from "../../agent/useAgentTasks";
import { avatarUrl } from "../../chrome/Sidebar";
import { useShellAppUpdate } from "../../chrome/UpdateGate";
import { Icon } from "../../kit/Icon";
import { closeModal, notice, openModal, retitleModal } from "../../kit/layers";
import { usePort } from "../../port/PortContext";
import { attempt } from "../../port/reportPortFailure";
import { AVATAR_IDS, type AvatarId } from "../../state/shellReducer";
import { useShell } from "../../state/ShellContext";
import { AdvancedDiagnostics } from "../../settings/AdvancedDiagnostics";
import { formatProviderTestResult } from "../../settings/providerTestResult";
import { Field } from "./kit";

type Translate = ReturnType<typeof useT>;

export const JIRA_CHANGED = "officedex:jira-connection-updated";

const ATLASSIAN_PAT_DOCUMENTATION_URL =
  "https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html";

/* ------------------------------------------------------------- plain dialogs */

export function openShortcuts(t: Translate) {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent);
  const mod = mac ? "⌘" : "Ctrl";
  const rows: Array<[string, string]> = [
    [`${mod} O`, t("dx.settings.shortcut.open")],
    [`${mod} N`, t("dx.settings.shortcut.new")],
    [`${mod} S`, t("dx.settings.shortcut.save")],
    [`${mod} W`, t("dx.settings.shortcut.close")],
    [`${mod} ,`, t("dx.settings.shortcut.settings")],
    ["Esc", t("dx.settings.shortcut.escape")],
    [t("dx.settings.shortcut.sendKeys"), t("dx.settings.shortcut.send")],
  ];
  openModal({
    title: t("dx.settings.shortcuts"),
    render: () => (
      <table>
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={keys}>
              <td>
                <span className="dx-key">{keys}</span>
              </td>
              <td>{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  });
}

/** What this version opens, and nothing it does not. */
export function openFormats(t: Translate) {
  openModal({
    title: t("dx.settings.formatsTitle"),
    render: () => (
      <>
        <div className="dx-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("dx.settings.formatsFamily")}</th>
                <th>{t("dx.settings.formatsOpen")}</th>
                <th>{t("dx.settings.formatsSave")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>DOCX / XLSX / PPTX</td>
                <td>{t("dx.settings.formatsOfficeOpen")}</td>
                <td>{t("dx.settings.formatsOfficeSave")}</td>
              </tr>
              <tr>
                <td>PNG / JPG</td>
                <td>{t("dx.settings.formatsImageOpen")}</td>
                <td>{t("dx.settings.formatsImageSave")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="dx-helper">{t("dx.settings.formatsOther")}</p>
      </>
    ),
  });
}

export function openFileAccess(t: Translate) {
  openModal({
    title: t("dx.settings.fileAccess"),
    render: () => (
      <>
        <p>{t("dx.settings.fileAccessBody")}</p>
        <p>{t("dx.settings.fileAccessNone")}</p>
      </>
    ),
  });
}

export function openExternalPolicy(t: Translate) {
  openModal({
    title: t("dx.settings.external"),
    render: () => (
      <>
        <p>{t("dx.settings.externalBody1")}</p>
        <p>{t("dx.settings.externalBody2")}</p>
        <button type="button" className="dx-btn" data-act="permissions" onClick={() => openFileAccess(t)}>
          {t("dx.settings.reviewFileAccess")}
        </button>
      </>
    ),
  });
}

export function openTerms(t: Translate, onLicense: () => void) {
  openModal({
    title: t("settings.about.disclaimerTitle"),
    render: (close) => (
      <>
        <p>{t("settings.about.disclaimerBody")}</p>
        <div className="dx-actions">
          <button type="button" className="dx-btn dx-primary" data-act="modal-close" onClick={close}>
            {t("dx.action.close")}
          </button>
          <button type="button" className="dx-btn" onClick={onLicense}>
            {t("dx.settings.linkLicense")}
          </button>
        </div>
      </>
    ),
  });
}

export function openUsage(t: Translate, credit: CreditStatus | null, onModels: () => void) {
  const balance = credit ? (credit.hostedCreditBalance ?? credit.anonymousCreditBalance) : null;
  openModal({
    title: t("dx.settings.usageTitle"),
    render: () => (
      <>
        {credit ? (
          <dl className="dx-definition">
            {credit.planName ? (
              <>
                <dt>{t("dx.settings.usageField.plan")}</dt>
                <dd>{credit.planName}</dd>
              </>
            ) : null}
            <dt>{t("dx.settings.usageField.balance")}</dt>
            <dd>{balance ?? "—"}</dd>
            {credit.rewardRemaining > 0 ? (
              <>
                <dt>{t("dx.settings.usageField.reward")}</dt>
                <dd>{credit.rewardRemaining}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>{t("dx.settings.usageUnknown")}</p>
        )}
        <p>{t("dx.settings.usageNote")}</p>
        <button
          type="button"
          className="dx-btn"
          data-act="settings"
          data-id="models"
          onClick={() => {
            closeModal();
            onModels();
          }}
        >
          {t("dx.settings.section.models")}
        </button>
      </>
    ),
  });
}

/* -------------------------------------------------------------------- forms */

function FormActions({ action, busy }: { action: string; busy: boolean }) {
  const t = useT();
  return (
    <div className="dx-form-actions">
      <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
        {t("dx.action.cancel")}
      </button>
      <button type="submit" className="dx-btn dx-primary" disabled={busy}>
        {action}
      </button>
    </div>
  );
}

const FormError = ({ message }: { message: string }) => (
  <p className="dx-error" role="alert" data-form-error>
    {message}
  </p>
);

function ProxyForm({ remote, onSave }: { remote: ProxySettings | null; onSave: (next: ProxySettings) => Promise<unknown> }) {
  const t = useT();
  const [url, setUrl] = useState(remote?.enabled ? remote.url : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = url.trim();
    if (value && !isValidProxyUrl(value)) {
      setError(t("settings.row.proxy.invalidUrl"));
      return;
    }
    setBusy(true);
    try {
      // An empty field hands the connection back to the system; the address
      // that was there is kept, so turning the proxy on again has it.
      await onSave(
        value ? { enabled: true, url: value } : { enabled: false, url: remote?.url || defaultProxySettings.url },
      );
      closeModal();
      notice(t("settings.row.proxy.saveSuccess"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-form="proxy" onSubmit={(event) => void submit(event)}>
      <Field
        label={t("dx.settings.proxyUrl")}
        name="proxy"
        type="text"
        inputMode="url"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t("dx.settings.proxySystem")}
        value={url}
        invalid={Boolean(error)}
        onChange={(event) => {
          setUrl(event.target.value);
          setError("");
        }}
      />
      <p className="dx-helper">{t("dx.settings.proxyHelper")}</p>
      <FormActions action={t("dx.settings.modelSave")} busy={busy} />
      <FormError message={error} />
    </form>
  );
}

export function openProxy(t: Translate, remote: ProxySettings | null, onSave: (next: ProxySettings) => Promise<unknown>) {
  openModal({ title: t("dx.settings.proxy"), render: () => <ProxyForm remote={remote} onSave={onSave} /> });
}

function RedeemForm({ onRedeemed }: { onRedeemed: () => void }) {
  const t = useT();
  const api = useDesktopApi();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    // A code is read off a card by a person; lower case is how it arrives wrong.
    const value = code.trim().toUpperCase();
    if (!value) {
      setError(t("settings.redeem.empty"));
      return;
    }
    setBusy(true);
    try {
      const result = await api.redeem(value);
      onRedeemed();
      closeModal();
      notice(t("settings.redeem.success", { amount: result.credit_amount }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-form="redeem" onSubmit={(event) => void submit(event)}>
      <Field
        label={t("dx.settings.redeemField")}
        name="code"
        type="text"
        required
        maxLength={64}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        invalid={Boolean(error)}
        onChange={(event) => {
          setCode(event.target.value);
          setError("");
        }}
      />
      <FormActions action={t("dx.settings.redeemAction")} busy={busy} />
      <FormError message={error} />
    </form>
  );
}

export function openRedeem(t: Translate, onRedeemed: () => void) {
  openModal({ title: t("dx.settings.redeemTitle"), render: () => <RedeemForm onRedeemed={onRedeemed} /> });
}

/* --------------------------------------------------------------------- Jira */

function JiraForm() {
  const t = useT();
  const api = useDesktopApi();
  const [remote, setRemote] = useState<JiraConnectionSummary | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState<JiraAuthType>("token");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [probe, setProbe] = useState<JiraProbeResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The read shells out, and a wedged CLI must not leave the form waiting forever.
  useEffect(() => {
    let cancelled = false;
    const empty: JiraConnectionSummary = { configured: false, baseUrl: "", authType: "" };
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setRemote((current) => current ?? empty);
      setError(t("settings.row.jira.loadTimeout"));
    }, 15_000);
    api
      .getJiraConnection()
      .then((summary) => {
        if (cancelled) return;
        setRemote(summary);
        setBaseUrl(summary.baseUrl);
        if (summary.configured) {
          setAuthType(summary.authType === "basic" ? "basic" : "token");
          setUsername(summary.username ?? "");
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setRemote(empty);
        setError(errorMessage(reason));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [api, t]);

  if (!remote) {
    return (
      <p className="dx-row">
        <span className="dx-spinner" />
        {t("dx.settings.loading")}
      </p>
    );
  }

  // Whether what is typed names the connection already stored: it decides
  // whether an empty secret means "keep the saved one" or "not filled in".
  const sameScope =
    remote.configured &&
    remote.baseUrl.replace(/\/+$/, "") === baseUrl.trim().replace(/\/+$/, "") &&
    remote.authType === authType &&
    (remote.username ?? "") === (authType === "basic" ? username.trim() : "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!secret.trim() && !sameScope) {
      setError(t("dx.settings.jiraSecretRequired"));
      return;
    }
    setBusy(true);
    setError("");
    setProbe(null);
    try {
      const result = await api.saveJiraConnection({
        baseUrl: baseUrl.trim(),
        auth: { type: authType, ...(authType === "basic" ? { username: username.trim() } : {}), secret },
      });
      setRemote(await api.getJiraConnection());
      setProbe(result);
      setSecret("");
      window.dispatchEvent(new Event(JIRA_CHANGED));
      notice(t("settings.row.jira.saveSuccess"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.clearJiraConnection();
      window.dispatchEvent(new Event(JIRA_CHANGED));
      closeModal();
      notice(t("settings.row.jira.clearSuccess"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const secretLabel = authType === "token" ? t("shell.misc.personalAccessToken") : t("settings.row.jira.password");

  return (
    <form data-form="jira" onSubmit={(event) => void submit(event)}>
      <Field
        label={t("dx.settings.jiraUrl")}
        name="url"
        type="url"
        required
        autoCapitalize="off"
        spellCheck={false}
        value={baseUrl}
        onChange={(event) => {
          setBaseUrl(event.target.value);
          setProbe(null);
        }}
      />
      <label className="dx-form-field">
        <span>{t("settings.row.jira.authType")}</span>
        <select
          name="authType"
          value={authType}
          onChange={(event) => {
            setAuthType(event.target.value === "basic" ? "basic" : "token");
            setSecret("");
            setProbe(null);
          }}
        >
          <option value="token">{t("shell.misc.personalAccessToken")}</option>
          <option value="basic">{t("settings.row.jira.basicAuth")}</option>
        </select>
      </label>
      {authType === "basic" ? (
        <Field
          label={t("settings.row.jira.username")}
          name="username"
          type="text"
          required
          autoComplete="username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            setProbe(null);
          }}
        />
      ) : null}
      <Field
        label={secretLabel}
        name="token"
        type="password"
        autoComplete="off"
        placeholder={sameScope ? t("settings.row.jira.keepSecret") : undefined}
        value={secret}
        onChange={(event) => {
          setSecret(event.target.value);
          setProbe(null);
        }}
      />
      {authType === "token" ? (
        <>
          <p className="dx-helper">{t("settings.row.jira.patHelpTitle")}</p>
          <ol className="dx-helper">
            <li>{t("settings.row.jira.patHelpStep1")}</li>
            <li>{t("settings.row.jira.patHelpStep2")}</li>
            <li>{t("settings.row.jira.patHelpStep3")}</li>
          </ol>
          <p className="dx-helper">
            {t("settings.row.jira.patHelpAdminNote")}{" "}
            <a
              href={ATLASSIAN_PAT_DOCUMENTATION_URL}
              onClick={(event) => {
                event.preventDefault();
                void api.openExternal(ATLASSIAN_PAT_DOCUMENTATION_URL).catch(() => undefined);
              }}
            >
              {t("settings.row.jira.patDocumentation")}
            </a>
          </p>
        </>
      ) : null}
      <p className="dx-helper">{t("settings.row.jira.secretNote")}</p>
      {probe ? (
        <p className="dx-metadata" role="status">
          {probe.server.serverTitle || "Jira"} {probe.server.version} · {probe.user.displayName || probe.user.name}
        </p>
      ) : null}
      <div className="dx-form-actions">
        {remote.configured ? (
          <button type="button" className="dx-btn dx-danger" disabled={busy} onClick={() => void disconnect()}>
            {t("dx.settings.jiraDisconnect")}
          </button>
        ) : null}
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button type="submit" className="dx-btn dx-primary" disabled={busy}>
          {t("dx.settings.jiraSubmit")}
        </button>
      </div>
      <FormError message={error} />
    </form>
  );
}

export function openJira(t: Translate) {
  openModal({ title: t("dx.settings.jiraTitle"), render: () => <JiraForm /> });
}

/* ------------------------------------------------------------------- models */

function ModelForm({
  remote,
  onSave,
}: {
  remote: LlmProvider | null;
  onSave: (next: LlmProvider) => Promise<unknown>;
}) {
  const t = useT();
  const [baseUrl, setBaseUrl] = useState(remote?.baseUrl ?? "");
  const [model, setModel] = useState(remote?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasKey = Boolean(remote?.apiKey);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!/^https?:\/\/\S+$/i.test(baseUrl.trim())) {
      setError(t("dx.settings.modelUrlInvalid"));
      return;
    }
    setBusy(true);
    try {
      await onSave({
        type: "custom",
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || remote?.apiKey || "",
      });
      closeModal();
      notice(t("dx.settings.saved"));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-form="model" onSubmit={(event) => void submit(event)}>
      <Field
        label={t("dx.settings.modelUrl")}
        name="endpoint"
        type="url"
        required
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="https://api.example.com/v1"
        value={baseUrl}
        invalid={Boolean(error)}
        onChange={(event) => {
          setBaseUrl(event.target.value);
          setError("");
        }}
      />
      <Field
        label={t("dx.settings.modelId")}
        name="modelId"
        type="text"
        required
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={model}
        onChange={(event) => setModel(event.target.value)}
      />
      <Field
        label={t("dx.settings.modelKey")}
        name="key"
        type={showKey ? "text" : "password"}
        required={!hasKey}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={hasKey ? t("dx.settings.modelKeyKept") : undefined}
        value={apiKey}
        onChange={(event) => setApiKey(event.target.value)}
      />
      <label className="dx-row">
        <input type="checkbox" data-show-key checked={showKey} onChange={(event) => setShowKey(event.target.checked)} />
        {t("dx.settings.modelShowKey")}
      </label>
      <p className="dx-helper">{t("onboarding.provider.customEndpointHint")}</p>
      <FormActions action={t("dx.settings.modelSave")} busy={busy} />
      <FormError message={error} />
    </form>
  );
}

export function openModel(t: Translate, remote: LlmProvider | null, onSave: (next: LlmProvider) => Promise<unknown>) {
  const custom = remote && remote.type !== "official" ? remote : null;
  openModal({
    title: t(custom ? "dx.settings.modelEditTitle" : "dx.settings.modelAddTitle"),
    render: () => <ModelForm remote={custom} onSave={onSave} />,
  });
}

function ModelTest({ name, official, onEdit }: { name: string; official: boolean; onEdit?: () => void }) {
  const t = useT();
  const api = useDesktopApi();
  const [result, setResult] = useState<ProviderTestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The test runs against the saved provider; the official probe says it is one.
    const run = official
      ? api.testProvider({ useProviderOverride: true, llmProvider: null, allowPaidOfficialProbe: true })
      : api.testProvider();
    run
      .catch(
        (reason): ProviderTestResult => ({ ok: false, httpStatus: 0, latencyMs: 0, url: "", error: errorMessage(reason) }),
      )
      .then((value) => {
        if (cancelled) return;
        setResult(value);
        retitleModal(t(value.ok ? "dx.settings.modelTestPassed" : "dx.settings.modelTestFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, official, t]);

  if (!result) {
    return (
      <>
        <p className="dx-row">
          <span className="dx-spinner" />
          {t("dx.settings.modelTestingBody", { name })}
        </p>
        <button type="button" className="dx-btn" data-act="cancel-model-test" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
      </>
    );
  }

  return (
    <>
      <p role="status">{formatProviderTestResult(result, t).text}</p>
      <p className="dx-helper">{t(result.ok ? "dx.settings.modelNote" : "dx.settings.modelTestNoTask")}</p>
      <div className="dx-actions">
        {!result.ok && onEdit ? (
          <button type="button" className="dx-btn dx-primary" data-act="edit-model" onClick={onEdit}>
            {t("dx.settings.modelEdit")}
          </button>
        ) : null}
        <button
          type="button"
          className={result.ok || !onEdit ? "dx-btn dx-primary" : "dx-btn"}
          data-act="modal-close"
          onClick={closeModal}
        >
          {t("dx.action.close")}
        </button>
      </div>
    </>
  );
}

export function openModelTest(t: Translate, options: { name: string; official: boolean; onEdit?: () => void }) {
  openModal({ title: t("dx.settings.modelTesting"), render: () => <ModelTest {...options} /> });
}

/* ------------------------------------------------------------------- avatar */

function AvatarPicker() {
  const t = useT();
  const { state, dispatch } = useShell();
  const [draft, setDraft] = useState<AvatarId>(state.avatar);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = AVATAR_IDS.indexOf(draft);
    const count = AVATAR_IDS.length;
    const next = AVATAR_IDS[event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + delta + count) % count];
    setDraft(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  };

  return (
    <>
      <p>{t("dx.settings.avatarBody")}</p>
      <div className="dx-avatar-options" role="radiogroup" aria-label={t("dx.settings.avatarGroup")} onKeyDown={onKeyDown}>
        {AVATAR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="dx-avatar-choice"
            role="radio"
            aria-checked={draft === id}
            tabIndex={draft === id ? 0 : -1}
            autoFocus={draft === id}
            data-act="avatar-select"
            data-id={id}
            aria-label={t(`dx.settings.avatar.${id}`)}
            onClick={() => setDraft(id)}
          >
            <img src={avatarUrl(id)} alt="" />
            <span>{t(`dx.settings.avatar.${id}`)}</span>
            {draft === id ? (
              <span className="dx-avatar-check">
                <Icon name="Check" size={12} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="avatar-save"
          onClick={() => {
            dispatch({ type: "set-avatar", avatar: draft });
            closeModal();
            notice(t("dx.settings.avatarSaved"));
          }}
        >
          {t("dx.settings.avatarSave")}
        </button>
      </div>
    </>
  );
}

export function openAvatarPicker(t: Translate) {
  openModal({ title: t("dx.settings.avatarTitle"), className: "avatar-dialog", render: () => <AvatarPicker /> });
}

/* ----------------------------------------------------------------- activity */

function Activity() {
  const t = useT();
  const port = usePort();
  const { dispatch } = useShell();
  const { tasks } = useAgentTasks(20);

  if (tasks.length === 0) return <p>{t("dx.settings.activityEmpty")}</p>;
  return (
    <>
      {tasks.map((task) => {
        const conversationId = task.conversationId ?? task.id;
        return (
          <div key={task.id} className="dx-recovery-row">
            <button
              type="button"
              className="dx-grow dx-project-chat"
              data-act="open-chat"
              data-id={conversationId}
              onClick={async () => {
                const opened = await attempt(
                  async () => void (await port.agent.openConversation(task.folderId, conversationId)),
                );
                if (!opened) return;
                closeModal();
                dispatch({ type: "open-chat", chat: { folderId: task.folderId, conversationId } });
              }}
            >
              <span className="dx-ellipsis">{task.title}</span>
            </button>
            <span className="dx-pill">{t(`shell.agentStatus.${STATUS_KEY[task.status] ?? "idle"}`)}</span>
          </div>
        );
      })}
    </>
  );
}

const STATUS_KEY: Record<string, string> = {
  idle: "idle",
  reading: "reading",
  writing: "writing",
  working: "working",
  paused: "paused",
  "awaiting-review": "awaitingReview",
  done: "done",
};

export function openActivity(t: Translate) {
  openModal({ title: t("dx.settings.activity"), className: "wide", render: () => <Activity /> });
}

/* --------------------------------------------------------- help, diagnostics */

export function openDiagnostics(t: Translate) {
  openModal({
    title: t("dx.settings.diagnosticsTitle"),
    className: "wide",
    render: () => (
      <>
        <p>{t("diagnostics.description")}</p>
        <AdvancedDiagnostics />
      </>
    ),
  });
}

function Help({ onModels }: { onModels: () => void }) {
  const t = useT();
  const api = useDesktopApi();
  const open = (url: string) => void api.openExternal(url).catch(() => undefined);
  return (
    <>
      <div className="dx-actions">
        <button type="button" className="dx-btn" onClick={() => open("https://officecli.io")}>
          {t("dx.settings.helpWebsite")}
        </button>
        <button
          type="button"
          className="dx-btn"
          data-act="settings"
          data-id="models"
          onClick={() => {
            closeModal();
            onModels();
          }}
        >
          {t("dx.settings.helpModels")}
        </button>
        <button type="button" className="dx-btn" onClick={() => open("https://github.com/officecli/officedex/issues")}>
          {t("dx.settings.helpFeedback")}
        </button>
      </div>
      <hr className="dx-divider" />
      <p>{t("dx.settings.helpBody")}</p>
      <button type="button" className="dx-btn" data-act="diagnostics" onClick={() => openDiagnostics(t)}>
        {t("dx.settings.prepareDiagnostics")}
      </button>
    </>
  );
}

export function openHelp(t: Translate, onModels: () => void) {
  openModal({ title: t("dx.settings.helpTitle"), render: () => <Help onModels={onModels} /> });
}

/* ------------------------------------------------------------------ updates */

/**
 * One dialog that follows an update from the check to the restart.
 *
 * Inside the desktop app it reads the updater the mandatory-update gate owns, so
 * a download started here shows its progress in the sidebar's button and the
 * other way round. With no gate above — a test, a page on its own — it starts
 * one of its own.
 */
function UpdateFlow() {
  const shared = useShellAppUpdate();
  return shared ? <UpdateStages update={shared} /> : <OwnUpdateFlow />;
}

const OwnUpdateFlow = () => <UpdateStages update={useAppUpdate()} />;

function UpdateStages({ update }: { update: UseAppUpdateValue }) {
  const t = useT();
  const [checking, setChecking] = useState(true);
  const { check, download, install, cancel, status, release, phase, progress } = update;

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      await check();
    } finally {
      setChecking(false);
    }
  }, [check]);

  useEffect(() => {
    void runCheck();
    // Asked once, when the dialog opens; Retry asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloading = phase === "downloading";
  const ready = phase === "downloaded" || phase === "installing";
  const failed = !checking && Boolean(status.lastError || update.error);
  const available = status.updateAvailable && release;
  const stage = checking
    ? "checking"
    : downloading
      ? "downloading"
      : ready
        ? "ready"
        : failed
          ? "failed"
          : available
            ? "available"
            : "current";

  useEffect(() => {
    retitleModal(t(`dx.settings.update.${stage}`));
  }, [stage, t]);

  const percent =
    progress.bytesTotal > 0 ? Math.min(100, Math.round((progress.bytesDone / progress.bytesTotal) * 100)) : 0;
  const version = release?.version ?? status.latestVersion ?? status.currentVersion;

  switch (stage) {
    case "checking":
      return (
        <>
          <p className="dx-row">
            <span className="dx-spinner" />
            {t("dx.settings.update.checkingBody")}
          </p>
          <button type="button" className="dx-btn" data-act="cancel-update" onClick={closeModal}>
            {t("dx.action.cancel")}
          </button>
        </>
      );
    case "failed":
      return (
        <>
          <p>{t("dx.settings.update.failedBody")}</p>
          <p className="dx-helper">{status.lastError || update.error}</p>
          <button type="button" className="dx-btn dx-primary" data-act="update-check" onClick={() => void runCheck()}>
            {t("dx.settings.update.retry")}
          </button>
        </>
      );
    case "available":
      return (
        <>
          <p>{t("dx.settings.update.availableBody", { version })}</p>
          <div className="dx-actions">
            <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
              {t("dx.settings.update.later")}
            </button>
            <button type="button" className="dx-btn dx-primary" data-act="update-download" onClick={() => void download()}>
              {t("dx.settings.update.download")}
            </button>
          </div>
        </>
      );
    case "downloading":
      return (
        <>
          <p>{t("dx.settings.update.downloadingBody")}</p>
          <div className="dx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span id="dx-update-progress" style={{ width: `${percent}%` }} />
          </div>
          <p id="dx-update-percent">{percent}%</p>
          <button type="button" className="dx-btn" data-act="cancel-update" onClick={() => void cancel()}>
            {t("dx.settings.update.cancel")}
          </button>
        </>
      );
    case "ready":
      return (
        <>
          <p>{t("dx.settings.update.readyBody")}</p>
          <div className="dx-actions">
            <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
              {t("dx.settings.update.installLater")}
            </button>
            <button type="button" className="dx-btn dx-primary" data-act="restart-update" onClick={() => void install()}>
              {t("dx.settings.update.install")}
            </button>
          </div>
        </>
      );
    default:
      return (
        <>
          <p>{t("dx.settings.update.currentBody", { version: status.currentVersion })}</p>
          <button type="button" className="dx-btn dx-primary" data-act="modal-close" onClick={closeModal}>
            {t("dx.action.close")}
          </button>
        </>
      );
  }
}

export function openUpdate(t: Translate) {
  openModal({ title: t("dx.settings.update.checking"), render: () => <UpdateFlow /> });
}

export type SettingsUpdate = (patch: Partial<UserSettings>) => Promise<UserSettings>;

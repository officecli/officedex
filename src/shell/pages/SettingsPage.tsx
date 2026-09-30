import { useCallback, useEffect, useState } from "react";

import { useLocale, useSetLocale, useT } from "../../renderer/i18n";
import {
  readNotificationsEnabled,
  setNotificationsEnabled as persistNotificationsEnabled,
} from "../../renderer/notifications";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { useAppUpdate, type UseAppUpdateValue } from "../../renderer/useAppUpdate";
import { useSettings } from "../../renderer/useSettings";
import { errorMessage } from "../../renderer/utils/values";
import type { CreditStatus, DocumentType, InviteInfo, UserSettings, WhoAmIResult } from "../../shared/types";
import type { JiraConnectionSummary } from "../../shared/verticals";
import { avatarUrl } from "../chrome/Sidebar";
import { useShellAppUpdate } from "../chrome/UpdateGate";
import { useComposerSettings } from "../composer/useComposerSettings";
import { DexFace } from "../dex/DexFace";
import { openConfirmDialog } from "../kit/dialogs";
import { notice, openModal } from "../kit/layers";
import { notBuiltYet } from "../port/reportPortFailure";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../state/shellReducer";
import { useShell } from "../state/ShellContext";
import {
  JIRA_CHANGED,
  openActivity,
  openAvatarPicker,
  openDiagnostics,
  openExternalPolicy,
  openFileAccess,
  openFormats,
  openHelp,
  openJira,
  openModel,
  openModelTest,
  openProxy,
  openRedeem,
  openShortcuts,
  openTerms,
  openUpdate,
  openUsage,
  type SettingsUpdate,
} from "./settings/dialogs";
import { Row, Toggle } from "./settings/kit";

const LICENSE_URL = "https://github.com/officecli/officedex/blob/main/LICENSE";

/**
 * Settings — OD-UI-1.2 §12.
 *
 *   Settings
 *   Make OfficeDex work the way you do.
 *   ┌ General ─────────────┐  General
 *   │ Files & storage      │  Appearance ……………………………… [Light ▾]
 *   │ Models               │  Reduce motion ………………………… ( o)
 *   │ …                    │  …
 *
 * A page in the content region, not a cover over the window: the sidebar stays,
 * the open documents stay mounted behind it, and leaving is going somewhere
 * else. A preference takes effect when it is changed — there is no Save, and
 * nothing here can lose what was typed in a conversation.
 *
 * Every control the previous settings page had is here, under the section the
 * approved design files it in. Rows the design draws for something this version
 * cannot do keep their place and say so when pressed.
 */
export function SettingsPage({ onOpenAccount }: { onOpenAccount: () => void }) {
  const t = useT();
  const api = useDesktopApi();
  const { state, dispatch } = useShell();
  const { settings, defaultWorkspaceDir, update: rawUpdate, loading, error } = useSettings();
  const [whoami, setWhoami] = useState<WhoAmIResult | null>(null);
  const [credit, setCredit] = useState<CreditStatus | null>(null);

  const section = state.settingsSection;
  const go = useCallback(
    (next: SettingsSectionId) => dispatch({ type: "set-settings-section", section: next }),
    [dispatch],
  );

  // Asked once each. They change when the user signs in or out, which happens
  // on the account page, not while this one sits open.
  useEffect(() => {
    let cancelled = false;
    api
      .whoami()
      .then((result) => !cancelled && setWhoami(result))
      .catch(() => !cancelled && setWhoami({ mode: "anonymous" }));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const refreshCredit = useCallback(() => {
    api
      .getCreditStatus()
      .then(setCredit)
      .catch(() => setCredit(null));
  }, [api]);

  useEffect(refreshCredit, [refreshCredit]);

  const update = useCallback<SettingsUpdate>(
    async (patch) => {
      const next = await rawUpdate(patch);
      notice(t("dx.settings.saved"));
      return next;
    },
    [rawUpdate, t],
  );

  /** A write from a control that has nowhere of its own to show a failure. */
  const save = useCallback(
    (patch: Partial<UserSettings>) => {
      // `useSettings` reports the failure; the banner above the section shows it.
      void update(patch).catch(() => undefined);
    },
    [update],
  );

  const body = () => {
    switch (section) {
      case "general":
        return <General settings={settings} save={save} />;
      case "files":
        return <Files location={settings.workspaceDir || defaultWorkspaceDir} />;
      case "models":
        return (
          <Models
            settings={settings}
            update={update}
            signedIn={whoami === null || whoami.mode === "logged_in"}
            onOpenAccount={onOpenAccount}
            onAccount={() => go("account")}
          />
        );
      case "permissions":
        return <Permissions settings={settings} update={update} />;
      case "notifications":
        return <Notifications />;
      case "account":
        return (
          <Account
            whoami={whoami}
            credit={credit}
            onOpenAccount={onOpenAccount}
            onModels={() => go("models")}
            onRedeemed={refreshCredit}
          />
        );
      case "license":
        return <License />;
      case "about":
        return <About settings={settings} credit={credit} save={save} update={update} onModels={() => go("models")} />;
    }
  };

  return (
    <section className="dx-page-scroll" data-ui-scope="officedex">
      <header className="dx-page-header">
        <div>
          <h1>{t("dx.settings.title")}</h1>
          <p>{t("dx.settings.subtitle")}</p>
        </div>
      </header>
      <div className="dx-settings-layout">
        <nav className="dx-settings-nav" aria-label={t("dx.settings.navAria")}>
          {SETTINGS_SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              data-act="settings"
              data-id={id}
              className={section === id ? "dx-selected" : undefined}
              aria-current={section === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              {t(`dx.settings.section.${id}`)}
            </button>
          ))}
        </nav>
        <div className="dx-settings-content">
          {error ? (
            <div className="dx-banner dx-error" role="alert">
              {error}
            </div>
          ) : null}
          {loading ? (
            <p className="dx-row">
              <span className="dx-spinner" />
              {t("dx.settings.loading")}
            </p>
          ) : (
            body()
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ General */

function General({ settings, save }: { settings: UserSettings; save: (patch: Partial<UserSettings>) => void }) {
  const t = useT();
  const { state, dispatch } = useShell();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const composer = useComposerSettings();
  const defaults = settings.defaults;
  const setDefaults = (patch: Partial<UserSettings["defaults"]>) => save({ defaults: { ...defaults, ...patch } });

  // The four families the design offers, and the saved one if it is none of them.
  const types: DocumentType[] = ["docx", "xlsx", "pptx", "img"];
  if (!types.includes(defaults.documentType)) types.push(defaults.documentType);

  return (
    <>
      <h2>{t("dx.settings.section.general")}</h2>
      <Row title={t("dx.settings.appearance")} desc={t("dx.settings.appearanceDesc")}>
        <select
          aria-label={t("dx.settings.appearance")}
          data-pref="theme"
          value={state.theme}
          onChange={(event) => dispatch({ type: "set-theme", theme: event.target.value === "dark" ? "dark" : "light" })}
        >
          <option value="light">{t("dx.settings.theme.light")}</option>
          <option value="dark">{t("dx.settings.theme.dark")}</option>
        </select>
      </Row>
      <Row title={t("dx.settings.language")} desc={t("dx.settings.languageDesc")}>
        <select
          aria-label={t("dx.settings.language")}
          data-pref="language"
          value={locale}
          onChange={(event) => setLocale(event.target.value === "zh" ? "zh" : "en")}
        >
          <option value="zh">{t("settings.option.language.zh")}</option>
          <option value="en">{t("settings.option.language.en")}</option>
        </select>
      </Row>
      <Row title={t("dx.settings.reduceMotion")} desc={t("dx.settings.reduceMotionDesc")}>
        <Toggle
          id="reduced"
          label={t("dx.settings.reduceMotion")}
          checked={composer.value.reduceMotion}
          onChange={(checked) => void composer.patch({ reduceMotion: checked })}
        />
      </Row>
      <Row title={t("dx.settings.enterSends")} desc={t("dx.settings.enterSendsDesc")}>
        <Toggle
          id="enterSends"
          label={t("dx.settings.enterSends")}
          checked={composer.value.enterToSend}
          onChange={(checked) => void composer.patch({ enterToSend: checked })}
        />
      </Row>
      <Row title={t("dx.settings.defaultType")} desc={t("dx.settings.defaultTypeDesc")}>
        <select
          aria-label={t("dx.settings.defaultType")}
          data-pref="defaultType"
          value={defaults.documentType}
          onChange={(event) => setDefaults({ documentType: event.target.value as DocumentType })}
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`dx.settings.type.${type}`)}
            </option>
          ))}
        </select>
      </Row>
      <Row title={t("dx.settings.includeImages")} desc={t("dx.settings.includeImagesDesc")}>
        <Toggle
          id="includeImages"
          label={t("dx.settings.includeImages")}
          checked={defaults.enableImages}
          onChange={(checked) => setDefaults({ enableImages: checked })}
        />
      </Row>
      <Row title={t("dx.settings.webSearch")} desc={t("dx.settings.webSearchDesc")}>
        <Toggle
          id="webSearch"
          label={t("dx.settings.webSearch")}
          checked={defaults.enableWebSearch}
          onChange={(checked) => setDefaults({ enableWebSearch: checked })}
        />
      </Row>
      <Row title={t("dx.settings.quickEntry")} desc={t("dx.settings.quickEntryDesc")}>
        <Toggle
          id="quickEntry"
          label={t("dx.settings.quickEntry")}
          checked={false}
          onChange={() => notBuiltYet("settings.quickEntry", t("dx.notBuilt.quickEntry"))}
        />
      </Row>
      <Row title={t("dx.settings.shortcuts")} desc={t("dx.settings.shortcutsDesc")}>
        <button type="button" className="dx-btn" data-act="shortcuts" onClick={() => openShortcuts(t)}>
          {t("dx.settings.viewShortcuts")}
        </button>
      </Row>
      <Row title={t("dx.settings.gettingStarted")} desc={t("dx.settings.gettingStartedDesc")}>
        <button
          type="button"
          className="dx-btn"
          data-act="onboarding"
          onClick={() =>
            openConfirmDialog({
              title: t("dx.settings.guideConfirmTitle"),
              body: <p>{t("dx.settings.guideConfirmBody")}</p>,
              action: t("dx.settings.guideConfirmAction"),
              onConfirm: () => {
                save({ onboardingCompletedAt: null });
                notice(t("dx.settings.guideScheduled"));
              },
            })
          }
        >
          {t("dx.settings.viewGuide")}
        </button>
      </Row>
    </>
  );
}

/* ---------------------------------------------------------- Files & storage */

function Files({ location }: { location: string }) {
  const t = useT();
  const missing = (feature: string, key: string) => () => notBuiltYet(feature, t(key));
  return (
    <>
      <h2>{t("dx.settings.section.files")}</h2>
      <Row title={t("dx.settings.workspaceLocation")} desc={location || t("dx.settings.workspaceDefault")}>
        <button
          type="button"
          className="dx-btn"
          data-act="storage-folder"
          onClick={missing("settings.workspaceLocation", "dx.notBuilt.workspaceLocation")}
        >
          {t("dx.settings.change")}
        </button>
      </Row>
      <Row title={t("dx.settings.defaultApps")} desc={t("dx.settings.defaultAppsDesc")}>
        <button
          type="button"
          className="dx-btn"
          data-act="defaults"
          onClick={missing("settings.defaultApps", "dx.notBuilt.defaultApps")}
        >
          {t("dx.settings.manageFormats")}
        </button>
      </Row>
      <Row title={t("dx.settings.storage")} desc={t("dx.settings.storageDesc")}>
        <StorageButton location={location} />
      </Row>
      <Row title={t("dx.settings.recovery")} desc={t("dx.settings.recoveryDesc")}>
        <button
          type="button"
          className="dx-btn"
          data-act="recovery"
          onClick={missing("settings.recovery", "dx.notBuilt.recovery")}
        >
          {t("dx.settings.viewDrafts")}
        </button>
      </Row>
      <Row title={t("dx.settings.trash")} desc={t("dx.settings.trashDesc")}>
        <button type="button" className="dx-btn" data-act="trash" onClick={missing("settings.trash", "dx.notBuilt.trash")}>
          {t("dx.settings.viewTrash")}
        </button>
      </Row>
      <Row title={t("dx.settings.formats")} desc={t("dx.settings.formatsDesc")}>
        <button type="button" className="dx-btn" data-act="format-capabilities" onClick={() => openFormats(t)}>
          {t("dx.settings.viewCapabilities")}
        </button>
      </Row>
    </>
  );
}

/** What the workspace holds, counted from what it knows — not from the disk. */
function StorageButton({ location }: { location: string }) {
  const t = useT();
  const { files } = useShell();
  return (
    <button
      type="button"
      className="dx-btn"
      data-act="storage"
      onClick={() => {
        const generated = files.filter((file) => file.artifactTaskId).length;
        openModal({
            title: t("dx.settings.storageTitle"),
            render: () => (
              <dl className="dx-definition">
                <dt>{t("dx.settings.storageOriginal")}</dt>
                <dd>{t("dx.settings.storageOriginalValue", { count: files.length - generated })}</dd>
                <dt>{t("dx.settings.storageGenerated")}</dt>
                <dd>
                  {t("dx.settings.storageGeneratedValue", {
                    count: generated,
                    location: location || t("dx.settings.workspaceDefault"),
                  })}
                </dd>
              </dl>
            ),
        });
      }}
    >
      {t("dx.settings.manageStorage")}
    </button>
  );
}

/* ------------------------------------------------------------------- Models */

function Models({
  settings,
  update,
  signedIn,
  onOpenAccount,
  onAccount,
}: {
  settings: UserSettings;
  update: SettingsUpdate;
  signedIn: boolean;
  onOpenAccount: () => void;
  onAccount: () => void;
}) {
  const t = useT();
  const provider = settings.llmProvider;
  const custom = provider && provider.type !== "official" ? provider : null;

  // A provider of one's own is tied to an account; without one, say how to get there.
  const edit = () => {
    if (!signedIn) {
      openConfirmDialog({
        title: t("dx.settings.modelAddTitle"),
        body: <p>{t("dx.settings.modelSignIn")}</p>,
        action: t("dx.settings.signIn"),
        onConfirm: onOpenAccount,
      });
      return;
    }
    openModel(t, provider, (next) => update({ llmProvider: next }));
  };

  const useOfficial = (titleKey: string, bodyKey: string, actionKey: string) =>
    openConfirmDialog({
      title: t(titleKey),
      body: <p>{t(bodyKey)}</p>,
      action: t(actionKey),
      onConfirm: async () => void (await update({ llmProvider: null })),
    });

  const testOfficial = () =>
    // The official probe spends a real generation, so it asks first.
    openConfirmDialog({
      title: t("dx.settings.modelPaidTitle"),
      body: <p>{t("onboarding.provider.paidProbeBody")}</p>,
      action: t("dx.settings.modelPaidAction"),
      onConfirm: () => {
        // The confirmation closes itself; the test opens once it has.
        window.setTimeout(() => openModelTest(t, { name: t("dx.settings.modelOfficial"), official: true }), 0);
      },
    });

  return (
    <>
      <div className="dx-row dx-models-heading">
        <h2 className="dx-grow">{t("dx.settings.section.models")}</h2>
        <button type="button" className="dx-btn dx-primary" data-act="add-model" onClick={edit}>
          {t("dx.settings.addModel")}
        </button>
      </div>
      <article className="dx-model-card">
        <div className="dx-row">
          <h3 className="dx-grow">{t("dx.settings.modelOfficial")}</h3>
          <span className="dx-pill">{t("dx.settings.modelReady")}</span>
        </div>
        <p>
          {t("dx.settings.modelOfficialProvider")}
          {custom ? "" : t("dx.settings.modelCurrent")}
        </p>
        <div className="dx-actions">
          <button
            type="button"
            className="dx-btn"
            data-act="use-model"
            data-id="official"
            disabled={!custom}
            onClick={() =>
              useOfficial(
                "dx.settings.modelUseOfficialTitle",
                "dx.settings.modelUseOfficialBody",
                "dx.settings.modelUseOfficialAction",
              )
            }
          >
            {t(custom ? "dx.settings.modelUse" : "dx.settings.modelSelected")}
          </button>
          <button type="button" className="dx-btn" data-act="test-model" data-id="official" onClick={testOfficial}>
            {t("dx.settings.modelTest")}
          </button>
          <button type="button" className="dx-btn" data-act="settings" data-id="account" onClick={onAccount}>
            {t("dx.settings.modelAccount")}
          </button>
        </div>
      </article>
      {custom ? (
        <article className="dx-model-card">
          <div className="dx-row">
            <h3 className="dx-grow">{custom.model || t("dx.settings.modelCustomProvider")}</h3>
            <span className="dx-pill">{t("dx.settings.modelReady")}</span>
          </div>
          <p>
            {t("dx.settings.modelCustomProvider")}
            {t("dx.settings.modelCurrent")}
          </p>
          {custom.baseUrl ? <p className="dx-metadata">{custom.baseUrl}</p> : null}
          <div className="dx-actions">
            {/* One provider of one's own can be kept, and keeping it is using it. */}
            <button
              type="button"
              className="dx-btn"
              data-act="use-model"
              data-id="custom"
              disabled
              onClick={() => void update({ llmProvider: custom }).catch(() => undefined)}
            >
              {t("dx.settings.modelSelected")}
            </button>
            <button type="button" className="dx-btn" data-act="edit-model" data-id="custom" onClick={edit}>
              {t("dx.settings.modelEdit")}
            </button>
            <button
              type="button"
              className="dx-btn"
              data-act="test-model"
              data-id="custom"
              disabled={!signedIn}
              onClick={() =>
                openModelTest(t, {
                  name: custom.model || t("dx.settings.modelCustomProvider"),
                  official: false,
                  onEdit: edit,
                })
              }
            >
              {t("dx.settings.modelTest")}
            </button>
            <button
              type="button"
              className="dx-btn"
              data-act="toggle-model"
              data-id="custom"
              onClick={() =>
                useOfficial("dx.settings.modelRemoveTitle", "dx.settings.modelRemoveBody", "dx.settings.modelRemove")
              }
            >
              {t("dx.settings.modelRemove")}
            </button>
          </div>
        </article>
      ) : null}
      <p className="dx-muted">{t("dx.settings.modelNote")}</p>
    </>
  );
}

/* ------------------------------------------------ Connections & permissions */

function Permissions({ settings, update }: { settings: UserSettings; update: SettingsUpdate }) {
  const t = useT();
  const api = useDesktopApi();
  const [jira, setJira] = useState<JiraConnectionSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      api
        .getJiraConnection()
        .then((summary) => !cancelled && setJira(summary))
        .catch(() => !cancelled && setJira(null));
    void read();
    window.addEventListener(JIRA_CHANGED, read);
    return () => {
      cancelled = true;
      window.removeEventListener(JIRA_CHANGED, read);
    };
  }, [api]);

  const proxy = settings.proxy;
  return (
    <>
      <h2>{t("dx.settings.section.permissions")}</h2>
      <Row title={t("dx.settings.fileAccess")} desc={t("dx.settings.fileAccessDesc")}>
        <button type="button" className="dx-btn" data-act="permissions" onClick={() => openFileAccess(t)}>
          {t("dx.settings.reviewAccess")}
        </button>
      </Row>
      <Row
        title={t("dx.settings.jira")}
        desc={
          jira?.configured ? t("dx.settings.jiraConnected", { url: jira.baseUrl }) : t("dx.settings.jiraNotConnected")
        }
      >
        <button type="button" className="dx-btn" data-act="jira" onClick={() => openJira(t)}>
          {t(jira?.configured ? "dx.settings.jiraManage" : "dx.settings.jiraConnect")}
        </button>
      </Row>
      <Row title={t("dx.settings.proxy")} desc={proxy?.enabled && proxy.url ? proxy.url : t("dx.settings.proxySystem")}>
        <button
          type="button"
          className="dx-btn"
          data-act="proxy"
          onClick={() => openProxy(t, proxy, (next) => update({ proxy: next }))}
        >
          {t("dx.settings.configure")}
        </button>
      </Row>
      <Row title={t("dx.settings.external")} desc={t("dx.settings.externalDesc")}>
        <button type="button" className="dx-btn" data-act="external-policy" onClick={() => openExternalPolicy(t)}>
          {t("dx.settings.viewPolicy")}
        </button>
      </Row>
    </>
  );
}

/* ------------------------------------------------------------ Notifications */

function Notifications() {
  const t = useT();
  const api = useDesktopApi();
  // Not a saved preference: it lives beside the tasks that ring it, so it takes
  // effect without a round trip and outlives a reinstall of the interface.
  const [enabled, setEnabled] = useState(() => readNotificationsEnabled());

  const sendTest = async () => {
    try {
      if (!api.sendDesktopNotification) throw new Error(t("shell.misc.notificationsNeedRuntime"));
      await api.sendDesktopNotification({ title: t("notification.title"), body: t("settings.notifications.testBody") });
      notice(t("settings.notifications.testSuccess"));
    } catch (reason) {
      notice(t("settings.notifications.testError", { error: errorMessage(reason) }));
    }
  };

  return (
    <>
      <h2>{t("dx.settings.section.notifications")}</h2>
      <Row title={t("dx.settings.taskNotifications")} desc={t("dx.settings.taskNotificationsDesc")}>
        <Toggle
          id="notifications"
          label={t("dx.settings.taskNotifications")}
          checked={enabled}
          onChange={(checked) => {
            setEnabled(checked);
            persistNotificationsEnabled(checked);
          }}
        />
      </Row>
      <Row title={t("dx.settings.testNotification")} desc={t("dx.settings.testNotificationDesc")}>
        <button
          type="button"
          className="dx-btn"
          data-act="test-notification"
          disabled={!enabled}
          onClick={() => void sendTest()}
        >
          {t("dx.settings.showPreview")}
        </button>
      </Row>
      <Row title={t("dx.settings.sound")} desc={t("dx.settings.soundDesc")}>
        <Toggle
          id="sound"
          label={t("dx.settings.soundAria")}
          checked={false}
          onChange={() => notBuiltYet("settings.sound", t("dx.notBuilt.sound"))}
        />
      </Row>
      <Row title={t("dx.settings.quiet")} desc={t("dx.settings.quietDesc")}>
        <Toggle
          id="quietActive"
          label={t("dx.settings.quiet")}
          checked={false}
          onChange={() => notBuiltYet("settings.quietActive", t("dx.notBuilt.quiet"))}
        />
      </Row>
    </>
  );
}

/* ---------------------------------------------------------- Account & usage */

function Account({
  whoami,
  credit,
  onOpenAccount,
  onModels,
  onRedeemed,
}: {
  whoami: WhoAmIResult | null;
  credit: CreditStatus | null;
  onOpenAccount: () => void;
  onModels: () => void;
  onRedeemed: () => void;
}) {
  const t = useT();
  const api = useDesktopApi();
  const { state } = useShell();
  const signedIn = whoami?.mode === "logged_in";
  const name = signedIn ? whoami.email?.trim() || whoami.userId?.trim() || t("dx.account.signedIn") : null;
  const [invite, setInvite] = useState<InviteInfo | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setInvite(null);
      return;
    }
    let cancelled = false;
    api
      .getInviteInfo()
      .then((result) => !cancelled && setInvite(result))
      .catch(() => !cancelled && setInvite(null));
    return () => {
      cancelled = true;
    };
  }, [api, signedIn]);

  const balance = credit ? (credit.hostedCreditBalance ?? credit.anonymousCreditBalance) : null;
  const usage = credit
    ? [
        credit.planName ? t("dx.settings.usagePlan", { plan: credit.planName }) : "",
        balance === null ? "" : t("dx.settings.usageBalance", { balance }),
      ]
        .filter(Boolean)
        .join(" · ") || t("dx.settings.usageUnknown")
    : t("dx.settings.usageUnknown");

  const copyInvite = async () => {
    const code = invite?.invite_code?.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      notice(t("login.invite.copied"));
    } catch {
      notice(t("login.invite.copyFailed"));
    }
  };

  return (
    <>
      <h2>{t("dx.settings.section.account")}</h2>
      <div className="dx-profile-card">
        <img
          className="dx-profile-avatar"
          src={avatarUrl(state.avatar)}
          alt={t("dx.settings.avatarAlt", { name: t(`dx.settings.avatar.${state.avatar}`) })}
        />
        <div>
          <h3>{name ?? t("dx.account.guest")}</h3>
          <p className="dx-metadata">{t("dx.settings.yourAvatar")}</p>
          <button type="button" className="dx-btn" data-act="avatar-picker" onClick={() => openAvatarPicker(t)}>
            {t("dx.settings.change")}
          </button>
        </div>
      </div>
      <div className="dx-plan-card">
        <h3>{name ?? t("dx.settings.guestTitle")}</h3>
        <p>{t("dx.settings.accountKept")}</p>
        {/* Signing in and out are the account page's: one flow, not a second one here. */}
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act={signedIn ? "manage-account" : "sign-in"}
          onClick={onOpenAccount}
        >
          {t(signedIn ? "dx.settings.manageAccount" : "dx.settings.signIn")}
        </button>
      </div>
      <Row title={t("dx.settings.usage")} desc={usage}>
        <button type="button" className="dx-btn" data-act="usage" onClick={() => openUsage(t, credit, onModels)}>
          {t("dx.settings.usageDetails")}
        </button>
      </Row>
      <Row title={t("dx.settings.byo")} desc={t("dx.settings.byoDesc")}>
        <button type="button" className="dx-btn" data-act="settings" data-id="models" onClick={onModels}>
          {t("dx.settings.section.models")}
        </button>
      </Row>
      <Row title={t("dx.settings.redeem")} desc={t("dx.settings.redeemDesc")}>
        <button type="button" className="dx-btn" data-act="redeem" onClick={() => openRedeem(t, onRedeemed)}>
          {t("dx.settings.redeemAction")}
        </button>
      </Row>
      {signedIn ? (
        <Row title={t("dx.settings.invite")} desc={invite?.invite_code || t("login.invite.unavailable")}>
          <button
            type="button"
            className="dx-btn"
            data-act="copy-invite"
            disabled={!invite?.invite_code}
            onClick={() => void copyInvite()}
          >
            {t("dx.settings.inviteCopy")}
          </button>
        </Row>
      ) : null}
      <p className="dx-muted dx-settings-note">{t("dx.settings.accountNote")}</p>
    </>
  );
}

/* ------------------------------------------------------- Commercial license */

function License() {
  const t = useT();
  const api = useDesktopApi();
  return (
    <>
      <h2>{t("dx.settings.section.license")}</h2>
      <div className="dx-plan-card">
        <h3>{t("dx.settings.licenseHeading")}</h3>
        <p>{t("dx.settings.licenseBody")}</p>
        <p>
          {t("dx.settings.licenseStatus")}
          <strong>{t("dx.settings.licenseNone")}</strong>
        </p>
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="license-form"
          onClick={() => notBuiltYet("settings.license", t("dx.notBuilt.license"))}
        >
          {t("dx.settings.licenseRequest")}
        </button>
      </div>
      <p className="dx-muted dx-settings-note" data-gap="20">{t("dx.settings.licenseNote")}</p>
      <button
        type="button"
        className="dx-btn"
        data-act="terms"
        onClick={() => openTerms(t, () => void api.openExternal(LICENSE_URL).catch(() => undefined))}
      >
        {t("dx.settings.terms")}
      </button>
    </>
  );
}

/* ---------------------------------------------------------- About & support */

function About(props: {
  settings: UserSettings;
  credit: CreditStatus | null;
  save: (patch: Partial<UserSettings>) => void;
  update: SettingsUpdate;
  onModels: () => void;
}) {
  const shared = useShellAppUpdate();
  return shared ? <AboutBody {...props} appUpdate={shared} /> : <AboutWithOwnUpdater {...props} />;
}

function AboutWithOwnUpdater(props: Parameters<typeof About>[0]) {
  return <AboutBody {...props} appUpdate={useAppUpdate()} />;
}

function AboutBody({
  settings,
  credit,
  save,
  update,
  onModels,
  appUpdate,
}: Parameters<typeof About>[0] & { appUpdate: UseAppUpdateValue }) {
  const t = useT();
  const api = useDesktopApi();
  const { dispatch } = useShell();
  const composer = useComposerSettings();
  const [version, setVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .getAppVersion()
      .then((value) => !cancelled && setVersion(value))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  const { status, release, phase } = appUpdate;
  const ready = phase === "downloaded" || phase === "installing";
  const updates =
    release && ready
      ? t("dx.settings.updatesReady", { version: release.version })
      : release && status.updateAvailable
        ? t("dx.settings.updatesAvailable", { version: release.version })
        : status.lastCheckedAt && !status.lastError
          ? t("dx.settings.updatesCurrent")
          : t("dx.settings.updatesIdle");

  // A paid account reads its own preference; a free one always shows the mark.
  const paid = credit?.paidEntitlement === true;
  const watermark = settings.imageWatermark ?? { showWatermark: true, preferenceSource: "system" as const };
  const showWatermark = paid ? (watermark.preferenceSource === "user" ? watermark.showWatermark : false) : true;

  const open = (url: string) => void api.openExternal(url).catch(() => undefined);

  const reset = () =>
    openConfirmDialog({
      title: t("dx.settings.resetTitle"),
      body: <p>{t("dx.settings.resetBody")}</p>,
      action: t("dx.settings.resetAction"),
      onConfirm: async () => {
        await update({
          defaults: { documentType: "pptx", enableImages: true, enableWebSearch: false, imageQuality: "premium" },
          workspaceDir: null,
          outputDir: null,
          onboardingCompletedAt: null,
          imageWatermark: { showWatermark: true, preferenceSource: "system" },
        });
        await composer.patch({ reduceMotion: false, enterToSend: true });
        dispatch({ type: "reset-preferences" });
        notice(t("dx.settings.resetDone"));
      },
    });

  return (
    <>
      <h2>{t("dx.settings.section.about")}</h2>
      <div className="dx-row">
        <DexFace />
        <strong>{t("settings.about.productName")}</strong>
        <span className="dx-pill">{t("dx.settings.version", { version: version || status.currentVersion })}</span>
      </div>
      <Row title={t("dx.settings.updates")} desc={updates}>
        <button type="button" className="dx-btn" data-act="update-check" onClick={() => openUpdate(t)}>
          {t("dx.settings.checkUpdates")}
        </button>
      </Row>
      <Row title={t("dx.settings.activity")} desc={t("dx.settings.activityDesc")}>
        <button type="button" className="dx-btn" data-act="activity" onClick={() => openActivity(t)}>
          {t("dx.settings.activity")}
        </button>
      </Row>
      <Row title={t("dx.settings.help")} desc={t("dx.settings.helpDesc")}>
        <button type="button" className="dx-btn" data-act="help" onClick={() => openHelp(t, onModels)}>
          {t("dx.settings.helpCenter")}
        </button>
      </Row>
      <Row title={t("dx.settings.diagnostics")} desc={t("dx.settings.diagnosticsDesc")}>
        <button type="button" className="dx-btn" data-act="diagnostics" onClick={() => openDiagnostics(t)}>
          {t("dx.settings.prepareDiagnostics")}
        </button>
      </Row>
      <Row title={t("dx.settings.shortcuts")} desc={t("dx.settings.shortcutsAboutDesc")}>
        <button type="button" className="dx-btn" data-act="shortcuts" onClick={() => openShortcuts(t)}>
          {t("dx.settings.viewShortcuts")}
        </button>
      </Row>
      <Row title={t("dx.settings.privacy")} desc={t("settings.row.usageAnalytics.desc")}>
        <Toggle
          id="analytics"
          label={t("dx.settings.privacyAria")}
          // Opt-out: an install that has never answered reads as on.
          checked={settings.usageAnalyticsEnabled !== false}
          onChange={(checked) => save({ usageAnalyticsEnabled: checked })}
        />
      </Row>
      <Row
        title={t("dx.settings.watermark")}
        desc={t(paid ? "settings.row.imageWatermark.paidNotice" : "settings.row.imageWatermark.freeNotice")}
      >
        <Toggle
          id="watermark"
          label={t("dx.settings.watermark")}
          checked={showWatermark}
          disabled={!paid}
          onChange={(checked) =>
            save({ imageWatermark: { ...watermark, showWatermark: checked, preferenceSource: "user" } })
          }
        />
      </Row>
      <Row title={t("dx.settings.reset")} desc={t("dx.settings.resetDesc")}>
        <button type="button" className="dx-btn" data-act="reset-preferences" onClick={reset}>
          {t("dx.settings.resetAction")}
        </button>
      </Row>
      <p className="dx-muted dx-settings-note">
        {status.updateChannel ? `${t("dx.settings.channel", { channel: status.updateChannel })} · ` : ""}
        {t("settings.about.description")}
      </p>
      <div className="dx-actions" aria-label={t("dx.settings.links")}>
        <button type="button" className="dx-btn" onClick={() => open("https://officecli.io")}>
          {t("dx.settings.linkWebsite")}
        </button>
        <button type="button" className="dx-btn" onClick={() => open("https://github.com/officecli/officedex")}>
          {t("dx.settings.linkSource")}
        </button>
        <button type="button" className="dx-btn" onClick={() => open(LICENSE_URL)}>
          {t("dx.settings.linkLicense")}
        </button>
      </div>
    </>
  );
}

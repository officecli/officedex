import { useCallback, useState } from "react";
import { CircleAlert } from "lucide-react";

import { Button, Select, Switch, Tag, toast } from "../../renderer/ui";
import { useLocale, useSetLocale, useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { readNotificationsEnabled, setNotificationsEnabled as persistNotificationsEnabled } from "../../renderer/notifications";
import { errorMessage } from "../../renderer/utils/values";
import type { DocumentType, GenerateDefaults, UserSettings } from "../../shared/types";
import type { AgentTaskSummary } from "../../shared/uiPort";
import { statusLabel } from "../agent/PresenceFace";
import { useAgentTasks } from "../agent/useAgentTasks";
import { useComposerSettings } from "../composer/useComposerSettings";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";
import { SettingRow, SettingsSection, settingsSectionId } from "./SettingsPrimitives";

/**
 * Generation — the two defaults that decide what a quick run produces.
 *
 * Same controls and same copy as the legacy page's "generation" section, save
 * for the row that rendered `settings.row.imageQuality.*`: that key pair exists
 * in the dictionary and `defaults.imageQuality` is read and written by the
 * backend, but **no control in either renderer has ever rendered it** (audit S7
 * §3.3). Drawing a switch for it here would invent a setting rather than port
 * one, so it stays out and is written down instead.
 */
export function GenerationSection({
  settings,
  onDefaults,
}: {
  settings: UserSettings;
  onDefaults: (patch: Partial<GenerateDefaults>) => void;
}) {
  const t = useT();
  return (
    <SettingsSection id={settingsSectionId("generation")} title={t("settings.group.generation")}>
      <SettingRow title={t("settings.row.documentType.title")} desc={t("settings.row.documentType.desc")}>
        <Select
          ariaLabel={t("settings.row.documentType.title")}
          value={settings.defaults.documentType}
          onChange={(value: DocumentType) => onDefaults({ documentType: value })}
          options={[
            { value: "pptx", label: t("settings.option.docType.pptx") },
            { value: "docx", label: t("settings.option.docType.docx") },
            { value: "xlsx", label: t("settings.option.docType.xlsx") },
            { value: "report", label: t("settings.option.docType.report") },
            { value: "img", label: t("settings.option.docType.img") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("settings.row.enableImages.title")} desc={t("settings.row.enableImages.desc")}>
        <Switch
          ariaLabel={t("settings.row.enableImages.title")}
          checked={settings.defaults.enableImages}
          onChange={(checked) => onDefaults({ enableImages: checked })}
        />
      </SettingRow>
      <SettingRow title={t("settings.row.enableWebSearch.title")} desc={t("settings.row.enableWebSearch.desc")}>
        <Switch
          ariaLabel={t("settings.row.enableWebSearch.title")}
          checked={settings.defaults.enableWebSearch}
          onChange={(checked) => onDefaults({ enableWebSearch: checked })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/**
 * Notifications, and the one thing to know about them: the switch is **not** a
 * saved preference. It lives in `localStorage` (`notifications.ts`) because the
 * tasks that ring it are not the settings page's, so it takes effect without a
 * round trip to the backend and survives a reinstall of the UI. The legacy
 * page behaved the same way.
 */
export function NotificationsSection() {
  const t = useT();
  const api = useDesktopApi();
  const [enabled, setEnabled] = useState(() => readNotificationsEnabled());

  const onChange = useCallback((checked: boolean) => {
    setEnabled(checked);
    persistNotificationsEnabled(checked);
  }, []);

  const sendTest = useCallback(async () => {
    try {
      if (!api.sendDesktopNotification) {
        throw new Error(t("shell.misc.notificationsNeedRuntime"));
      }
      await api.sendDesktopNotification({
        title: t("notification.title"),
        body: t("settings.notifications.testBody"),
      });
      void toast.success(t("settings.notifications.testSuccess"));
    } catch (error) {
      void toast.error(t("settings.notifications.testError", { error: errorMessage(error) }));
    }
  }, [api, t]);

  return (
    <SettingsSection id={settingsSectionId("notifications")} title={t("settings.group.notifications")}>
      <SettingRow title={t("settings.notifications.label")} desc={t("settings.notifications.desc")}>
        <Switch
          ariaLabel={t("settings.notifications.label")}
          checked={enabled}
          onChange={onChange}
        />
      </SettingRow>
      <SettingRow title={t("settings.notifications.testTitle")} desc={t("settings.notifications.testDesc")}>
        <Button onClick={() => void sendTest()} disabled={!enabled}>
          {t("settings.notifications.testButton")}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

/**
 * Appearance.
 *
 * Language is the legacy page's, unchanged. The other two rows are what the
 * shell's sidebar menu used to hold and are **not** legacy settings: they are
 * the shell's own preferences behind `useComposerSettings()`, which the port
 * stores per workspace. They come here because the gear now opens this page
 * instead of a three-row dropdown, and a preference the user was just shown
 * must not disappear in the move.
 *
 * `useComposerSettings` is the shared store, so switching Reduced motion here
 * is on screen in `Highlights`, `Hero` and `AttentionBorder` before the next
 * frame — the audit's S7-002/S7-003 were exactly what happened when it was not.
 */
export function AppearanceSection() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const settings = useComposerSettings();

  return (
    <SettingsSection id={settingsSectionId("appearance")} title={t("settings.group.appearance")}>
      <SettingRow title={t("settings.row.language.title")} desc={t("settings.row.language.desc")}>
        <Select
          ariaLabel={t("settings.row.language.title")}
          value={locale}
          onChange={(value: string) => setLocale(value === "zh" ? "zh" : "en")}
          options={[
            { value: "zh", label: t("settings.option.language.zh") },
            { value: "en", label: t("settings.option.language.en") },
          ]}
        />
      </SettingRow>
      <SettingRow title={t("shell.sidebar.reducedMotion")} desc={t("shell.sidebar.motionDescription")}>
        <Switch
          ariaLabel={t("shell.sidebar.reducedMotion")}
          checked={settings.value.reduceMotion}
          onChange={(checked) => void settings.patch({ reduceMotion: checked })}
        />
      </SettingRow>
      <SettingRow title={t("shell.sidebar.enterSends")} desc={t("shell.sidebar.enterDescription")}>
        <Switch
          ariaLabel={t("shell.sidebar.enterSends")}
          checked={settings.value.enterToSend}
          onChange={(checked) => void settings.patch({ enterToSend: checked })}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/**
 * Activity — what the shell has run.
 *
 * The legacy page did not own this list; it took it as an `activity` prop from
 * the legacy App, fed by the legacy task store and routing. The shell has no
 * such store, so the port's own run list is the honest source: `useAgentTasks`
 * reads every folder's recent runs and stays live off the event stream.
 *
 * A row goes where the run went — the same destination rule `home/TaskList.tsx`
 * uses, because a run names a folder and no file, and revealing the folder is
 * better than a click that vanishes.
 */
export function ActivitySection() {
  const t = useT();
  const { tasks } = useAgentTasks(20);
  const { files, dispatch } = useShell();
  const actions = useLibraryActions();

  const openTask = (task: AgentTaskSummary) => {
    const target = files
      .filter((file) => file.folderId === task.folderId)
      .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))[0];
    if (target) {
      void actions.openFile(target.id);
      return;
    }
    dispatch({ type: "reveal-folder", folderId: task.folderId });
    dispatch({ type: "select-folder", folderId: task.folderId });
  };

  return (
    <SettingsSection id={settingsSectionId("activity")} title={t("settings.group.activity")}>
      <p className="shell-settings-activity-hint">{t("settings.activity.hint")}</p>
      {tasks.length === 0 ? (
        <p className="shell-settings-activity-empty">{t("settings.activity.empty")}</p>
      ) : (
        tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className="shell-settings-activity-item"
            onClick={() => openTask(task)}
          >
            <span className="shell-settings-activity-copy">
              <span className="shell-settings-activity-title">{task.title}</span>
              <span className="shell-settings-activity-phase">{task.phase}</span>
            </span>
            <Tag tone="neutral">{statusLabel(task.status)}</Tag>
          </button>
        ))
      )}
    </SettingsSection>
  );
}

/**
 * Reset, as the one destructive control the page owns. The confirmation is the
 * shared `Modal.confirm` — the shell has no dialog of its own, and `Modal`
 * portals into `#shell` through `renderer/ui/overlayHost.ts`, so it lands above
 * this page and keeps the shell's token bridge (S7-006 is what happens
 * otherwise).
 */
export function ResetSection({ onReset }: { onReset: () => void }) {
  const t = useT();
  return (
    <SettingsSection id={settingsSectionId("reset")} title={t("settings.group.reset")} variant="danger">
      <SettingRow title={t("settings.row.reset.title")} desc={t("settings.row.reset.desc")}>
        <Button danger onClick={onReset}>
          {t("settings.row.reset.button")}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}

/** The error banner the page shows when a save or a read failed. */
export function SettingsError({ message }: { message: string }) {
  return (
    <div className="shell-settings-status" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

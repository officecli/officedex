import { Button, Switch } from "../../renderer/ui";
import { useT } from "../../renderer/i18n";
import type { CreditStatus, UserSettings, WhoAmIResult } from "../../shared/types";
import { SettingRow, SettingsBlock, SettingsSection, settingsSectionId } from "./SettingsPrimitives";
import { DiagnosticsControl, ProviderControl, ProxyControl, RuntimeRunsControl } from "./AdvancedControls";

/**
 * "Advanced & Support" — the section the audit listed as the largest single
 * loss: the watermark switch, the LLM provider (with its connection test), the
 * network proxy, diagnostics, the runtime debug table and the onboarding
 * re-run, 31 items in all (S7 §3, items 54–84), none of them reachable.
 *
 * The watermark switch keeps the legacy entitlement rule exactly, because it is
 * the rule that decides whether a paying user can turn the watermark *off*:
 * a paid account reads its own stored preference, a free account reads `true`
 * regardless of what is stored, and the switch is disabled with a sentence
 * saying which of the two it is.
 */
export function AdvancedSection({
  settings,
  update,
  creditStatus,
  whoami,
  onOpenLogin,
  onRerunOnboarding,
}: {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => Promise<UserSettings>;
  creditStatus: CreditStatus | null;
  whoami: WhoAmIResult | null;
  onOpenLogin?: () => void;
  onRerunOnboarding: () => void;
}) {
  const t = useT();
  const hasPaidEntitlement = creditStatus?.paidEntitlement === true;
  const watermark = settings.imageWatermark ?? { showWatermark: true, preferenceSource: "system" as const };
  const showWatermark = hasPaidEntitlement
    ? watermark.preferenceSource === "user"
      ? watermark.showWatermark
      : false
    : true;

  return (
    <SettingsSection id={settingsSectionId("advanced")} title={t("settings.group.advanced")}>
      <SettingRow
        title={t("settings.row.imageWatermark.title")}
        desc={t("settings.row.imageWatermark.desc")}
      >
        <div className="shell-settings-actions">
          <div className="shell-settings-toggle">
            <Switch
              ariaLabel={t("settings.row.imageWatermark.showLabel")}
              checked={showWatermark}
              disabled={!hasPaidEntitlement}
              onChange={(checked) =>
                void update({
                  imageWatermark: { ...watermark, showWatermark: checked, preferenceSource: "user" },
                }).catch(() => undefined)
              }
            />
            <span>{t("settings.row.imageWatermark.showLabel")}</span>
          </div>
          <span className="shell-settings-note">
            {hasPaidEntitlement
              ? t("settings.row.imageWatermark.paidNotice")
              : t("settings.row.imageWatermark.freeNotice")}
          </span>
        </div>
      </SettingRow>
      <SettingRow variant="form" title={t("settings.row.provider.title")} desc={t("settings.row.provider.desc")}>
        <ProviderControl
          remote={settings.llmProvider}
          onSave={(next) => void update({ llmProvider: next }).catch(() => undefined)}
          clearLabel={t("settings.row.provider.clear")}
          customProviderEnabled={whoami === null || whoami.mode === "logged_in"}
          onOpenLogin={onOpenLogin}
        />
      </SettingRow>
      <SettingRow variant="form" title={t("settings.row.proxy.title")} desc={t("settings.row.proxy.desc")}>
        <ProxyControl remote={settings.proxy} onSave={(next) => update({ proxy: next })} />
      </SettingRow>
      <SettingsBlock title={t("diagnostics.title")}>
        <p className="shell-settings-note">{t("diagnostics.description")}</p>
        <DiagnosticsControl />
      </SettingsBlock>
      <SettingsBlock title={t("tasks.runtime.title")}>
        <RuntimeRunsControl />
      </SettingsBlock>
      <SettingRow title={t("settings.row.onboarding.title")} desc={t("settings.row.onboarding.desc")}>
        <Button onClick={onRerunOnboarding}>{t("settings.row.onboarding.button")}</Button>
      </SettingRow>
    </SettingsSection>
  );
}

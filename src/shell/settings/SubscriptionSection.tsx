import { useCallback, useState } from "react";
import { Copy } from "lucide-react";

import { Button, toast } from "../../renderer/ui";
import { ImeInput } from "../../renderer/components/ImeInput";
import { useT } from "../../renderer/i18n";
import { useDesktopApi } from "../../renderer/services/desktopApi";
import { errorMessage } from "../../renderer/utils/values";
import type { InviteInfo, WhoAmIResult } from "../../shared/types";
import { SettingRow, SettingsSection, settingsSectionId } from "./SettingsPrimitives";

/**
 * Subscription — the redeem code and the invite code.
 *
 * Two settings that were not preferences but entitlements, and both were gone:
 * the audit's item 47–50 ("用户无法充值") and 51–52. The redeem call and the
 * invite read are the legacy ones, including the detail that the code input is
 * upper-cased as it is typed and that Enter submits — a promo code is read off
 * a card by a human, and lower case is the commonest way one arrives wrong.
 *
 * The invite row is drawn only for a signed-in account. `whoami` is the
 * authority on that, and it is asked once by the page and handed down rather
 * than asked again here: every `whoami` is a subprocess, and two answers to one
 * question can only disagree.
 */
export function SubscriptionSection({
  whoami,
  inviteInfo,
  inviteError,
  inviteLoading,
  onCreditRefresh,
}: {
  whoami: WhoAmIResult | null;
  inviteInfo: InviteInfo | null;
  inviteError: string | null;
  inviteLoading: boolean;
  onCreditRefresh?: () => void;
}) {
  const t = useT();
  const api = useDesktopApi();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<{ code: string; amount: number; balance: number } | null>(null);

  const submit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      void toast.error(t("settings.redeem.empty"));
      return;
    }
    setBusy(true);
    try {
      const result = await api.redeem(trimmed);
      setLastSuccess({ code: result.code, amount: result.credit_amount, balance: result.new_balance });
      setCode("");
      void toast.success(t("settings.redeem.success", { amount: result.credit_amount }));
      onCreditRefresh?.();
    } catch (error) {
      void toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [api, code, onCreditRefresh, t]);

  const copyInviteCode = useCallback(async () => {
    const value = inviteInfo?.invite_code?.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      void toast.success(t("login.invite.copied"));
    } catch {
      void toast.error(t("login.invite.copyFailed"));
    }
  }, [inviteInfo, t]);

  return (
    <SettingsSection id={settingsSectionId("subscription")} title={t("settings.group.subscription")}>
      <SettingRow title={t("settings.row.redeem.title")} desc={t("settings.row.redeem.desc")}>
        <div className="shell-settings-actions" data-grow="true">
          <ImeInput
            aria-label={t("settings.row.redeem.title")}
            value={code}
            onValueChange={(value) => setCode(value.toUpperCase())}
            onPressEnter={() => void submit()}
            placeholder={t("settings.redeem.placeholder")}
            maxLength={64}
            autoComplete="off"
            disabled={busy}
          />
          <Button type="primary" loading={busy} onClick={() => void submit()}>
            {t("settings.redeem.submit")}
          </Button>
          {lastSuccess ? (
            <span className="shell-settings-note" data-tone="done">
              {t("settings.redeem.successRecord", {
                code: lastSuccess.code,
                amount: lastSuccess.amount,
                balance: lastSuccess.balance,
              })}
            </span>
          ) : null}
        </div>
      </SettingRow>
      {whoami?.mode === "logged_in" ? (
        <SettingRow title={t("login.invite.title")} desc={t("settings.row.invite.desc")}>
          <div className="shell-settings-code">
            <span className="shell-settings-code-text" title={inviteInfo?.invite_code || inviteError || ""}>
              {inviteLoading
                ? t("login.invite.loading")
                : inviteError
                  ? inviteError
                  : inviteInfo?.invite_code || t("login.invite.unavailable")}
            </span>
            <Button
              size="small"
              icon={<Copy size={13} />}
              ariaLabel={t("login.invite.copy")}
              disabled={!inviteInfo?.invite_code}
              onClick={() => void copyInviteCode()}
            >
              {t("login.url.copy")}
            </Button>
          </div>
        </SettingRow>
      ) : null}
    </SettingsSection>
  );
}

import { Button, Space, toast as message } from "../../ui";
import { useCallback, useState } from "react";
import { type CreditInfo } from "../../components/Shell";
import { officecli } from "../../bridge";
import { useT } from "../../i18n";
import { ImeInput } from "../../components/ImeInput";
import { errorMessage } from "../../utils/values";



export function RedeemCodeCard({ onCreditRefresh }: { onCreditRefresh?: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<{ code: string; amount: number; balance: number } | null>(null);
  const t = useT();

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      void message.error(t("settings.redeem.empty"));
      return;
    }
    setBusy(true);
    try {
      const result = await officecli.redeem(trimmed);
      setLastSuccess({ code: result.code, amount: result.credit_amount, balance: result.new_balance });
      setCode("");
      void message.success(t("settings.redeem.success", { amount: result.credit_amount }));
      onCreditRefresh?.();
    } catch (error) {
      void message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [code, t, onCreditRefresh]);

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Space.Compact style={{ width: "100%", display: "flex" }}>
        <ImeInput
          style={{ flex: 1 }}
          value={code}
          onValueChange={(value) => setCode(value.toUpperCase())}
          onPressEnter={handleSubmit}
          placeholder={t("settings.redeem.placeholder")}
          maxLength={64}
          autoComplete="off"
          disabled={busy}
        />
        <Button type="primary" loading={busy} onClick={handleSubmit}>{t("settings.redeem.submit")}</Button>
      </Space.Compact>
      {lastSuccess ? (
        <div style={{ fontSize: 12, color: "#388E3C" }}>
          {t("settings.redeem.successRecord", { code: lastSuccess.code, amount: lastSuccess.amount, balance: lastSuccess.balance })}
        </div>
      ) : null}
    </Space>
  );
}

export function formatCreditValue(credit: CreditInfo): string {
  if (credit.displayMode === "balance") return String(Math.max(0, credit.total));
  return `${Math.max(0, credit.total - credit.used)} / ${credit.total}`;
}

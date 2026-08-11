import { ArrowLeft, RefreshCw } from "lucide-react";
import type { PreviewGrant } from "../../shared/types";
import { Button } from "../ui";
import { useT } from "../i18n";
import type { PublishedWorkbookApp } from "./types";
import { useWorkbookDataSource } from "./useWorkbookDataSource";
import { WorkbookAppPreview } from "./WorkbookAppPreview";

export function PublishedWorkbookAppPage({ app, grant, sourceRevision = 0, onBack }: { app: PublishedWorkbookApp; grant: PreviewGrant; sourceRevision?: number; onBack: () => void }) {
  const t = useT();
  const { snapshot, loading, error, refresh } = useWorkbookDataSource(grant.token, sourceRevision);
  const sheet = snapshot?.sheets.find((item) => item.name === app.config.sheetName) ?? snapshot?.sheets[0];
  return (
    <section className="published-workbook-app">
      <header><Button variant="ghost-normal" size="small" icon={<ArrowLeft />} onClick={onBack}>{t("appBuilder.appPage.back")}</Button><div><strong>{app.config.name}</strong><span>app.officedex.local/{app.config.slug}</span></div><Button size="small" icon={<RefreshCw />} loading={loading} onClick={() => void refresh()}>{t("appBuilder.refresh")}</Button></header>
      <main>{error ? <div className="published-workbook-app__error" role="alert">{error}</div> : null}{sheet ? <WorkbookAppPreview config={app.config} sheet={sheet} live lastSyncedAt={snapshot?.loadedAt} /> : loading ? <div className="app-builder__state">{t("appBuilder.loading")}</div> : null}</main>
    </section>
  );
}


import { useMemo, useState, type ComponentType } from "react";
import type { DocumentType, RecentFile } from "../../shared/types";
import { Button, Empty, Loading } from "../ui";
import {
  FileImageOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  LineChartOutlined,
  TableOutlined,
  DeleteOutlined,
} from "../ui/icons";
import { useT } from "../i18n";

type HomeDocumentType = Exclude<DocumentType, "gif">;
type SourceFilter = "all" | RecentFile["source"];

export interface HomeScreenProps {
  files: RecentFile[];
  loading: boolean;
  error?: string;
  activeWorkspaceId?: string;
  onCreate: (documentType: HomeDocumentType) => void;
  onOpenFile: (file: RecentFile) => void;
  onRemoveFile: (filePath: string) => void;
  onOpenLocalFile: () => void;
}

interface CreationEntry {
  type: HomeDocumentType;
  labelKey: string;
  descriptionKey: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const CREATION_ENTRIES: CreationEntry[] = [
  { type: "pptx", labelKey: "home.create.presentation", descriptionKey: "home.create.presentationDescription", icon: FundProjectionScreenOutlined },
  { type: "docx", labelKey: "home.create.document", descriptionKey: "home.create.documentDescription", icon: FileTextOutlined },
  { type: "xlsx", labelKey: "home.create.spreadsheet", descriptionKey: "home.create.spreadsheetDescription", icon: TableOutlined },
  { type: "report", labelKey: "home.create.report", descriptionKey: "home.create.reportDescription", icon: LineChartOutlined },
  { type: "img", labelKey: "home.create.image", descriptionKey: "home.create.imageDescription", icon: FileImageOutlined },
];

export function HomeScreen({ files, loading, error, activeWorkspaceId, onCreate, onOpenFile, onRemoveFile, onOpenLocalFile }: HomeScreenProps) {
  const t = useT();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const visibleFiles = useMemo(() => [...files]
    .filter((file) => !activeWorkspaceId || file.workspaceId === activeWorkspaceId)
    .filter((file) => sourceFilter === "all" || file.source === sourceFilter)
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt)), [activeWorkspaceId, files, sourceFilter]);

  return (
    <section className="home-screen" aria-labelledby="home-title">
      <header className="home-hero">
        <div>
          <p className="home-eyebrow">{t("home.eyebrow")}</p>
          <h1 id="home-title">{t("home.title")}</h1>
          <p>{t("home.subtitle")}</p>
        </div>
        <Button variant="outline" icon={<FolderOpenOutlined />} onClick={onOpenLocalFile}>{t("home.openLocalFile")}</Button>
      </header>

      <section className="home-create" aria-labelledby="home-create-title">
        <h2 id="home-create-title">{t("home.createTitle")}</h2>
        <div className="home-create-grid">
          {CREATION_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            const label = t(entry.labelKey);
            return (
              <button className="home-create-card" type="button" key={entry.type} aria-label={label} onClick={() => onCreate(entry.type)}>
                <span className="home-create-card__icon"><Icon aria-hidden /></span>
                <span className="home-create-card__copy"><strong>{label}</strong><small>{t(entry.descriptionKey)}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="home-recents" aria-labelledby="home-recents-title">
        <div className="home-recents-header">
          <h2 id="home-recents-title">{t("home.recentTitle")}</h2>
          <div className="home-source-tabs" role="tablist" aria-label={t("home.recentFilters")}> 
            {(["all", "generated", "local"] as const).map((filter) => (
              <button
                type="button"
                role="tab"
                aria-selected={sourceFilter === filter}
                className={sourceFilter === filter ? "is-active" : ""}
                key={filter}
                onClick={() => setSourceFilter(filter)}
              >
                {t(`home.filter.${filter}`)}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="home-recents-state"><Loading /><span>{t("home.loading")}</span></div> : null}
        {!loading && error ? <div className="home-recents-state home-recents-state--error" role="alert">{error}</div> : null}
        {!loading && !error && visibleFiles.length === 0 ? <Empty description={t("home.empty")} /> : null}
        {!loading && !error && visibleFiles.length > 0 ? (
          <div className="home-file-table" role="table" aria-label={t("home.recentTitle")}>
            <div className="home-file-row home-file-row--header" role="row">
              <span role="columnheader">{t("home.column.name")}</span>
              <span role="columnheader">{t("home.column.type")}</span>
              <span role="columnheader">{t("home.column.source")}</span>
              <span role="columnheader">{t("home.column.opened")}</span>
              <span aria-hidden="true" />
            </div>
            {visibleFiles.map((file) => (
              <div className="home-file-row" role="row" key={file.filePath}>
                <button type="button" className="home-file-name" aria-label={t("home.openFile", { name: file.fileName })} onClick={() => onOpenFile(file)}>
                  <span className="home-file-icon"><FileTextOutlined aria-hidden /></span>
                  <span>{file.fileName}</span>
                </button>
                <span role="cell" className="home-file-type">{file.documentType.toUpperCase()}</span>
                <span role="cell">{t(`home.source.${file.source}`)}</span>
                <time role="cell" dateTime={file.lastOpenedAt}>{formatOpenedAt(file.lastOpenedAt)}</time>
                <button type="button" className="home-file-remove" aria-label={t("home.removeFile", { name: file.fileName })} onClick={() => onRemoveFile(file.filePath)}>
                  <DeleteOutlined aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}

function formatOpenedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

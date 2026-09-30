import { useMemo, useState, type KeyboardEvent } from "react";

import { useT } from "../../renderer/i18n";
import { useFileActions } from "../chrome/useFileActions";
import { formatDateTime, formatSize } from "../kit/format";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { useLibraryActions } from "../nav/useLibraryActions";
import { logShellEvent } from "../port/shellLog";
import type { FileMeta, Folder } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { recentFiles } from "./fileRows";
import { OfflineBanner } from "./OfflineBanner";

/** Local's Recent is five cards (WORKSPACE-STANDARD §04); Home's is eight rows. */
const RECENT_LIMIT = 5;

type Sort = "modified" | "name" | "size";
type Layout = "list" | "grid";

type Row =
  | { kind: "folder"; id: string; name: string; modifiedAt: number; folder: Folder }
  | { kind: "file"; id: string; name: string; modifiedAt: number; file: FileMeta };

/**
 * Local — WORKSPACE-STANDARD §04.
 *
 *   Search files and folders
 *   Local                                  [Open]
 *   Recent        five cards, by last opened
 *   My Files      folders first, then files
 *
 * The file-first way in: no conversation beside it, no New, no All / Local
 * switch, nothing about cloud storage. Everything opens as Local. Search
 * filters My Files by name as you type and leaves Recent alone — that is an
 * access record, not a search result.
 *
 * Nothing here scans the disk. My Files lists the folders and files the
 * workspace already knows about; Open is how a file it does not know is added,
 * and only the file the user picked.
 */
export function LocalPage() {
  const t = useT();
  const { files, folders } = useShell();
  const library = useLibraryActions();
  const fileActions = useFileActions();
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("modified");
  const [layout, setLayout] = useState<Layout>("list");

  const recent = useMemo(() => recentFiles(files, RECENT_LIMIT), [files]);
  const openFolder = folders.find((folder) => folder.id === folderId) ?? null;

  const rows = useMemo<Row[]>(() => {
    const needle = query.toLowerCase().trim();
    // The root lists every file the workspace knows, under its folders; a
    // folder lists its own.
    const inScope = openFolder ? files.filter((file) => file.folderId === openFolder.id) : files;
    const all: Row[] = [
      ...(openFolder
        ? []
        : folders
            .filter((folder) => !folder.isDefault)
            .map((folder): Row => ({
              kind: "folder",
              id: folder.id,
              name: folder.name,
              modifiedAt: Math.max(0, ...files.filter((file) => file.folderId === folder.id).map((file) => file.updatedAt)),
              folder,
            }))),
      ...inScope.map((file): Row => ({ kind: "file", id: file.id, name: file.name, modifiedAt: file.updatedAt, file })),
    ].filter((row) => !needle || row.name.toLowerCase().includes(needle));
    return all.sort(
      (a, b) =>
        Number(b.kind === "folder") - Number(a.kind === "folder") ||
        // Sizes are not known to the workspace, so "Size" falls through to name.
        (sort === "modified" ? b.modifiedAt - a.modifiedAt : 0) ||
        a.name.localeCompare(b.name),
    );
  }, [files, folders, openFolder, query, sort]);

  const enterFolder = (id: string | null) => {
    setFolderId(id);
    setQuery("");
    logShellEvent("local_folder_opened", { type: id ? "folder" : "root" });
  };

  const activate = (row: Row) => {
    if (row.kind === "folder") enterFolder(row.id);
    else void library.openLocalFile(row.id);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(row);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const all = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".dx-local-open-row") ?? [])];
      const index = all.indexOf(event.currentTarget);
      all[Math.max(0, Math.min(all.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  const itemName = (row: Row) => (
    <span className="dx-local-file-name">
      {row.kind === "folder" ? <Icon name="Folder" size={24} /> : <FileIcon ext={extensionOf(row.file)} size={20} />}
      <span className="dx-ellipsis">{row.name}</span>
    </span>
  );

  const more = (row: Row) =>
    row.kind === "file" ? (
      <button
        type="button"
        className="dx-ib"
        aria-label={t("dx.file.optionsFor", { name: row.name })}
        title={t("dx.file.optionsFor", { name: row.name })}
        data-act="file-menu"
        data-id={row.id}
        onClick={(event) =>
          fileActions.fileMenu(row.file, event.currentTarget, { open: () => void library.openLocalFile(row.id) })
        }
      >
        <Icon name="MoreHorizontal" />
      </button>
    ) : null;

  const results =
    rows.length === 0 ? (
      <div className="dx-empty">
        <h2>{t(query ? "dx.local.noMatch" : "dx.local.folderEmpty")}</h2>
        <p>{t(query ? "dx.local.noMatchHint" : "dx.local.folderEmptyHint")}</p>
        {query ? (
          <button type="button" className="dx-btn" data-act="local-clear" onClick={() => setQuery("")}>
            {t("dx.local.clearSearch")}
          </button>
        ) : (
          <button type="button" className="dx-btn" data-act="open-picker" onClick={() => void library.openFromDisk()}>
            {t("dx.action.open")}
          </button>
        )}
      </div>
    ) : layout === "grid" ? (
      <div className="dx-local-file-grid">
        {rows.map((row) => (
          <article key={row.id} className="dx-local-file-card">
            <button
              type="button"
              data-act={row.kind === "folder" ? "local-folder" : "open-local"}
              data-id={row.id}
              aria-label={t("dx.file.openAria", { name: row.name })}
              onClick={() => activate(row)}
            >
              <span className="dx-local-card-preview">
                {row.kind === "folder" ? <Icon name="Folder" size={48} /> : <FileIcon ext={extensionOf(row.file)} size={48} />}
              </span>
              {itemName(row)}
            </button>
            {more(row)}
          </article>
        ))}
      </div>
    ) : (
      <div className="dx-table-wrap">
        <table aria-label={t("dx.local.myFiles")}>
          <thead>
            <tr>
              <th>{t("dx.column.name")}</th>
              <th>{t("dx.column.size")}</th>
              <th aria-sort={sort === "modified" ? "descending" : undefined}>
                {t("dx.column.modified")}
                {sort === "modified" ? " ↓" : ""}
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="dx-file-row dx-local-open-row"
                tabIndex={0}
                data-act={row.kind === "folder" ? "local-folder" : "open-local"}
                data-id={row.id}
                aria-label={t("dx.file.openAria", { name: row.name })}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button,input,a,label,select,textarea")) return;
                  activate(row);
                }}
                onKeyDown={(event) => onRowKeyDown(event, row)}
              >
                <td>{itemName(row)}</td>
                <td className="dx-metadata">{formatSize(undefined)}</td>
                <td className="dx-metadata">{row.modifiedAt ? formatDateTime(row.modifiedAt) : "—"}</td>
                <td>{more(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <section className="dx-page-scroll dx-local-page" data-ui-scope="officedex">
      <div className="dx-search dx-local-search">
        <Icon name="Search" />
        <input
          type="search"
          data-local-search
          aria-label={t("dx.local.search")}
          placeholder={t("dx.local.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <header className="dx-page-header">
        <h1>{t("dx.nav.local")}</h1>
        <button type="button" className="dx-btn" data-act="open-picker" onClick={() => void library.openFromDisk()}>
          <Icon name="FolderOpen" />
          {t("dx.action.open")}
        </button>
      </header>
      <OfflineBanner />

      <section className="dx-local-recent" aria-label={t("dx.home.recent")}>
        <h2>{t("dx.home.recent")}</h2>
        <div className="dx-local-recent-cards">
          {recent.length > 0 ? (
            recent.map((file) => (
              <button
                key={file.id}
                type="button"
                className="dx-local-recent-card"
                data-act="open-local"
                data-id={file.id}
                title={file.name}
                onClick={() => void library.openLocalFile(file.id)}
              >
                <span className="dx-local-card-preview">
                  <FileIcon ext={extensionOf(file)} size={48} />
                </span>
                <span className="dx-local-card-label dx-ellipsis">{file.name}</span>
                <span className="dx-metadata">{formatDateTime(file.lastOpenedAt)}</span>
              </button>
            ))
          ) : (
            <p className="dx-muted">{t("dx.local.recentEmpty")}</p>
          )}
        </div>
      </section>

      <section className="dx-local-files">
        <div className="dx-local-files-heading">
          <div className="dx-local-breadcrumb">
            {openFolder ? (
              <>
                <button type="button" data-act="local-folder" data-id="" onClick={() => enterFolder(null)}>
                  {t("dx.local.myFiles")}
                </button>
                <Icon name="ChevronRight" size={14} />
                <h2>{openFolder.name}</h2>
              </>
            ) : (
              <h2>{t("dx.local.myFiles")}</h2>
            )}
          </div>
          <div className="dx-actions">
            <label className="dx-local-sort">
              <span>{t("dx.local.sortBy")}</span>
              <select
                data-local-sort
                aria-label={t("dx.local.sortAria")}
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                <option value="modified">{t("dx.local.sortModified")}</option>
                <option value="name">{t("dx.column.name")}</option>
                <option value="size">{t("dx.local.sortSize")}</option>
              </select>
            </label>
            <div className="dx-local-view-switch">
              {(["list", "grid"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="dx-ib"
                  aria-label={t(value === "list" ? "dx.view.list" : "dx.view.grid")}
                  title={t(value === "list" ? "dx.view.list" : "dx.view.grid")}
                  data-act="local-layout"
                  data-id={value}
                  aria-pressed={layout === value}
                  onClick={() => {
                    setLayout(value);
                    logShellEvent("local_view_changed", { type: value });
                  }}
                >
                  <Icon name={value === "list" ? "List" : "Table2"} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div id="dx-local-results">{results}</div>
      </section>
    </section>
  );
}

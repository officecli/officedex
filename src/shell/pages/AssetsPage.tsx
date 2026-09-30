import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { useT } from "../../renderer/i18n";
import { useAgent } from "../agent/AgentContext";
import { useFileActions, type FileStatus } from "../chrome/useFileActions";
import { formatDateTime } from "../kit/format";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { useLibraryActions } from "../nav/useLibraryActions";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { filesTouchedBy } from "./fileRows";
import { OfflineBanner } from "./OfflineBanner";

type Format = "all" | "office" | "text" | "pdf" | "images";
type StatusFilter = "all" | "review" | "working" | "saved" | "attention";

const TEXT_EXTENSIONS = ["txt", "md", "rtf", "html"];
const OFFICE_EXTENSIONS = ["docx", "xlsx", "pptx", "doc", "xls", "ppt"];

function matchesFormat(file: FileMeta, format: Format): boolean {
  const ext = extensionOf(file);
  switch (format) {
    case "all":
      return true;
    case "office":
      return OFFICE_EXTENSIONS.includes(ext);
    case "text":
      return TEXT_EXTENSIONS.includes(ext);
    case "pdf":
      return ext === "pdf";
    case "images":
      return file.type === "image";
  }
}
type Sort = "updated" | "opened" | "name";

const STATUS_KEY: Record<FileStatus, string> = {
  saved: "dx.status.saved",
  unsaved: "dx.status.unsavedChanges",
  working: "dx.status.working",
  review: "dx.status.review",
};

/** The files a project's library holds: everything in its folder. */
export function useProjectAssets(): FileMeta[] {
  const { state, files } = useShell();
  const folderId = state.chat?.folderId;
  return useMemo(() => (folderId ? files.filter((file) => file.folderId === folderId) : []), [files, folderId]);
}

/**
 * A project's Assets, in the content region — OD-UI-1.2 §09, WORKSPACE-STANDARD §01.
 *
 * The library belongs to the project, not to the conversation: every chat in a
 * project sees the same files, and the heading names the project alone.
 *
 * Type, status, sort and list / thumbnail are the only controls. Add, groups,
 * the source tabs and search were taken off this page (§18 r7), and with them
 * goes any filter a hidden control could have left switched on.
 *
 * A row opens its file from anywhere that is not the checkbox or "More" — name,
 * format, source, time, status, icon, blank space — and keeps the conversation
 * beside it. Enter and Space do the same. The checkbox selects for the batch
 * actions; it never opens.
 */
export function AssetsPage() {
  const t = useT();
  const { state, folders, chats } = useShell();
  const agent = useAgent();
  const library = useLibraryActions();
  const fileActions = useFileActions();
  const assets = useProjectAssets();
  const [format, setFormat] = useState<Format>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [selection, setSelection] = useState<string[]>([]);

  const chatKey = `${state.chat?.folderId ?? ""}:${state.chat?.conversationId ?? ""}`;
  // Entering a conversation starts from the whole library, as a list (§16).
  useEffect(() => {
    setFormat("all");
    setStatus("all");
    setSort("updated");
    setLayout("list");
    setSelection([]);
  }, [chatKey]);

  const touched = useMemo(() => filesTouchedBy(agent.task), [agent.task]);
  const statusOf = (file: FileMeta) => fileActions.statusOf(file, touched.working, touched.review);

  const list = useMemo(() => {
    const filtered = assets.filter(
      (file) =>
        matchesFormat(file, format) &&
        // "Needs attention" is a file that failed to save or open; nothing reports one yet.
        (status === "all" || (status !== "attention" && statusOf(file) === status)),
    );
    return filtered.sort(
      (a, b) =>
        (sort === "opened"
          ? (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
          : sort === "name"
            ? a.name.localeCompare(b.name)
            : b.updatedAt - a.updatedAt) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
    // `statusOf` reads `touched`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, format, status, sort, touched]);

  const project = folders.find((folder) => folder.id === state.chat?.folderId);
  const heading = project && !project.isDefault ? project.name : t("dx.nav.unfiledShort");
  const selected = list.filter((file) => selection.includes(file.id));
  const filtered = format !== "all" || status !== "all";

  const originOf = (file: FileMeta) => {
    if (file.originConversationId) {
      return chats.find((entry) => entry.id === file.originConversationId)?.name ?? "—";
    }
    if (!file.artifactTaskId) return "—";
    const chat = chats.find(
      (entry) => entry.summary.id === file.artifactTaskId || entry.summary.image?.runs.some((run) => run.taskId === file.artifactTaskId),
    );
    return chat?.name ?? "—";
  };

  const toggle = (id: string, on: boolean) =>
    setSelection((current) => (on ? [...new Set([...current, id])] : current.filter((entry) => entry !== id)));

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, file: FileMeta) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void library.openFile(file.id);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = [...document.querySelectorAll<HTMLElement>("#dx-file-results [data-row]")];
      const index = rows.indexOf(event.currentTarget);
      rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus();
    }
  };

  const more = (file: FileMeta) => (
    <button
      type="button"
      className="dx-ib"
      aria-label={t("dx.file.optionsFor", { name: file.name })}
      title={t("dx.file.optionsFor", { name: file.name })}
      data-act="file-menu"
      data-id={file.id}
      onClick={(event) => fileActions.fileMenu(file, event.currentTarget)}
    >
      <Icon name="MoreHorizontal" />
    </button>
  );

  const sourceOf = (file: FileMeta) => t(file.artifactTaskId ? "dx.file.sourceGenerated" : "dx.file.sourceAdded");

  const results =
    list.length === 0 ? (
      <div className="dx-empty">
        <Icon name="Folder" />
        <h2>{t(filtered ? "dx.local.noMatch" : "dx.assets.empty")}</h2>
        <p>{t(filtered ? "dx.assets.noMatchHint" : "dx.assets.emptyHint")}</p>
        {filtered ? (
          <div className="dx-actions">
            <button
              type="button"
              className="dx-btn"
              data-act="clear-filters"
              onClick={() => {
                setFormat("all");
                setStatus("all");
              }}
            >
              {t("dx.assets.clearFilters")}
            </button>
          </div>
        ) : null}
      </div>
    ) : layout === "grid" ? (
      <div className="dx-cards">
        {list.map((file) => (
          <article
            key={file.id}
            className={selection.includes(file.id) ? "dx-asset-card dx-selected" : "dx-asset-card"}
            tabIndex={0}
            data-row={file.id}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("input,button,a,label")) return;
              setSelection([file.id]);
            }}
            onDoubleClick={() => void library.openFile(file.id)}
            onKeyDown={(event) => onRowKeyDown(event, file)}
          >
            <label>
              <input
                type="checkbox"
                data-select={file.id}
                checked={selection.includes(file.id)}
                aria-label={t("dx.assets.select", { name: file.name })}
                onChange={(event) => toggle(file.id, event.target.checked)}
              />
            </label>
            <div className="dx-preview">
              <FileIcon ext={extensionOf(file)} size={48} />
            </div>
            <button type="button" className="dx-name-button" data-act="open-file" data-id={file.id} title={file.name} onClick={() => void library.openFile(file.id)}>
              <span className="dx-ellipsis">{file.name}</span>
            </button>
            <div className="dx-metadata">
              {sourceOf(file)} · {formatDateTime(file.updatedAt)}
            </div>
            <div className="dx-row">
              {t(STATUS_KEY[statusOf(file)])}
              {more(file)}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <div className="dx-table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  data-select-all
                  aria-label={t("dx.assets.selectAll")}
                  checked={list.length > 0 && list.every((file) => selection.includes(file.id))}
                  onChange={(event) => setSelection(event.target.checked ? list.map((file) => file.id) : [])}
                />
              </th>
              <th>{t("dx.column.name")}</th>
              <th className="dx-format-col">{t("dx.column.format")}</th>
              <th className="dx-origin-col">{t("dx.column.fromChat")}</th>
              <th className="dx-source-col">{t("dx.column.source")}</th>
              <th className="dx-time-col" aria-sort="descending">
                {t("dx.column.lastUpdated")} ↓
              </th>
              <th>{t("dx.column.status")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((file) => {
              const isSelected = selection.includes(file.id);
              return (
                <tr
                  key={file.id}
                  className={isSelected ? "dx-file-row dx-open-row dx-selected" : "dx-file-row dx-open-row"}
                  tabIndex={0}
                  data-row={file.id}
                  data-open-file={file.id}
                  aria-label={t("dx.file.openAria", { name: file.name })}
                  aria-selected={isSelected}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("input,button,a,label,select,textarea")) return;
                    void library.openFile(file.id);
                  }}
                  onKeyDown={(event) => onRowKeyDown(event, file)}
                >
                  <td>
                    <input
                      type="checkbox"
                      data-select={file.id}
                      aria-label={t("dx.assets.select", { name: file.name })}
                      checked={isSelected}
                      onChange={(event) => toggle(file.id, event.target.checked)}
                    />
                  </td>
                  <td className="dx-name-col">
                    <button type="button" className="dx-name-button" data-act="open-file" data-id={file.id} title={file.name} onClick={() => void library.openFile(file.id)}>
                      <FileIcon ext={extensionOf(file)} />
                      <span className="dx-ellipsis">{file.name}</span>
                      {file.pinned ? <Icon name="Bookmark" /> : null}
                    </button>
                  </td>
                  <td className="dx-format-col dx-metadata">{extensionOf(file).toUpperCase()}</td>
                  <td className="dx-origin-col dx-metadata">{originOf(file)}</td>
                  <td className="dx-source-col dx-metadata">{sourceOf(file)}</td>
                  <td className="dx-time-col dx-metadata">{formatDateTime(file.updatedAt)}</td>
                  <td className="dx-metadata">{t(STATUS_KEY[statusOf(file)])}</td>
                  <td>{more(file)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <section className="dx-page-scroll" data-ui-scope="officedex">
      <header className="dx-page-header">
        <div>
          <h1>{t("dx.assets.title")}</h1>
          <p>{heading}</p>
        </div>
      </header>
      <OfflineBanner />
      <div className="dx-toolbar">
        <select aria-label={t("dx.assets.typeAria")} data-filter="format" value={format} onChange={(event) => setFormat(event.target.value as Format)}>
          <option value="all">{t("dx.assets.allTypes")}</option>
          <option value="office">{t("dx.assets.typeOffice")}</option>
          <option value="text">{t("dx.assets.typeText")}</option>
          <option value="pdf">{t("dx.type.pdf")}</option>
          <option value="images">{t("dx.assets.typeImages")}</option>
        </select>
        <select aria-label={t("dx.assets.statusAria")} data-filter="taskFilter" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
          <option value="all">{t("dx.assets.allStatuses")}</option>
          <option value="review">{t("dx.status.review")}</option>
          <option value="working">{t("dx.assets.statusWorking")}</option>
          <option value="saved">{t("dx.status.saved")}</option>
          <option value="attention">{t("dx.status.attention")}</option>
        </select>
        <select aria-label={t("dx.assets.sortAria")} data-filter="sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="updated">{t("dx.column.lastUpdated")}</option>
          <option value="opened">{t("dx.column.lastOpened")}</option>
          <option value="name">{t("dx.column.name")}</option>
        </select>
        <div className="dx-actions dx-end">
          {(["list", "grid"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="dx-ib"
              aria-label={t(value === "list" ? "dx.view.list" : "dx.view.thumbnail")}
              title={t(value === "list" ? "dx.view.list" : "dx.view.thumbnail")}
              data-act="layout"
              data-id={value}
              aria-pressed={layout === value}
              onClick={() => setLayout(value)}
            >
              <Icon name={value === "list" ? "List" : "Table2"} />
            </button>
          ))}
        </div>
      </div>
      <div id="dx-file-results">
        {selected.length > 0 ? (
          <div className="dx-batch">
            <span>{t("dx.assets.selected", { count: selected.length })}</span>
            <button type="button" className="dx-btn" data-act="favorite-selected" onClick={() => selected.forEach((file) => void library.setFavorite(file.id, true))}>
              {t("dx.menu.favorite")}
            </button>
            <button type="button" className="dx-btn" data-act="remove-assets" onClick={() => fileActions.removeFromAssets(selected)}>
              {t("dx.menu.remove")}
            </button>
            <button type="button" className="dx-btn" data-act="clear-selection" onClick={() => setSelection([])}>
              {t("dx.assets.clearSelection")}
            </button>
          </div>
        ) : null}
        {results}
      </div>
    </section>
  );
}

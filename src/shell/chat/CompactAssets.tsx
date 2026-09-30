import { useMemo, useState } from "react";

import { useT } from "../../renderer/i18n";
import { useFileActions } from "../chrome/useFileActions";
import { formatDateTime } from "../kit/format";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { closeModal, notice, openModal } from "../kit/layers";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useProjectAssets } from "../pages/AssetsPage";
import { usePort } from "../port/PortContext";
import { reportPortFailure } from "../port/reportPortFailure";
import { useShell } from "../state/ShellContext";

/**
 * The project's Assets, in the conversation column — OD-UI-1.2 §17.
 *
 * Rows are 64px: a 16px file icon, the name over its source and date, a 16px
 * "open" mark, and a 32px "More" in a slot of its own. The whole row is one
 * state surface — hover, pressed, focus and selected cover the "More" slot too
 * — and only the file open in the editor is selected.
 *
 * Add stays here, along with the sort, even though the content region's Assets
 * page no longer has them (§18 r7).
 */
export function CompactAssets() {
  const t = useT();
  const { state, folders } = useShell();
  const library = useLibraryActions();
  const fileActions = useFileActions();
  const assets = useProjectAssets();
  const project = folders.find((folder) => folder.id === state.chat?.folderId);
  const sorted = useMemo(() => [...assets].sort((a, b) => b.updatedAt - a.updatedAt), [assets]);

  return (
    <>
      <div className="dx-asset-pane-heading">
        <h3>{t("dx.assets.title")}</h3>
        <button
          type="button"
          className="dx-btn"
          data-act="add-assets"
          aria-haspopup="dialog"
          aria-controls="dx-modal"
          aria-expanded="false"
          onClick={() => {
            if (!state.chat) return;
            openModal({
              title: t("dx.assets.addTitle"),
              render: () => <AddAssets folderId={state.chat!.folderId} shared={Boolean(project && !project.isDefault)} />,
            });
          }}
        >
          <Icon name="Plus" />
          {t("dx.assets.add")}
        </button>
      </div>
      <div className="dx-metadata dx-asset-sort">
        {t("dx.column.lastUpdated")} <Icon name="ChevronDown" size={12} />
      </div>
      <div className="dx-compact-assets">
        {sorted.length > 0 ? (
          sorted.map((file) => {
            const selected = state.page === "editor" && state.activeFileId === file.id;
            return (
              <div key={file.id} className={selected ? "dx-asset-line dx-selected" : "dx-asset-line"} data-asset-id={file.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : "false"}
                  data-act="open-file"
                  data-id={file.id}
                  title={file.name}
                  onClick={() => void library.openFile(file.id)}
                >
                  <FileIcon ext={extensionOf(file)} size={16} />
                  <span className="dx-grow">
                    <span className="dx-ellipsis">{file.name}</span>
                    <small className="dx-metadata">
                      {t(file.artifactTaskId ? "dx.file.sourceGenerated" : "dx.file.sourceAddedShort")} · {formatDateTime(file.updatedAt)}
                    </small>
                  </span>
                  {state.unreadFileIds.includes(file.id) ? (
                    <i className="dx-dot" title={t("dx.assets.readyToReview")} />
                  ) : (
                    <Icon name="ArrowUpRight" />
                  )}
                </button>
                <button
                  type="button"
                  className="dx-ib"
                  aria-label={t("dx.file.options")}
                  title={t("dx.file.options")}
                  data-act="file-menu"
                  data-id={file.id}
                  onClick={(event) => fileActions.fileMenu(file, event.currentTarget)}
                >
                  <Icon name="MoreHorizontal" />
                </button>
              </div>
            );
          })
        ) : (
          <div className="dx-empty">
            <h3>{t("dx.assets.empty")}</h3>
            <p>{t("dx.assets.emptyCompactHint")}</p>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Add — two clear sources: a file already in OfficeDex, or one chosen from this
 * Mac. Nothing is opened, and cancelling adds nothing. Files already in this
 * library are shown ticked and locked, so they cannot be added twice, and the
 * confirm button stays disabled until something new is ticked (§17).
 */
function AddAssets({ folderId, shared }: { folderId: string; shared: boolean }) {
  const t = useT();
  const port = usePort();
  const { files, reload } = useShell();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const add = async (ids: string[]) => {
    setBusy(true);
    try {
      for (const id of ids) await port.files.move(id, folderId);
      await reload();
      closeModal();
      notice(t(ids.length === 1 ? "dx.assets.addedOne" : "dx.assets.addedMany", { count: ids.length }));
    } catch (reason) {
      reportPortFailure(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        {t("dx.assets.addIntro")} {t(shared ? "dx.assets.addShared" : "dx.assets.addChatOnly")}
      </p>
      <div className="dx-actions">
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="add-picker"
          disabled={busy}
          onClick={() => {
            void (async () => {
              try {
                const file = await port.files.openFromDisk();
                if (file) await add([file.id]);
              } catch (reason) {
                reportPortFailure(reason);
              }
            })();
          }}
        >
          {t("dx.context.chooseFromMac")}
        </button>
      </div>
      <hr className="dx-divider" />
      <h3>{t("dx.assets.addExisting")}</h3>
      <div className="dx-context-list">
        {files.map((file) => {
          const already = file.folderId === folderId;
          return (
            <label key={file.id} className="dx-row dx-context-file">
              <input
                type="checkbox"
                name="asset-ref"
                value={file.id}
                checked={already || picked.includes(file.id)}
                disabled={already}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id),
                  )
                }
              />
              <FileIcon ext={extensionOf(file)} />
              <span>{file.name}</span>
            </label>
          );
        })}
      </div>
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button
          type="button"
          className="dx-btn dx-primary"
          data-act="confirm-add-assets"
          disabled={picked.length === 0 || busy}
          onClick={() => void add(picked)}
        >
          {t("dx.assets.addSelected")}
        </button>
      </div>
    </>
  );
}

import { useCallback, useRef } from "react";

import { useT } from "../../renderer/i18n";
import { useCanvas } from "../canvas/CanvasContext";
import { openConfirmDialog, openNameDialog } from "../kit/dialogs";
import { FileIcon, extensionOf } from "../kit/Icon";
import { closeModal, notice, openMenu, openModal, type MenuItem } from "../kit/layers";
import { useLibraryActions } from "../nav/useLibraryActions";
import { usePort } from "../port/PortContext";
import { attempt, clearFileFailureReport, notBuiltYet, reportFileFailure } from "../port/reportPortFailure";
import { describeFailure, fileFailureMessageKey } from "../../shared/fileFailure";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { tabIsChat } from "../state/shellReducer";
import { formatDateTime } from "../kit/format";

/**
 * What the file says about itself, in the words the lists and the tab row use.
 *
 * `failed` is the one the status line did not have: a save the disk refused,
 * or a document the editor could not open. It used to be projected from
 * `dirty` alone, which reads "Saved" over a write that never happened. A
 * failed file is usually also dirty; the failure is what is shown, because it
 * is the thing to act on.
 */
export type FileStatus = "saved" | "unsaved" | "working" | "review" | "failed";

/** The dictionary key for a status cell, with the failure's own words when there is one. */
export function statusKeyOf(status: FileStatus, file: Pick<FileMeta, "failure">, long = false): string {
  switch (status) {
    case "failed":
      return file.failure?.kind === "open" ? "dx.status.openFailed" : "dx.status.saveFailed";
    case "unsaved":
      return long ? "dx.status.unsavedChanges" : "dx.status.unsaved";
    case "working":
      return "dx.status.working";
    case "review":
      return "dx.status.review";
    default:
      return "dx.status.saved";
  }
}

/**
 * Everything that can be done to a file, from wherever it is listed.
 *
 * One menu (§18 r7): Open / Preview / Details / Rename / Save as / Save copy /
 * Export / Print / Share / Favorite / History / Reference / Save as template /
 * New window / Remove / Trash. The differences that matter are kept in the
 * words — Save as is not Save copy, and removing a file from a project's
 * Assets is not moving it to the Trash (§09, §11).
 *
 * An item whose capability the service layer does not have yet stays in the
 * menu and says so when chosen. Hiding it would mean the menu changes shape
 * the day the capability lands.
 */
export function useFileActions() {
  const t = useT();
  const port = usePort();
  const canvas = useCanvas();
  const { state, dispatch, files, folders, activeFile, defaultFolderId, reload } = useShell();
  const library = useLibraryActions();

  /**
   * Writes the document on screen: the editor first, then the port.
   *
   * "Saved" is an assertion that the bytes reached the disk, so `files.save`
   * — which clears the flag — is reached only after the editor's own write
   * resolved. A rejected write leaves the file dirty, puts the failure on
   * record against it, and says so in a toast that stays with a Retry; the
   * status line reads "Save failed" until a retry gets through.
   */
  const writeDocument = useCallback(
    async (file: FileMeta): Promise<boolean> => {
      try {
        await canvas?.save();
        await port.files.save(file.id);
      } catch (reason) {
        const failure = describeFailure("save", reason);
        await port.files.setFailure?.(file.id, failure);
        await reload();
        reportFileFailure(file, failure, () => void retryRef.current(file));
        return false;
      }
      clearFileFailureReport(file.id);
      await reload();
      return true;
    },
    [canvas, port, reload],
  );

  /** The editor holds the bytes; the port holds the flag. Saving is both, in that order. */
  const save = useCallback(
    async (file: FileMeta, options: { quiet?: boolean } = {}): Promise<boolean> => {
      if (activeFile?.id !== file.id) {
        // Only the editor on screen can write its document.
        dispatch({ type: "activate-file", fileId: file.id });
        return false;
      }
      const saved = await writeDocument(file);
      if (saved && !options.quiet) notice(t("dx.file.savedNotice", { name: file.name }));
      return saved;
    },
    [activeFile, dispatch, writeDocument, t],
  );

  /**
   * Opens the document again after it could not be opened.
   *
   * Through the adapter, which is the only thing that can rebuild the editor:
   * closing the tab and opening it again shows the editor it already has, and
   * never retries the import. The failure stays on the file until the new
   * editor reports the document loaded, so a retry that fails again simply
   * reports again. Without an adapter that can retry — the skeleton, or an
   * editor type that cannot — the tab is cycled, which is all that is left.
   */
  const reopen = useCallback(
    async (file: FileMeta) => {
      clearFileFailureReport(file.id);
      if (canvas?.reopen) {
        if (activeFile?.id !== file.id) dispatch({ type: "activate-file", fileId: file.id });
        canvas.reopen(file);
        return;
      }
      const asChat = tabIsChat(state, file.id);
      await port.files.setFailure?.(file.id, null);
      dispatch({ type: "close-file", fileId: file.id });
      if (asChat) await library.openFile(file.id);
      else await library.openLocalFile(file.id);
    },
    [activeFile, canvas, state, port, dispatch, library],
  );

  /**
   * What the Retry control does: the thing that failed, again.
   *
   * Through a ref because the failure toast outlives the render that showed
   * it — its button must reach the current `save`, not the one closed over
   * when the toast went up.
   */
  const retryRef = useRef<(file: FileMeta) => Promise<unknown>>(async () => undefined);
  const retry = useCallback(
    async (file: FileMeta) => {
      if (file.failure?.kind === "open") return reopen(file);
      return save(file);
    },
    [reopen, save],
  );
  retryRef.current = retry;

  /**
   * Closes a tab. An unsaved file asks first: Save and close, Don't save, or
   * Cancel — Escape is Cancel, and a failed save leaves the file open (§11).
   */
  const close = useCallback(
    (file: FileMeta) => {
      if (!file.dirty) {
        dispatch({ type: "close-file", fileId: file.id });
        return;
      }
      if (activeFile?.id !== file.id) {
        // Its bytes live in an editor that is not mounted; bring it forward first.
        dispatch({ type: "activate-file", fileId: file.id });
        notice(t("shell.tabs.dirtyActivated"));
        return;
      }
      openModal({
        title: t("dx.file.closeTitle"),
        render: () => (
          <>
            <p>
              <strong>{file.name}</strong> {t("dx.file.closeUnsaved")}
            </p>
            <p>{t("dx.file.closeChoices")}</p>
            <div className="dx-form-actions">
              <button type="button" className="dx-btn" data-act="cancel-close" onClick={closeModal}>
                {t("dx.action.cancel")}
              </button>
              <button
                type="button"
                className="dx-btn"
                data-act="discard-close"
                onClick={() => {
                  void (async () => {
                    await attempt(async () => {
                      await port.files.setDirty(file.id, false);
                      // Nothing left to save, so nothing left to have failed.
                      await port.files.setFailure?.(file.id, null);
                    });
                    clearFileFailureReport(file.id);
                    closeModal();
                    dispatch({ type: "close-file", fileId: file.id });
                    await reload();
                  })();
                }}
              >
                {t("dx.file.dontSave")}
              </button>
              <button
                type="button"
                className="dx-btn dx-primary"
                data-act="save-close"
                onClick={() => {
                  void (async () => {
                    // A failed save leaves the file open (§11); the failure is
                    // on the file and in a toast with its own Retry.
                    const saved = await writeDocument(file);
                    if (!saved) return;
                    closeModal();
                    dispatch({ type: "close-file", fileId: file.id });
                    await reload();
                  })();
                }}
              >
                {t("dx.file.saveAndClose")}
              </button>
            </div>
          </>
        ),
      });
    },
    [activeFile, dispatch, port, reload, writeDocument, t],
  );

  /**
   * Share — OD-UI-1.2 §09. A local file is shared as a copy: its path is not a
   * link anyone else can open, and nothing is uploaded to make one.
   */
  const share = useCallback(
    (file: FileMeta) => {
      const aboutLinks = () =>
        openModal({
          title: t("dx.share.cloudTitle"),
          render: (close) => (
            <>
              <p>{t("dx.share.cloudBody1")}</p>
              <p>{t("dx.share.cloudBody2")}</p>
              <button type="button" className="dx-btn dx-primary" data-act="modal-close" onClick={close}>
                {t("dx.action.close")}
              </button>
            </>
          ),
        });
      openModal({
        title: t("dx.share.title"),
        render: () => (
          <>
            <p>{t("dx.share.body1")}</p>
            <p>{t("dx.share.body2")}</p>
            <div className="dx-actions">
              <button
                type="button"
                className="dx-btn dx-primary"
                data-act="export"
                data-id={file.id}
                onClick={() => {
                  // A dialog is drawn over everything in the page, a notice included.
                  closeModal();
                  notBuiltYet("file.export", t("dx.notBuilt.export"));
                }}
              >
                {t("dx.share.export")}
              </button>
              <button type="button" className="dx-btn" data-act="cloud-links" onClick={aboutLinks}>
                {t("dx.share.cloudLinks")}
              </button>
            </div>
          </>
        ),
      });
    },
    [t],
  );

  const rename = useCallback(
    (file: FileMeta) => {
      const ext = extensionOf(file);
      openNameDialog({
        title: t("dx.menu.rename"),
        label: t("dx.file.nameLabel"),
        initial: file.name,
        action: t("dx.menu.rename"),
        helper: t("dx.file.renameHelper", { ext }),
        onSubmit: async (value) => {
          if (/[\\/]/.test(value)) return t("dx.file.nameNoSlash");
          const name = value.includes(".") ? value : `${value}.${ext}`;
          const nextExt = name.split(".").pop()!.toLowerCase();
          if (/\.[A-Za-z0-9]+$/.test(file.name) && nextExt !== ext) return t("dx.file.keepExtension", { ext });
          await library.renameFile(file.id, name);
        },
      });
    },
    [t, library],
  );

  const details = useCallback(
    (file: FileMeta) => {
      const folder = folders.find((entry) => entry.id === file.folderId);
      void (async () => {
        const path = port.files.pathOf ? await port.files.pathOf(file.id).catch(() => "") : "";
        openModal({
          title: t("dx.menu.details"),
          className: "wide",
          render: () => (
            <>
              <div className="dx-row">
                <FileIcon ext={extensionOf(file)} size={48} />
                <h3>{file.name}</h3>
              </div>
              <dl className="dx-definition">
                <dt>{t("dx.file.location")}</dt>
                <dd>{path || folder?.path || t("dx.file.locationUnknown")}</dd>
                <dt>{t("dx.file.source")}</dt>
                <dd>{t(file.artifactTaskId ? "dx.file.sourceGenerated" : "dx.file.sourceAddedMac")}</dd>
                <dt>{t("dx.file.lastUpdated")}</dt>
                <dd>{formatDateTime(file.updatedAt)}</dd>
                <dt>{t("dx.file.lastOpened")}</dt>
                <dd>{file.lastOpenedAt ? formatDateTime(file.lastOpenedAt) : t("dx.file.notOpened")}</dd>
                <dt>{t("dx.file.status")}</dt>
                <dd>
                  {file.failure
                    ? t(fileFailureMessageKey(file.failure))
                    : t(file.dirty ? "dx.status.unsaved" : "dx.status.saved")}
                </dd>
                <dt>{t("dx.file.project")}</dt>
                <dd>{folder && !folder.isDefault ? folder.name : t("dx.file.noProject")}</dd>
              </dl>
              <p className="dx-helper">{t("dx.file.referenceNote")}</p>
            </>
          ),
        });
      })();
    },
    [folders, port, t],
  );

  const removeFromAssets = useCallback(
    (targets: FileMeta[]) => {
      if (targets.length === 0) return;
      openConfirmDialog({
        title: t("dx.assets.removeTitle"),
        body: <p>{t("dx.assets.removeBody", { count: targets.length })}</p>,
        action: t("dx.menu.remove"),
        onConfirm: async () => {
          // The project's library lets go of it; the file itself stays, in Local.
          for (const file of targets) await port.files.move(file.id, defaultFolderId);
          await reload();
        },
      });
    },
    [t, port, defaultFolderId, reload],
  );

  const trash = useCallback(
    (targets: FileMeta[]) => {
      if (targets.length === 0) return;
      openConfirmDialog({
        title: t("dx.file.trashTitle"),
        body: (
          <>
            <p>{t("dx.file.trashBody", { count: targets.length })}</p>
            <p>{t("dx.file.trashDiffers")}</p>
          </>
        ),
        action: t("dx.menu.trash"),
        onConfirm: async () => {
          for (const file of targets) {
            await port.files.remove(file.id);
            dispatch({ type: "close-file", fileId: file.id });
          }
          await reload();
        },
      });
    },
    [t, port, dispatch, reload],
  );

  const fileMenu = useCallback(
    (file: FileMeta, anchor: HTMLElement, options: { open?: () => void } = {}) => {
      const missing = (feature: string, key: string) => () => notBuiltYet(feature, t(key));
      const inProject = state.chat !== null;
      const items: MenuItem[] = [
        { label: t("dx.menu.open"), onSelect: options.open ?? (() => void library.openFile(file.id)) },
        { label: t("dx.menu.preview"), onSelect: missing("file.preview", "dx.notBuilt.preview") },
        { label: t("dx.menu.details"), onSelect: () => details(file) },
        "-",
        { label: t("dx.menu.rename"), onSelect: () => rename(file) },
        { label: t("dx.menu.saveAs"), onSelect: missing("file.saveAs", "dx.notBuilt.saveAs") },
        {
          label: t("dx.menu.saveCopy"),
          onSelect: () =>
            void (async () => {
              // The copy is made from the bytes on disk. An editor still
              // holding edits writes them first, or the copy is the file as
              // it was opened — and is announced as a copy of what is on
              // screen. A save that fails, or a document whose editor is not
              // the one mounted, makes no copy at all.
              if (file.dirty && !(await save(file))) {
                if (activeFile?.id !== file.id) notice(t("shell.tabs.dirtyActivated"));
                return;
              }
              const copy = await library.duplicateFile(file.id);
              if (copy) notice(t("dx.file.copySaved", { name: copy.name }));
            })(),
        },
        { label: t("dx.menu.export"), onSelect: missing("file.export", "dx.notBuilt.export") },
        { label: t("dx.menu.print"), onSelect: missing("file.print", "dx.notBuilt.print") },
        { label: t("dx.menu.share"), onSelect: () => share(file) },
        "-",
        {
          label: t(file.pinned ? "dx.menu.unfavorite" : "dx.menu.favorite"),
          onSelect: () => void library.setFavorite(file.id, !file.pinned),
        },
        { label: t("dx.menu.history"), onSelect: missing("file.history", "dx.notBuilt.history") },
        { label: t("dx.menu.reference"), onSelect: () => referenceRequests.emit(file.id) },
        { label: t("dx.menu.saveTemplate"), onSelect: missing("file.template", "dx.notBuilt.template") },
        { label: t("dx.menu.newWindow"), onSelect: missing("file.newWindow", "dx.notBuilt.newWindow") },
        ...(inProject ? [{ label: t("dx.menu.remove"), onSelect: () => removeFromAssets([file]) }] : []),
        { label: t("dx.menu.trash"), onSelect: () => trash([file]) },
      ];
      openMenu(anchor, items);
    },
    [t, state.chat, library, details, rename, share, removeFromAssets, trash, save, activeFile],
  );

  const statusOf = useCallback(
    (file: FileMeta, working: ReadonlySet<string>, review: ReadonlySet<string>): FileStatus =>
      working.has(file.id)
        ? "working"
        : review.has(file.id)
          ? "review"
          : file.failure
            ? "failed"
            : file.dirty
              ? "unsaved"
              : "saved",
    [],
  );

  return { save, reopen, retry, close, share, rename, details, removeFromAssets, trash, fileMenu, statusOf, files };
}

/**
 * "Use this file in my next message", from a menu to whichever composer is on
 * screen. A tiny bus rather than shell state: a reference belongs to the
 * message being written, and the composer owns that.
 */
type ReferenceListener = (fileId: string) => void;
const referenceListeners = new Set<ReferenceListener>();
export const referenceRequests = {
  emit(fileId: string) {
    referenceListeners.forEach((listener) => listener(fileId));
  },
  subscribe(listener: ReferenceListener) {
    referenceListeners.add(listener);
    return () => {
      referenceListeners.delete(listener);
    };
  },
};

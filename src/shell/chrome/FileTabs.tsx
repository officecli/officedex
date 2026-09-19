import { Bookmark, BookmarkCheck, Check, Copy, Maximize2, MoreHorizontal, Share2, Trash2, X } from "lucide-react";
import { useState } from "react";

import { usePort } from "../port/PortContext";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { useCanvas } from "../canvas/CanvasContext";
import { attempt, notBuiltYet } from "../port/reportPortFailure";
import { useLibraryActions } from "../nav/useLibraryActions";
import { Menu } from "./Menu";
import { dialog, Input, Modal, toast } from "../../renderer/ui";
import { FileTypeIcon } from "./FileTypeIcon";

const stripExtension = (name: string) => name.replace(/\.(docx|xlsx|pptx)$/i, "");

/**
 * The file tabs are shell furniture, not a property of a screen: they stay put
 * across a mode change and across a trip to Home. Open files are the one thing
 * in this IA that outlives every other piece of navigation state, which is why
 * they get the top row to themselves.
 */
export function FileTabs() {
  const port = usePort();
  const canvas = useCanvas();
  const { state, dispatch, files, activeFile, reload } = useShell();
  const actions = useLibraryActions();
  const [renameTarget, setRenameTarget] = useState<FileMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const open = state.openFileIds
    .map((id) => files.find((file) => file.id === id))
    .filter((file): file is FileMeta => Boolean(file));

  const dirty = activeFile?.dirty ?? false;

  const closeFile = (file: FileMeta) => {
    if (!file.dirty) {
      dispatch({ type: "close-file", fileId: file.id });
      return;
    }

    // Only the visible editor owns a save handle. Activating an inactive dirty
    // tab first is safer than clearing its dirty flag while its bytes are
    // still only in an editor that is not mounted here.
    if (activeFile?.id !== file.id) {
      dispatch({ type: "activate-file", fileId: file.id });
      toast.info({
        key: "dirty-file-activated",
        content: "Open the file to save it before closing",
        description: file.name,
      });
      return;
    }

    dialog.confirm({
      title: "Save before closing?",
      content: <p>“{file.name}” has unsaved changes.</p>,
      okText: "Save and close",
      cancelText: "Cancel",
      onOk: async () => {
        const saved = await attempt(async () => {
          // The active editor owns the in-memory bytes.
          await canvas?.save();
          await port.files.save(file.id);
        });
        if (!saved) return;
        dispatch({ type: "close-file", fileId: file.id });
        await reload();
      },
    });
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const value = renameValue.trim();
    if (!value) {
      toast.error("Enter a file name.");
      return;
    }
    const renamed = await attempt(() => port.files.rename(renameTarget.id, value));
    if (!renamed) return;
    setRenameTarget(null);
    await reload();
  };

  return (
    <div className="shell-tabs shell-region">
      <div className="shell-tabstrip" role="tablist" aria-label="Open files">
        {open.map((file) => {
          const current = file.id === state.activeFileId && !state.home;
          return (
            <div key={file.id} className={`shell-tab${current ? " is-current" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={current}
                tabIndex={current ? 0 : -1}
                className="shell-tab-select"
                title={file.name}
                onClick={() => dispatch({ type: "activate-file", fileId: file.id })}
              >
                <FileTypeIcon type={file.type} />
                <span className="shell-tab-name">{stripExtension(file.name)}</span>
                {file.dirty ? <i className="shell-tab-dirty" aria-label="Unsaved changes" /> : null}
              </button>
              {current ? (
                <button
                  type="button"
                  className="shell-tab-bookmark"
                  aria-label={file.pinned ? `Remove bookmark from ${file.name}` : `Bookmark ${file.name}`}
                  title={file.pinned ? "Remove bookmark" : "Bookmark"}
                  aria-pressed={file.pinned}
                  onClick={() => void actions.setPinned(file.id, !file.pinned)}
                >
                  {file.pinned ? (
                    <BookmarkCheck size={14} strokeWidth={1.8} aria-hidden="true" />
                  ) : (
                    <Bookmark size={14} strokeWidth={1.8} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className="shell-tab-close"
                aria-label={`Close ${file.name}`}
                title="Close"
                onClick={() => closeFile(file)}
              >
                <X size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="shell-tabs-actions">
        <button
          type="button"
          className="shell-save-state"
          aria-live="polite"
          onClick={async () => {
            if (!activeFile) return;
            // The editor holds the bytes; the port holds the flag. Saving is
            // both, in that order — `files.save` on its own would mark the
            // document clean without anything having been written.
            await attempt(async () => {
              await canvas?.save();
              await port.files.save(activeFile.id);
            });
            await reload();
          }}
          disabled={!activeFile}
          title={dirty ? "Save on this computer" : "All changes saved"}
        >
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
          {dirty ? "Unsaved" : "Saved"}
        </button>

        <button
          type="button"
          className="shell-share"
          title="Share"
          onClick={() =>
            void (async () => {
              if (!activeFile) {
                notBuiltYet(
                  "share",
                  "Sharing a file from OfficeDex is not built yet. Open a local file first.",
                );
                return;
              }
              try {
                // The desktop owns the path. Share it when the runtime can
                // expose it; browser preview keeps the safe file name only.
                const path = port.files.pathOf
                  ? await port.files.pathOf(activeFile.id).catch(() => "")
                  : "";
                const value = path || activeFile.name;
                if (typeof navigator.share === "function") {
                  await navigator.share({ title: value, text: value });
                  toast.success({ key: "file-shared", content: "Share sheet opened" });
                } else if (navigator.clipboard) {
                  await navigator.clipboard.writeText(value);
                  toast.success({ key: "file-shared", content: "File name copied" });
                } else {
                  toast.info(`File: ${value}`);
                }
              } catch {
                // Cancelling the native share sheet is not an error.
              }
            })()
          }
        >
          <Share2 size={14} strokeWidth={1.7} aria-hidden="true" />
          Share
        </button>

        <div className="shell-tabs-icons">
          {/* Full screen has a port method; this is the second control for it,
              alongside the one in the window bar. */}
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Full screen"
            title="Full screen"
            onClick={() => port.window.toggleFullscreen()}
          >
            <Maximize2 size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
          <Menu
            label="File actions"
            width={190}
            items={activeFile ? [
              {
                id: "rename",
                label: "Rename file…",
                onSelect: () => {
                  setRenameValue(stripExtension(activeFile.name));
                  setRenameTarget(activeFile);
                },
              },
              {
                id: "duplicate",
                label: "Duplicate file",
                icon: <Copy size={14} strokeWidth={1.7} aria-hidden="true" />,
                onSelect: async () => {
                  await attempt(async () => {
                    const copy = await port.files.duplicate(activeFile.id);
                    dispatch({ type: "open-file", fileId: copy.id });
                    await reload();
                  });
                },
              },
              {
                id: "pin",
                label: activeFile.pinned ? "Remove from Pinned" : "Pin file",
                onSelect: () => void actions.setPinned(activeFile.id, !activeFile.pinned),
              },
              {
                id: "remove",
                label: "Remove from library",
                icon: <Trash2 size={14} strokeWidth={1.7} aria-hidden="true" />,
                onSelect: async () => {
                  await attempt(async () => {
                    await port.files.remove(activeFile.id);
                    dispatch({ type: "close-file", fileId: activeFile.id });
                    await reload();
                  });
                },
              },
            ] : []}
          >
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className="shell-icon-button"
                aria-label="More actions"
                title="More"
              >
                <MoreHorizontal size={16} strokeWidth={1.6} aria-hidden="true" />
              </button>
            )}
          </Menu>
        </div>
      </div>
      {renameTarget ? (
        <Modal
          open
          title="Rename file"
          okText="Save"
          onOk={submitRename}
          onCancel={() => setRenameTarget(null)}
          width={420}
        >
          <label className="shell-dialog-label" htmlFor="shell-file-name">
            File name
          </label>
          <Input
            id="shell-file-name"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
          />
          <p className="shell-dialog-note">The file extension is kept automatically.</p>
        </Modal>
      ) : null}
    </div>
  );
}

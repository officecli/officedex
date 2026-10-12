import { useEffect, useMemo, useRef, type DragEvent, type KeyboardEvent } from "react";

import { useT } from "../../renderer/i18n";
import dexFlatInk from "../assets/dex/officedex-agent-flat-ink.svg";
import followIcon from "../assets/titlebar/follow.svg";
import moreIcon from "../assets/titlebar/more.svg";
import presentIcon from "../assets/titlebar/present.svg";
import savedIcon from "../assets/titlebar/saved.svg";
import shareIcon from "../assets/titlebar/share.svg";
import { useCanvas } from "../canvas/CanvasContext";
import { useCanvasFileFailures } from "../canvas/useCanvasFileFailures";
import { DexFace } from "../dex/DexFace";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { usePort } from "../port/PortContext";
import { notBuiltYet } from "../port/reportPortFailure";
import { fileFailureMessageKey } from "../../shared/fileFailure";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { showsTabStrip, tabIsChat } from "../state/shellReducer";
import { closeTabShortcutLabel, isCloseTabShortcut } from "./closeTabShortcut";
import { statusKeyOf, useFileActions } from "./useFileActions";

const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, "");

/** The tab row has no review state of its own; that is Assets' column. */
const NO_REVIEW: ReadonlySet<string> = new Set();

/**
 * The content region's top row — OD-UI-1.2 §08, §10, §17.
 *
 * On Home, Local, Projects and Settings it is a blank 40px band. Everywhere
 * else it is the document tabs: 32px tabs with a 10px radius in a 40px row,
 * one selection surface per tab (the whole tab, never the title button inside
 * it), and the save / share / editor actions at the right end when a document
 * is on screen.
 *
 * A tab that was opened from a conversation carries the faint Dex watermark; a
 * Local tab does not. That is the tab's own context, remembered per file, and
 * activating a tab restores it (§18).
 *
 * `workingFileIds` are files an agent run is writing to right now: their icon
 * slot shows Dex instead of the file type, without the name or the width
 * moving. `unread` is the blue dot, cleared by opening the file.
 */
export function DocumentTabs({ workingFileIds }: { workingFileIds: ReadonlySet<string> }) {
  const t = useT();
  const port = usePort();
  const { state, dispatch, files, chats, activeFile, folders } = useShell();
  const fileActions = useFileActions();
  const canvas = useCanvas();
  const dragged = useRef<string | null>(null);
  const tablist = useRef<HTMLDivElement>(null);

  // The editor's own failures land here because this row is where they show:
  // the tab keeps its dot, the status reads "Save failed", Retry sits beside it.
  useCanvasFileFailures(canvas, fileActions.retry);

  const open = useMemo(
    () =>
      state.openFileIds
        .map((id) => files.find((file) => file.id === id))
        .filter((file): file is FileMeta => Boolean(file)),
    [state.openFileIds, files],
  );

  const selectedId = state.page === "editor" ? state.activeFileId : null;
  // A tablist has exactly one tab stop; with nothing selected it is the first tab.
  const tabStopId = open.some((file) => file.id === selectedId) ? selectedId : (open[0]?.id ?? null);
  const closeShortcut = useMemo(() => closeTabShortcutLabel(), []);

  /*
   * ⌘W closes the document on screen by the same path the X takes, so an
   * unsaved file still gets its question. Capture phase: the chord has to work
   * while focus is inside a mounted editor. With no document on screen the key
   * is left alone and keeps meaning "close the window".
   */
  useEffect(() => {
    if (!activeFile) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (document.getElementById("dx-workspace")?.inert || !isCloseTabShortcut(event)) return;
      event.preventDefault();
      fileActions.close(activeFile);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeFile, fileActions]);

  /*
   * The tab on screen is always in view (UX28-08). Opening or creating a file
   * with several tabs already open switched the document but left the strip
   * scrolled to its start, so the active tab — the only place the file's name
   * shows — sat out of sight. Only the strip scrolls; nothing around it moves.
   */
  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      const list = tablist.current;
      const tab = list?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(selectedId)}"]`);
      if (!list || !tab) return;
      const bounds = list.getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      if (box.left < bounds.left) list.scrollLeft -= bounds.left - box.left;
      else if (box.right > bounds.right) list.scrollLeft += box.right - bounds.right;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, state.openFileIds.length]);

  if (!showsTabStrip(state)) return <div className="dx-home-top" />;

  const activeStatus = activeFile ? fileActions.statusOf(activeFile, workingFileIds, NO_REVIEW) : "saved";

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? open.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + open.length) % open.length;
    const file = open[next];
    if (!file) return;
    dispatch({ type: "activate-file", fileId: file.id });
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.dx-tab-title[data-id="${CSS.escape(file.id)}"]`)?.focus(),
    );
  };

  const onDrop = (event: DragEvent<HTMLDivElement>, target: FileMeta) => {
    const moving = dragged.current;
    dragged.current = null;
    if (!moving || moving === target.id) return;
    event.preventDefault();
    dispatch({ type: "move-tab", fileId: moving, toIndex: state.openFileIds.indexOf(target.id) });
  };

  const contextLabel = (file: FileMeta) => {
    const context = state.tabContexts[file.id];
    if (!context) return t("dx.tab.contextLocal");
    const chat = chats.find((entry) => entry.id === context.conversationId);
    return t("dx.tab.contextChat", { name: chat?.name ?? t("dx.chat.untitled") });
  };

  return (
    <div className="dx-tabs-strip" data-ui-scope="officedex">
      <div ref={tablist} className="dx-document-tabs" role="tablist" aria-label={t("dx.tab.listAria")}>
        {open.map((file, index) => {
          const active = file.id === selectedId;
          const chatTab = tabIsChat(state, file.id);
          const folder = folders.find((entry) => entry.id === file.folderId);
          return (
            <div
              key={file.id}
              className={active ? "dx-file-tab dx-active" : "dx-file-tab"}
              draggable
              data-tab={file.id}
              data-context={chatTab ? "chat" : "local"}
              data-failed={file.failure ? file.failure.kind : undefined}
              onDragStart={(event) => {
                dragged.current = file.id;
                event.dataTransfer.setData("text/plain", file.id);
              }}
              onDragOver={(event) => {
                if (dragged.current) event.preventDefault();
              }}
              onDrop={(event) => onDrop(event, file)}
            >
              {chatTab ? (
                <span className="dx-tab-dex-watermark" aria-hidden="true">
                  <img src={dexFlatInk} alt="" />
                </span>
              ) : null}
              <button
                type="button"
                className="dx-tab-title"
                role="tab"
                tabIndex={file.id === tabStopId ? 0 : -1}
                aria-selected={active}
                data-act="open-tab"
                data-id={file.id}
                title={`${file.name} — ${contextLabel(file)}${folder ? ` — ${folder.path || folder.name}` : ""}${
                  file.failure ? ` — ${t(fileFailureMessageKey(file.failure))}` : ""
                }`}
                onClick={() => dispatch({ type: "activate-file", fileId: file.id })}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {workingFileIds.has(file.id) ? (
                  <DexFace state="write" variant="tiny" />
                ) : (
                  <FileIcon ext={extensionOf(file)} size={16} />
                )}
                <span className="dx-ellipsis">{withoutExtension(file.name)}</span>
                {file.dirty || file.failure ? (
                  <i
                    className="dx-dirty-mark"
                    title={t(file.failure ? fileFailureMessageKey(file.failure) : "dx.status.unsavedChanges")}
                  >
                    •
                  </i>
                ) : null}
                {state.unreadFileIds.includes(file.id) ? <i className="dx-dot" title={t("dx.tab.unread")} /> : null}
              </button>
              <button
                type="button"
                className="dx-ib"
                aria-label={t("dx.tab.close", { name: file.name })}
                title={active ? `${t("dx.tab.close", { name: file.name })} (${closeShortcut})` : t("dx.tab.close", { name: file.name })}
                data-act="close-file"
                data-id={file.id}
                onClick={() => fileActions.close(file)}
                onContextMenu={(event) => {
                  event.preventDefault();
                }}
              >
                <Icon name="X" />
              </button>
            </div>
          );
        })}
      </div>

      {activeFile ? (
        <div className="dx-source-header-actions">
          <button
            type="button"
            className={activeFile.failure ? "dx-source-saved dx-failed" : "dx-source-saved"}
            data-act="save"
            data-id={activeFile.id}
            data-status={activeStatus}
            aria-label={
              activeFile.failure
                ? t(fileFailureMessageKey(activeFile.failure))
                : t("dx.file.saveAria", { name: activeFile.name })
            }
            title={activeFile.failure ? t(fileFailureMessageKey(activeFile.failure)) : undefined}
            onClick={() => void (activeFile.failure ? fileActions.retry(activeFile) : fileActions.save(activeFile))}
          >
            <img src={savedIcon} alt="" />
            <span>{t(activeFile.failure ? "dx.status.failed" : statusKeyOf(activeStatus, activeFile))}</span>
          </button>
          {activeFile.failure ? (
            <button
              type="button"
              className="dx-source-retry"
              data-act={activeFile.failure.kind === "open" ? "reopen" : "retry-save"}
              data-id={activeFile.id}
              aria-label={t(activeFile.failure.kind === "open" ? "dx.file.reopenAria" : "dx.file.retrySaveAria", {
                name: activeFile.name,
              })}
              onClick={() => void fileActions.retry(activeFile)}
            >
              {t(activeFile.failure.kind === "open" ? "dx.action.reopen" : "dx.action.retrySave")}
            </button>
          ) : null}
          <button
            type="button"
            className="dx-source-share"
            data-act="share"
            data-id={activeFile.id}
            onClick={() => fileActions.share(activeFile)}
          >
            <img src={shareIcon} alt="" />
            {t("dx.menu.share")}
          </button>
          <span className="dx-source-action-icons">
            <button
              type="button"
              className="dx-source-title-button"
              data-act="editor-command"
              data-id="present"
              aria-label={t("dx.editor.present")}
              title={t("dx.notBuilt.present")}
              aria-disabled="true"
              onClick={() => notBuiltYet("editor.present", t("dx.notBuilt.present"))}
            >
              <img src={presentIcon} alt="" />
            </button>
            <button
              type="button"
              className="dx-source-title-button"
              data-act="editor-command"
              data-id="fullscreen"
              aria-label={t("dx.editor.fullscreen")}
              title={t("dx.editor.fullscreen")}
              onClick={() => port.window.toggleFullscreen()}
            >
              <img src={followIcon} alt="" />
            </button>
            <button
              type="button"
              className="dx-source-title-button"
              data-act="file-menu"
              data-id={activeFile.id}
              aria-label={t("dx.file.options")}
              title={t("dx.file.options")}
              onClick={(event) =>
                fileActions.fileMenu(activeFile, event.currentTarget, {
                  open: () => dispatch({ type: "activate-file", fileId: activeFile.id }),
                })
              }
            >
              <img src={moreIcon} alt="" />
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

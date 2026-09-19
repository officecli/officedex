import {
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Maximize2,
  MoreHorizontal,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePort } from "../port/PortContext";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { useCanvas } from "../canvas/CanvasContext";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { useLibraryActions } from "../nav/useLibraryActions";
import { Menu } from "./Menu";
import { dialog, Input, Modal, toast } from "../../renderer/ui";
import { FileTypeIcon } from "./FileTypeIcon";

const stripExtension = (name: string) => name.replace(/\.(docx|xlsx|pptx)$/i, "");

/** A tab's left edge in the strip's scroll content, whatever the offset parent is. */
function contentLeft(strip: HTMLElement, tab: HTMLElement): number {
  return tab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
}

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
  const stripRef = useRef<HTMLDivElement>(null);
  const open = state.openFileIds
    .map((id) => files.find((file) => file.id === id))
    .filter((file): file is FileMeta => Boolean(file));

  const dirty = activeFile?.dirty ?? false;

  /*
   * Which tab the canvas is showing, and which tab is the strip's single tab
   * stop. They are not the same question, and conflating them cost the whole
   * strip its keyboard access on Home.
   *
   * `home` means "no document is on the canvas", so nothing is selected there —
   * that part was right. But the roving tabindex was derived from the same flag
   * with no fallback, so on Home every `.shell-tab-select` got `tabIndex={-1}`
   * while the seven close buttons kept their default. Tab then walked seven
   * "Close …" buttons and never once reached a tab: a keyboard could close
   * every open file and open none of them.
   *
   * A tablist always has exactly one tab stop. With no selection that is the
   * first tab, and the arrow keys move from there.
   */
  const selectedId = state.home ? null : state.activeFileId;
  const tabStopId = open.some((file) => file.id === selectedId) ? selectedId : open[0]?.id ?? null;

  /*
   * How far the strip overruns, and which way.
   *
   * `overflow-x: auto` plus a hidden scrollbar is a promise the shell was not
   * keeping: seven tabs do not fit in any of the ten shell combinations, and the
   * only sign of it was a half-drawn icon at the right edge. In the worst one
   * (docked Agent on an expanded rail) four of the seven tabs were cut off and
   * their close buttons sat outside the visible box entirely — present in the
   * DOM, impossible to click.
   *
   * Measured rather than guessed from the combination: the strip's width moves
   * with the rail, the docked column, the window, and — on Home — with the file
   * actions leaving the row.
   */
  const [overflow, setOverflow] = useState({ amount: 0, hidden: 0, atStart: true, atEnd: true });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const measure = () => {
      const amount = strip.scrollWidth - strip.clientWidth;
      const bounds = strip.getBoundingClientRect();
      const hidden = Array.from(strip.querySelectorAll<HTMLElement>(".shell-tab")).filter((tab) => {
        const rect = tab.getBoundingClientRect();
        return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5;
      }).length;
      setOverflow({
        amount,
        hidden,
        atStart: strip.scrollLeft <= 1,
        atEnd: strip.scrollLeft >= amount - 1,
      });
    };

    measure();
    strip.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    for (const child of Array.from(strip.children)) observer.observe(child);
    return () => {
      strip.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [open.length]);

  // Activating a tab that is scrolled out of sight has to bring it into sight,
  // or the click just made looks like it did nothing. Done with `scrollLeft`
  // rather than `scrollIntoView`: this axis is the only one that should move,
  // and jsdom has no `scrollIntoView` for the unit tests to fall over.
  useEffect(() => {
    const strip = stripRef.current;
    const current = strip?.querySelector<HTMLElement>(".shell-tab.is-current");
    if (!strip || !current) return;
    const left = contentLeft(strip, current);
    const right = left + current.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [state.activeFileId, state.home]);

  /** Scrolls by whole tabs: a fixed pixel step lands mid-tab, which is the state these controls exist to leave. */
  const scrollStrip = (direction: -1 | 1) => {
    const strip = stripRef.current;
    if (!strip) return;
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>(".shell-tab"));
    const target =
      direction === 1
        ? tabs.find((tab) => contentLeft(strip, tab) + tab.offsetWidth > strip.scrollLeft + strip.clientWidth + 1)
        : [...tabs].reverse().find((tab) => contentLeft(strip, tab) < strip.scrollLeft - 1);
    if (!target) {
      strip.scrollLeft += direction * 120;
      return;
    }
    strip.scrollLeft =
      direction === 1
        ? contentLeft(strip, target) + target.offsetWidth - strip.clientWidth
        : contentLeft(strip, target);
  };

  /*
   * Arrow keys move focus along the strip; Enter or Space activates.
   *
   * Manual activation rather than automatic (both are allowed by the ARIA tabs
   * pattern): activating a tab here swaps the document on the canvas, so
   * arrowing past four tabs to reach the fifth must not mount and unmount four
   * editors on the way. `focus()` on a clipped tab scrolls it into view, which
   * is how the keyboard reaches the tabs the strip is hiding.
   */
  const moveFocus = (from: number, to: number | "first" | "last") => {
    const selects = Array.from(
      stripRef.current?.querySelectorAll<HTMLButtonElement>(".shell-tab-select") ?? [],
    );
    if (selects.length === 0) return;
    const index =
      to === "first"
        ? 0
        : to === "last"
          ? selects.length - 1
          : Math.min(selects.length - 1, Math.max(0, from + to));
    selects[index]?.focus();
  };

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
      <div className="shell-tabstrip" role="tablist" aria-label="Open files" ref={stripRef}>
        {open.map((file, index) => {
          const current = file.id === selectedId;
          return (
            <div key={file.id} className={`shell-tab${current ? " is-current" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={current}
                tabIndex={file.id === tabStopId ? 0 : -1}
                className="shell-tab-select"
                title={file.name}
                onClick={() => dispatch({ type: "activate-file", fileId: file.id })}
                onKeyDown={(event) => {
                  const moves = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" } as const;
                  const move = moves[event.key as keyof typeof moves];
                  if (move === undefined) return;
                  event.preventDefault();
                  moveFocus(index, move);
                }}
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

      {/*
        The overflow affordance. It exists only while there is something it can
        do, so the row keeps its shape once every tab fits — which is what the
        four Home combinations do now that the file actions leave the flow.

        Both controls sit to the *right* of the strip on purpose. A left-hand
        control would move the strip's left edge, and that edge is the top row's
        content boundary: it lines up with the sidebar (or with the docked
        column) and must not shift because a seventh file was opened.
      */}
      {overflow.amount > 1 ? (
        <div className="shell-tabstrip-nav">
          <button
            type="button"
            className="shell-icon-button shell-tabstrip-scroll"
            aria-label="Scroll tabs left"
            title="Scroll tabs left"
            disabled={overflow.atStart}
            onClick={() => scrollStrip(-1)}
          >
            <ChevronLeft size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="shell-icon-button shell-tabstrip-scroll"
            aria-label="Scroll tabs right"
            title={
              overflow.hidden > 0
                ? `Scroll tabs right (${overflow.hidden} out of sight)`
                : "Scroll tabs right"
            }
            disabled={overflow.atEnd}
            onClick={() => scrollStrip(1)}
          >
            <ChevronRight size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      ) : null}

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
                /*
                 * Not `notBuiltYet`. That channel means "there is nothing behind
                 * this control", and it produced two sentences that cancelled
                 * each other out: "Sharing … is not built yet. Open a local file
                 * first." If it is not built, opening a file cannot help. It *is*
                 * built — what is missing is a document to share.
                 */
                toast.info({
                  key: "share-needs-file",
                  content: "Open a file to share it",
                  description: "Share sends whichever file is open on the canvas.",
                });
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
              } catch (reason) {
                /*
                 * Dismissing the native share sheet is a decision, not a failure,
                 * and it is the one thing this catch was written for. It then went
                 * on to swallow every other outcome on the path — a rejected
                 * clipboard permission (which is what actually happens in a plain
                 * browser), a `navigator.share` that throws, a port that refuses.
                 * Pressing Share with a file open produced no toast at all.
                 */
                if (reason instanceof DOMException && reason.name === "AbortError") return;
                reportPortFailure(reason);
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

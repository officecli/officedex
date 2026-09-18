import { Check, Maximize2, MoreHorizontal, Share2, X } from "lucide-react";

import { usePort } from "../port/PortContext";
import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { notBuiltYet } from "../port/reportPortFailure";
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
  const { state, dispatch, files, activeFile, reload } = useShell();
  const open = state.openFileIds
    .map((id) => files.find((file) => file.id === id))
    .filter((file): file is FileMeta => Boolean(file));

  const dirty = activeFile?.dirty ?? false;

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
              <button
                type="button"
                className="shell-tab-close"
                aria-label={`Close ${file.name}`}
                title="Close"
                onClick={() => dispatch({ type: "close-file", fileId: file.id })}
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
            await port.files.save(activeFile.id);
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
            notBuiltYet("share", "Sharing a file from OfficeDex is not built yet. The file is on this computer — send it however you normally would.")
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
          <button
            type="button"
            className="shell-icon-button"
            aria-label="More actions"
            title="More"
            onClick={() => notBuiltYet("file-more-actions", "This menu has no actions in it yet.")}
          >
            <MoreHorizontal size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

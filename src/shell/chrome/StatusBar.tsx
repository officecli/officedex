import { HardDrive, Minus, Plus } from "lucide-react";

import type { FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { notBuiltYet } from "../port/reportPortFailure";

/** Per-format facts on the left, device and zoom on the right. */
function detailFor(file: FileMeta): string[] {
  if (file.type === "sheet") return ["Sheet 1 of 1", "B6"];
  if (file.type === "slides") return ["Slide 3 of 6", "Notes"];
  return ["Page 1 of 1", "739 words", "English (US)"];
}

export function StatusBar() {
  const { activeFile } = useShell();

  return (
    <div className="shell-statusbar shell-region">
      <div className="shell-statusbar-facts">
        {activeFile ? (
          detailFor(activeFile).map((entry) => <span key={entry}>{entry}</span>)
        ) : (
          <span>No file open</span>
        )}
      </div>

      <div className="shell-statusbar-end">
        <span className="shell-device">
          <HardDrive size={13} strokeWidth={1.7} aria-hidden="true" />
          On this computer
        </span>
        <span>{activeFile?.dirty ? "Unsaved changes" : "All changes saved"}</span>
        <span className="shell-zoom">
          {/* Zoom belongs to whichever canvas is mounted, and the canvas
              contract has no method for it. Both controls say so. */}
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => notBuiltYet("zoom", "Zoom is not wired to the editors yet. Use the editor's own zoom for now.")}
          >
            <Minus size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span className="shell-zoom-value">100%</span>
          <button
            type="button"
            className="shell-icon-button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => notBuiltYet("zoom", "Zoom is not wired to the editors yet. Use the editor's own zoom for now.")}
          >
            <Plus size={13} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </span>
      </div>
    </div>
  );
}

import { FileTypeIcon } from "../chrome/FileTypeIcon";
import type { FileType } from "../../shared/uiPort";

const PROMPTS: Array<{ type: FileType; label: string; prompt: string }> = [
  { type: "doc", label: "Write a document", prompt: "Draft a product launch plan from the files in this folder." },
  { type: "sheet", label: "Analyse a workbook", prompt: "Check the sales forecast: revenue, cost and gross profit." },
  { type: "slides", label: "Build a presentation", prompt: "Prepare a launch presentation from the plan and the forecast." },
];

export interface QuickPromptsProps {
  /** Puts the suggestion in the composer. Never sends it. */
  onPick: (prompt: string) => void;
}

/**
 * The three starting points under the hero.
 *
 * They fill the composer rather than starting a run. A suggestion is a draft of
 * the user's intent, not the intent itself — "Write a document" with no idea
 * which document is not a task anyone meant to start, and sending on click
 * meant the only way to correct it was to stop a run that had already begun.
 */
export function QuickPrompts({ onPick }: QuickPromptsProps) {
  return (
    <div className="shell-hero-prompts">
      {PROMPTS.map((entry) => (
        <button
          key={entry.type}
          type="button"
          className="shell-hero-prompt"
          onClick={() => onPick(entry.prompt)}
        >
          <FileTypeIcon type={entry.type} size={15} />
          {entry.label}
        </button>
      ))}
    </div>
  );
}

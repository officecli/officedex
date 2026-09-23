import { FileTypeIcon } from "../chrome/FileTypeIcon";
import type { FileType } from "../../shared/uiPort";

/**
 * Self-contained starting points: each names what to make, never what to read.
 *
 * These used to point at the seed fixture's documents — "from the files in this
 * folder", "the sales forecast", "from the plan and the forecast". In the
 * workspace those files exist and the phrasing reads naturally; in a real one
 * they are dangling references to documents nobody has. A run given them has
 * nothing to work from and says so in the only way it can: one asking for a
 * launch deck came back with two slides, having invented the few facts it
 * could.
 *
 * So each prompt now carries its own structure — the sections to produce, not
 * the sources to consult. That is also what gives a model enough to expand: a
 * bare "write a document" is as empty as a reference to a file that is not
 * there. Pointing a task at real files is the `@` menu's job, and the composer
 * placeholder already says so; guessing filenames here can only ever be wrong
 * outside the fixture.
 *
 * No test guards the wording — a blocklist of today's three bad phrases would
 * be a fake gate, and the property that matters (does this make sense in an
 * empty workspace?) is not one an assertion can check. Read it before editing.
 */
export const PROMPTS: Array<{
  type: FileType | "image";
  label: string;
  prompt: string;
}> = [
  {
    type: "doc",
    label: "Write a document",
    prompt: "Draft a project plan covering goals, milestones, owners and risks.",
  },
  {
    type: "sheet",
    label: "Analyze a spreadsheet",
    prompt: "Build a quarterly budget with revenue, cost and gross margin by month.",
  },
  {
    type: "slides",
    label: "Create a presentation",
    prompt: "Prepare a product launch presentation covering positioning, timeline and next steps.",
  },
  {
    type: "image",
    label: "Create an image",
    prompt: "Create a clean editorial image for a product launch.",
  },
];

export interface QuickPromptsProps {
  /** Puts the suggestion and its output type in the composer. Never sends it. */
  onPick: (prompt: string, type: FileType) => void;
  /** Whether the composer is in image mode — "Create an image" shows as pressed. */
  imageSelected: boolean;
  /**
   * "Create an image" is a mode, not a sentence: it switches the composer to
   * image and keeps whatever is typed. Pressed again, it switches back.
   */
  onToggleImage: () => void;
}

/**
 * The starting points under the hero.
 *
 * They fill the composer rather than starting a run. A suggestion is a draft of
 * the user's intent, not the intent itself — "Write a document" with no idea
 * which document is not a task anyone meant to start, and sending on click
 * meant the only way to correct it was to stop a run that had already begun.
 *
 * The type travels with the words. It used to be left for the runtime to infer
 * from the sentence, and the sentence under "Write a document" contains no word
 * the inference recognises — so the button labelled with a document glyph fell
 * through to the settings default and produced a presentation.
 */
export function QuickPrompts({ onPick, imageSelected, onToggleImage }: QuickPromptsProps) {
  return (
    <div className="shell-hero-prompts">
      {PROMPTS.map((entry) => (
        <span key={entry.type} className="shell-hero-prompt-group">
          {entry.type === "image" ? (
            <button
              type="button"
              className={`shell-hero-prompt${imageSelected ? " is-selected" : ""}`}
              aria-pressed={imageSelected}
              onClick={onToggleImage}
            >
              <FileTypeIcon type="image" size={15} />
              {entry.label}
            </button>
          ) : (
            <button
              type="button"
              className="shell-hero-prompt"
              onClick={() => onPick(entry.prompt, entry.type as FileType)}
            >
              <FileTypeIcon type={entry.type} size={15} />
              {entry.label}
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

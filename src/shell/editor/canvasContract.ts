/**
 * The canvas slot contract.
 *
 * Word/Excel/PowerPoint rendering is deliberately *not* part of `UiPort`: it is
 * not a service call but a component the shell gives a box to. During
 * standalone UI development no adapter is registered and the host draws a
 * skeleton; at integration the desktop app registers an adapter that mounts
 * writer-component / @shimo/sdk-sheet / presentation-component into the host.
 *
 * The contract is shaped by decision 4: the host element outlives every mode
 * change, Home visit and tab switch, so an adapter is mounted once and told
 * about changes — it is never torn down and rebuilt to reflect a layout change.
 */

import type { FileMeta } from "../../shared/uiPort";

/** A span the user selected inside the document, offered to the agent as a reference. */
export interface CanvasSelection {
  fileId: string;
  /** Human label for the reference chip, e.g. "MO launch plan.docx · Heading". */
  label: string;
  /**
   * The selected words — **empty until they are needed**.
   *
   * Editors report *that* the selection changed far more cheaply than they
   * report *what* it says: Writer pushes a summary (a caret? how many
   * paragraphs?) on every cursor move, while the text costs a round trip into
   * the embed that also re-targets the editor's one tracked edit scope. So the
   * push carries the label and `resolveSelection` fetches the text at the
   * moment the message is actually sent.
   */
  text: string;
}

/**
 * A proposed change, shown *inside* the document rather than only in the panel.
 *
 * The prototype put the draft where the change would land — a block inserted
 * after the referenced paragraph, with Apply and Discard on it — so the user
 * read the proposal in the place it affects instead of comparing a panel
 * summary against a document across the window.
 *
 * **This part of the contract has no implementation yet.** The shell cannot
 * draw inside a mounted editor, so only an adapter can honour it, and none
 * does; the two methods are optional and the suggestion stays in the panel
 * where an adapter cannot show it. The shape is a proposal to whoever wires
 * the editors up — it is small on purpose (one text, one target, one action)
 * because every editor would have to implement it and docx, xlsx and pptx
 * agree on very little.
 */
export interface CanvasDraft {
  suggestionId: string;
  fileId: string;
  /** What the agent proposes, as text. */
  text: string;
  /** The span the run was given, when it was given one. */
  reference?: CanvasSelection;
}

/** What an in-place edit is doing right now, for the conversation to show. */
export type DocumentEditPhase = "reading" | "drafting" | "applying" | "saving";

/**
 * An instruction aimed at the document already open in the canvas.
 *
 * This is the other way to change a file, and the one that belongs to the
 * editor rather than to the generation runtime. `agent.send` with an
 * `activeFileId` re-runs the whole document through the model and hands back a
 * *new* file to overwrite the old one with; that is right for "rewrite this as
 * a board memo" and absurd for "make the second paragraph shorter", which it
 * answers by regenerating several thousand words and clobbering the copy the
 * user has open and has been typing into.
 *
 * So: exact replacements, planned by the model and applied by the editor, in
 * the document on screen. The user sees the change land where they are looking,
 * and the editor's own undo stack is still theirs.
 */
export interface DocumentEditRequest {
  instruction: string;
  /**
   * Narrow the edit to whatever the user has selected, when they have selected
   * something. False edits the whole document.
   */
  preferSelection: boolean;
  /** Progress, so a run that takes twenty seconds does not look like a hang. */
  onPhase?(phase: DocumentEditPhase): void;
  signal?: AbortSignal;
}

export interface DocumentEditResult {
  /** What the agent says it did, in the UI language. Shown verbatim. */
  summary: string;
  /**
   * How many replacements landed in the document.
   *
   * Zero is a legitimate outcome, not a failure: the model returns no edits
   * when it needs a clarification or when the request asks for something it
   * cannot do, and says which in `summary`. A caller must not report "applied"
   * on the strength of having been given a summary.
   */
  applied: number;
  /**
   * Why the file could not be written, when the changes landed but the save
   * did not — null when it was saved, or when there was nothing to save.
   *
   * These are two different states and collapsing them loses the user's work.
   * A save that fails after the edit has been applied leaves the document
   * genuinely changed in the editor and genuinely unchanged on disk; reporting
   * that as a plain failure tells the user nothing happened while their
   * document sits there modified and unsaved. The observed case is the Writer
   * embed's DOCX export failing, which has nothing to do with whether the
   * replacements worked.
   */
  saveError: string | null;
  /**
   * Undoes exactly this edit, or null when it can no longer be undone.
   *
   * Reports its own save failure rather than throwing one, for the reason
   * `saveError` exists: by the time the write is attempted the document has
   * already been put back, and an exception would describe that as a failed
   * undo. It still *throws* when it refuses outright — when the text it would
   * search for is no longer there to find — because then nothing changed and
   * there is nothing to report but the refusal.
   */
  undo: (() => Promise<{ saveError: string | null }>) | null;
  /** Which part of the document was rewritten, for the conversation to name. */
  scope: "selection" | "document";
}

export interface CanvasAdapter {
  /** Called once, with the persistent host element. */
  mount(host: HTMLElement): void | Promise<void>;
  /** The visible file changed, or became visible again after Home. */
  show(file: FileMeta): void;
  /** The workspace is hidden (Home). The adapter keeps its state. */
  hide(): void;
  /** Called only when the shell itself is torn down. */
  unmount(): void;
  /** Selection changes drive the agent's reference chip. Returns unsubscribe. */
  onSelection(listener: (selection: CanvasSelection | null) => void): () => void;
  /**
   * The current selection, text included, read once because it is about to be
   * sent. Optional: without it the reference travels as a label alone.
   *
   * Separate from `onSelection` because it is not free. In Writer it is
   * `capture("selection")`, which tracks a range for a later `apply` and
   * *replaces* whatever was tracked before — running it on every cursor move
   * would expire the scope an in-flight agent edit is holding. Calling it when
   * the user presses Send is both the cheapest and the most correct moment:
   * one call, and the scope it leaves behind belongs to the message that is
   * going out.
   *
   * Rejections are the caller's to swallow: a reference that could not be read
   * must not stop the message.
   */
  resolveSelection?(): Promise<CanvasSelection | null>;
  /**
   * Writes the open document back to disk.
   *
   * The editor is the only thing that has the bytes — `files.save` on the port
   * clears the dirty flag and writes nothing, which is fine while the canvas is
   * a skeleton and a lie the moment a real editor is mounted. The shell saves
   * by calling this first and the port second.
   */
  save(): Promise<void>;
  /**
   * The open document became dirty, or stopped being. Returns unsubscribe.
   *
   * Symmetric with `onSelection`, and for the same reason: the editor is the
   * only thing that knows. Nothing else in the app can tell that a user typed.
   */
  onDirtyChange(listener: (dirty: boolean) => void): () => void;
  /**
   * Show, replace or remove the in-document draft. Optional: an editor that
   * cannot render one leaves it out, and nothing else changes.
   */
  showDraft?(draft: CanvasDraft | null): void;
  /**
   * Rewrites part of the open document in place, or null-ish (absent) when the
   * mounted editor cannot.
   *
   * Only Word implements it today. A deck's editor has no equivalent of
   * "replace exactly this text with exactly that", and a workbook's changes are
   * cell values rather than prose, so both leave it out and their instructions
   * keep going to the generation runtime.
   */
  editDocument?(request: DocumentEditRequest): Promise<DocumentEditResult>;
  /**
   * Whether `editDocument` would work *right now*.
   *
   * Separate from the method's presence because the adapter is one object for
   * the life of the shell while the editor under it changes with every tab: the
   * method exists whether or not a Word document happens to be open, and a
   * caller deciding how to route a message has to be able to ask about the
   * document on screen rather than about the adapter.
   */
  canEditDocument?(): boolean;
  /**
   * The user acted on the draft from inside the document. Returns unsubscribe.
   *
   * Only `apply` for now: it is the one action the port can carry out
   * (`agent.applySuggestion`). A Discard would be a local dismissal the
   * service layer has no notion of, and inventing one here would make the
   * document offer something the rest of the app cannot honour.
   */
  onDraftAction?(listener: (action: "apply") => void): () => void;
}

/** What the shell offers an adapter; set by the host at integration time. */
export type CanvasAdapterFactory = () => CanvasAdapter;

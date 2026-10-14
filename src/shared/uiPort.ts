/**
 * UiPort — everything the shell needs from the outside world, and nothing more.
 *
 * This is the contract between the UI layer (`src/shell`) and the service layer
 * (`src/services`). It lives in `src/shared` because neither side owns it: the
 * same reason `types.ts` does, which is the contract between the renderer and
 * Go. The shell is built and tested against it with an in-memory fake
 * (`src/shell/port/fake/createFakePort.ts`); the service layer implements it
 * directly — there is no adapter and no second domain model.
 *
 * Deliberately NOT reused: this directory's own `types.ts` / `DesktopAPI`. That
 * is a ~120-method interface shaped by the old IA; adopting it would re-import
 * the assumptions this refactor exists to discard. Which of its capabilities
 * survive, and which new Ports they need, is settled in docs/uiport-scope.md.
 *
 * Deliberately NOT in this port: the document canvas. Word/Excel/PowerPoint
 * rendering is a *slot*, not a service call — see
 * `src/shell/editor/canvasContract.ts`.
 */

/* ------------------------------------------------------------------ files */

/**
 * `image` is a generated picture (`img` on the desktop side). It opens in a
 * viewer, not an editor: nothing creates a blank one, and nothing edits one in
 * place.
 */
import type { FileFailure } from "./fileFailure";

export type FileType = "doc" | "sheet" | "slides" | "image";

/**
 * Decision 3: a folder is a real directory, named "folder" everywhere —
 * in the UI, in this contract, and in the data model. There is no nesting and
 * no multi-parent; a file belongs to exactly one folder.
 *
 * "Recent" is NOT a folder. It is a time-ordered *view* over every file, and
 * it is not a drop target. Files that the user has not filed anywhere live in
 * the folder flagged `isDefault`, which is a real directory like any other.
 */
export interface Folder {
  id: string;
  name: string;
  /** Absolute path on disk. The shell shows it; it never parses it. */
  path: string;
  /** Where new files land when the user has not chosen a folder. Exactly one. */
  isDefault?: boolean;
}

export interface FileMeta {
  id: string;
  name: string;
  type: FileType;
  /** Never null — see the note on `Folder`. */
  folderId: string;
  createdAt: number;
  updatedAt: number;
  /** null when the file has never been opened in this workspace. */
  lastOpenedAt: number | null;
  /** Drives the tab dot and the "Unsaved changes" status-bar state. */
  dirty: boolean;
  /**
   * The last open or save that did not go through, until one does.
   *
   * `dirty` says the editor holds changes; this says the disk refused them, or
   * the editor could not read the file at all. The two are independent: a
   * failed save leaves the file both dirty and failed, and "Saved" is never
   * shown while this is set. Session state, like `dirty`, for the same reason.
   */
  failure?: FileFailure;
  /** Decision 2: a filter on the one file list, not a separate location. */
  pinned: boolean;
  /** Set for artifacts produced by an agent task; used to open the result when the task completes. */
  artifactTaskId?: string;
  /**
   * The conversation that first brought this file into its project — by
   * generating it or by adding it — when the workspace recorded one. It is a
   * statement of origin ("From chat"), not of access: every conversation in
   * the project can use the file whatever this says.
   */
  originConversationId?: string;
}

export interface FolderPort {
  list(): Promise<Folder[]>;
  create(name: string): Promise<Folder>;
  rename(id: string, name: string): Promise<void>;
  /** Files in a removed folder move to the default folder; they are not deleted. */
  remove(id: string): Promise<void>;
}

/** Where a file dropped from the operating system landed, in viewport CSS pixels. */
export interface FileDropPoint {
  x: number;
  y: number;
}

export interface FilePort {
  list(): Promise<FileMeta[]>;
  create(type: FileType, folderId: string): Promise<FileMeta>;
  /**
   * Adds a file the user already had, through the system picker.
   *
   * Resolves to null when they cancel — an ordinary thing to do, not an error.
   * The file is neither copied nor moved: the library points at wherever they
   * keep it, so it arrives in the default folder rather than claiming to be
   * inside one of the app's directories. Opening the same file twice returns the
   * entry that already exists.
   */
  openFromDisk(): Promise<FileMeta | null>;
  /**
   * Adds a file the user dragged onto the window. Same rules as `openFromDisk`
   * — not copied, lands in the default folder, one path is one entry — but it
   * rejects instead of returning null, because a drop cannot be "cancelled":
   * anything that is not a Word, Excel or PowerPoint file is an error to show.
   */
  openDropped(path: string): Promise<FileMeta>;
  /**
   * Files dropped onto the window from the operating system.
   *
   * Only drops that land on an element carrying `--wails-drop-target: drop`
   * are reported; everywhere else the drop is swallowed so the webview never
   * navigates to the file. Every subscriber hears every drop, so `point` —
   * where it landed, in viewport CSS pixels, when the runtime says — is how a
   * zone tells whether the drop was its own. See `shell/dropZone.ts`.
   * Returns the unsubscribe.
   */
  onDropFromDisk(callback: (paths: string[], point?: FileDropPoint) => void): () => void;
  /** Records `lastOpenedAt`. The shell owns which tabs are open, not the port. */
  open(id: string): Promise<FileMeta>;
  move(id: string, folderId: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<FileMeta>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  /**
   * Marks the open document as having unsaved changes, or not.
   *
   * Called by whatever is editing it — the canvas adapter — not by the shell's
   * own controls. `FileMeta.dirty` is what the tab dot, the status bar and the
   * save button read, and until this existed nothing in production could make it
   * true: the flag was unreachable state.
   *
   * Deliberately not persisted. An editor session's unsaved state does not
   * survive a crash, and a file permanently marked dirty after one would be
   * worse than forgetting.
   */
  setDirty(id: string, dirty: boolean): Promise<void>;
  /**
   * Records that the file is in a saved state.
   *
   * The shell calls this only after the editor's own write has resolved, so a
   * port that implements it by clearing the flag is not lying — the bytes are
   * already on disk. Clears `failure` for the same reason.
   */
  save(id: string): Promise<void>;
  /**
   * Records why the last open or save failed, or null once it has succeeded.
   * Session state, like `dirty`; see `FileMeta.failure`.
   */
  setFailure?(id: string, failure: FileFailure | null): Promise<void>;
  remove(id: string): Promise<void>;
  /** Resolves the real local path when the runtime can expose one safely. */
  pathOf?(id: string): Promise<string>;
}

/* ------------------------------------------------------------------ agent */

export type AgentStatus =
  | "idle"
  | "reading"
  | "writing"
  | "working"
  | "paused"
  | "awaiting-review"
  | "done";

export interface AgentStep {
  id: string;
  label: string;
  state: "done" | "active" | "pending";
}

/** A quoted span the user sent along with a message, captured from the canvas. */
export interface AgentReference {
  fileId: string;
  /** Human label for the reference chip, e.g. "MO launch plan.docx · Heading". */
  label: string;
  text: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  reference?: AgentReference;
  createdAt: number;
}

/**
 * A proposed or applied change. Review waits for the user's Apply; Full access
 * may apply through the same save bridge after execution succeeds. Completion
 * of the worker alone is never evidence that the source file was updated.
 */
export interface AgentSuggestion {
  id: string;
  targetFileId: string;
  summary: string;
  applied: boolean;
  /**
   * The user approved this change — with Review's Apply, or the editor's own
   * review before an in-place edit. Absent or false, it may have been applied
   * without asking (Full access), and nothing may say "the changes you
   * approved" (1.0.34 N34-05).
   */
  confirmed?: boolean;
  /** False once the target file changed after Apply — Undo is then refused. */
  undoable: boolean;
}

export interface AgentQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

/**
 * The run is blocked until someone answers.
 *
 * Not a message. A message is something the agent said; this is a door it is
 * standing behind. The shell showed questions as plain replies and offered no
 * way through — typing into the composer started a *second* run while the first
 * stayed blocked forever, which is worse than a button that does nothing.
 */
export interface AgentQuestion {
  /** Concrete proposed edits; only the Review Apply action may approve these. */
  changes?: Array<{ before: string; after: string }>;
  id: string;
  text: string;
  /**
   * What the runtime says this question is, when it has a UI of its own.
   * `"pptx_outline_gate"` is the deck's one blocking stop; the panel draws the
   * editable outline for it rather than a plain question card.
   */
  kind?: "pptx_outline_gate" | string;
  /**
   * What exactly is being confirmed, as label and value pairs.
   *
   * A confirmation with nothing to read is not one: the deck brief used to
   * arrive as a sentence and a Start button (UX30-05). Absent for a question
   * that is its own content.
   */
  details?: Array<{ label: string; value: string }>;
  options: AgentQuestionOption[];
  /** The runtime accepts typed text as well as one of the options. */
  allowFreeform: boolean;
}

export const OUTLINE_GATE_KIND = "pptx_outline_gate";
/** The deck brief the runtime inferred, put to the user before the outline is drafted. */
export const BRIEF_KIND = "pptx_brief";

/**
 * One page of a deck being written, as the task panel lists it.
 *
 * The outline belongs beside the conversation, not on the canvas. A run's plan
 * is something to read and talk about; the canvas is where the document itself
 * goes. Carrying it here is what lets the panel show what the agent is working
 * through while the editor shows the thing being worked on.
 *
 * Title and state only — the runtime's per-page description is a paragraph, and
 * a 320px column that has to hold eight of them stops being a list of pages.
 */
export interface AgentOutlinePage {
  /** 1-based, as the runtime numbers slides. */
  slide: number;
  title: string;
  /** Null until the runtime has said anything about this page. */
  state: "queued" | "generating" | "repairing" | "ready" | "failed" | "canceled" | null;
}

/**
 * How a run that is over ended.
 *
 * `AgentStatus` has one word for "not running any more" — `done` — and a run
 * that failed, one the user stopped and one that finished all report it. The
 * conversation has to tell those apart: they offer different ways forward
 * (Retry, Resume, Open) and only one of them is a success.
 */
/**
 * `rejected` is a decision, not an interruption: the user turned a proposed
 * change down in Review and the original file is as it was. It is kept apart
 * from `stopped` because nothing is left to continue (UX30-02).
 */
export type AgentOutcome = "completed" | "failed" | "stopped" | "partial" | "interrupted" | "rejected";

export interface AgentTask {
  /** Worker artifact, independent of whether the current library page lists it. */
  artifact?: { path: string; name?: string } | null;
  /** Earlier result cards in this conversation, retaining task-specific recovery actions. */
  history?: AgentTask[];
  noChanges?: boolean;
  /** Stable user request identity; id is the current execution attempt. */
  logicalTaskId?: string;
  id: string;
  title: string;
  /** The source file remains visible in task details even when editing fails. */
  targetFileName?: string;
  /**
   * The conversation this run belongs to.
   *
   * A follow-up message is a new run in the same conversation, so `id` moves
   * to the newest run while this stays put. `messages` covers the whole
   * conversation, not just this run. Optional because a fake or a record from
   * before conversations were tracked has none; absent reads as "this run is
   * its own conversation".
   */
  conversationId?: string;
  /** Decision 2: a task is scoped to a folder, not to a single file. */
  folderId: string;
  /** The runtime document kind, when known. Used to expose type-specific controls. */
  documentType?: "docx" | "xlsx" | "pptx" | "img";
  status: AgentStatus;
  /** Free-text phase shown next to the active step, e.g. "Reading project files". */
  phase: string;
  steps: AgentStep[];
  messages: AgentMessage[];
  /**
   * The pages this run is writing.
   *
   * Optional rather than an always-present array: most runs have no page-level
   * plan at all (a document, a workbook, anything before the outline lands),
   * and a task record written before this field existed is still a valid task.
   * Absent and empty mean the same thing to a reader — there is no page list to
   * show — so consumers can treat them alike.
   */
  outline?: AgentOutlinePage[];
  /**
   * The input file this run was pointed at, when the request named one.
   *
   * What "Choose another file" replaces: the card shows the old name beside
   * the new one, and can tell when the file picked is the same unreadable one.
   */
  inputFile?: { name: string; fileId?: string; path?: string };
  suggestion: AgentSuggestion | null;
  /** Set while the run is waiting for an answer; null the rest of the time. */
  question: AgentQuestion | null;
  /** Set once the run is over. Absent while it runs, and on a record that predates it. */
  outcome?: AgentOutcome;
  /** Why the run did not finish, in the runtime's words. */
  error?: string;
  /** Raw diagnostic text, shown only in task Details. */
  errorDetail?: string;
  /**
   * What kind of thing went wrong, when the runtime said. `model` failures are
   * the ones a trip to Settings → Models can fix; `input` ones need a different
   * file, not the same request again.
   */
  failureKind?: "model" | "network" | "input" | "other";
  /** Epoch ms the newest attempt started, and when it ended. */
  startedAt?: number;
  finishedAt?: number;
  /** 1 for a first run; a retry or a resume of the same request counts up. */
  attempt?: number;
  /**
   * Set when a run failed but left finished pages it can pick up from.
   *
   * Absent for every other task, including failures with nothing to resume:
   * offering "retry the rest" there would promise work the runtime refuses.
   */
  recovery?: AgentRecovery;
  /**
   * The picture this task is making, when it is an image task.
   *
   * An image is not edited in place: every change is a new run that produces a
   * new file, and the earlier file stays. So one image task is a *series* of
   * runs, and each finished run is a version. The runtime ties them together
   * with a conversation id; this is that conversation, oldest run first.
   */
  image?: AgentImageSeries;
  /**
   * Messages waiting for this conversation's live run to end, oldest first.
   *
   * One run at a time per conversation: a message typed while one is under
   * way is held by the port and sent, as typed, when the run is over. Absent
   * when nothing waits. Each is also in `messages`, so the thread reads in
   * order; this is what lets the card say "Queued".
   */
  queued?: AgentQueuedMessage[];
  batch?: Array<{ fileId: string; name: string; taskId?: string; status: "queued" | "running" | "completed" | "failed" | "stopped"; error?: string; errorDetail?: string; suggestion: AgentSuggestion | null }>;
}

export interface AgentQueuedMessage {
  /** Matches the message's id in `AgentTask.messages`. */
  id: string;
  text: string;
}

export interface AgentRecovery {
  /** Pages whose content is finished. Absent when the runtime did not say. */
  readyPages?: number;
  totalPages?: number;
}

export interface AgentImageSeries {
  runs: AgentImageRun[];
}

export interface AgentImageRun {
  /** Matches `FileMeta.artifactTaskId` of the file the run produced. */
  taskId: string;
  status: "running" | "done" | "failed" | "cancelled";
  /** What the user asked this run for, as typed. */
  prompt: string;
  /** The run whose picture this one started from, when it was a change to a version. */
  baseTaskId?: string;
  /** Set when the run failed and the runtime said why. */
  error?: string;
}

export type AgentEvent =
  /**
   * `focused` is false when the run is not the head of the conversation its
   * folder's panel shows — a run in another conversation, or an older run of
   * this one. Lists and artifact handling want every run; the panel wants only
   * the focused ones. Absent means the port does not distinguish.
   */
  | {
      kind: "task";
      task: AgentTask;
      focused?: boolean;
      /**
       * The file whose bytes on disk this event just replaced — an applied
       * suggestion, or one taken back. An editor holding that file is showing
       * what it loaded, not what is there now, and has to be rebuilt (UX30-01).
       */
      fileChanged?: string;
    }
  /** The folder's panel was reset to an empty, new conversation. */
  | { kind: "cleared"; folderId: string }
  | { kind: "error"; message: string }
  /**
   * A limitation worth saying out loud — not a failure. The run went ahead;
   * part of what was asked for could not be carried. Sent when the composer
   * gathers something the agent cannot use yet, so an attachment that had no
   * effect does not look like one that silently failed.
   */
  | { kind: "notice"; message: string };

export interface Mention {
  kind: "file" | "folder";
  id: string;
  label: string;
}

export interface Attachment {
  id: string;
  name: string;
  /** Bytes; the shell enforces its own ceiling before calling the port. */
  size: number;
  /** Absolute path when selected through the native desktop picker. */
  path?: string;
  /** Set for an uploaded folder; the shell shows the count. */
  fileCount?: number;
}

/** The file a failed request should be retried with: one from the library, or one on disk. */
export type InputFileReplacement = { fileId: string } | { path: string; name: string };

export interface SendInput {
  pptxTemplate?: { id: string; version: number; localAssetDir: string };
  generationMode?: "fast" | "plan";
  text: string;
  /** The scope chip in the composer. Decision 2: scope is a property of the
   *  message being composed, not a piece of global app state. */
  folderId: string;
  mentions: Mention[];
  attachments: Attachment[];
  modelId: string;
  permission: PermissionMode;
  /** The file the user is looking at, if any. */
  activeFileId: string | null;
  reference?: AgentReference;
  /**
   * What to make, when the user said so rather than leaving it to be guessed.
   *
   * Absent means "read it off the instruction", which is what the runtime did
   * for every message before this existed — and got wrong in the one place it
   * was asked most directly: Home's "Write a document" prompt contains no word
   * the heuristic recognises, so it fell through to the settings default
   * (presentations) and the document button made a deck.
   *
   * Set, it is also a statement that this message starts something new. A
   * message sent with a document open normally edits that document; picking an
   * output type is the only way to say "not that one, a new one", and it is
   * the reason the control stays on screen while a file is open.
   */
  documentType?: "docx" | "xlsx" | "pptx" | "img";
  imageGeneration?: ImageGenerationInput;
  /**
   * Start a new conversation rather than continuing the folder's current one.
   *
   * Absent means continue: a message typed into the task panel is a follow-up
   * to what the panel shows, and the runtime is told which conversation it
   * belongs to. Home's composer always sets it — a task started from Home is a
   * new piece of work, whatever the folder did before.
   */
  newConversation?: boolean;
  /**
   * The conversation this message belongs to, when the shell addresses one
   * rather than leaving the folder's panel to say.
   *
   * A conversation the port has runs for is continued; one it has never heard
   * of is started under that id — the shell hands out ids before a word is
   * spoken, so a named empty chat, or the conversation a Local document owns,
   * keeps its identity from the moment it exists to its first run. Set, it
   * wins over the folder's current conversation and over `newConversation`.
   */
  conversationId?: string;
}

export interface ImageGenerationInput {
  modelId: string;
  ratio: "auto" | "1:1" | "3:4" | "4:3" | "16:9" | "9:16" | "2:3" | "3:2" | "21:9" | "custom";
  resolution: "1K" | "2K" | "4K";
  count: number;
  width?: number;
  height?: number;
  style: "auto" | "photo" | "cinematic" | "illustration" | "3d" | "minimal";
  /** Null or absent: no camera look was asked for. */
  camera?: ImageCameraSettings | null;
  /** Local paths of reference pictures, in the order they were added. At most four. */
  references?: string[];
  /**
   * The version this message changes, as a file id.
   *
   * Its picture goes to the runtime as the first reference, and the new run
   * joins the same series, so the result shows up as the next version rather
   * than as an unrelated image.
   */
  baseFileId?: string;
  prompt: string;
}

export interface ImageCameraSettings {
  body: string;
  lens: string;
  focal: string;
  aperture: string;
}

/**
 * What the image surfaces need beyond files and tasks: pixels and the system's
 * own pickers. Optional on `UiPort` because a plain browser has none of it.
 */
export interface ImagePort {
  /**
   * System picker for reference pictures. Null when cancelled; absent where
   * there is no system picker, and the caller falls back to a file input.
   */
  pickReferences?(): Promise<string[] | null>;
  /**
   * Turns a picture that has no path — dropped from a browser, pasted — into a
   * local file the runtime can read, and returns its path.
   */
  importReference(file: File): Promise<string>;
  /** Bytes of a local picture, for a thumbnail. */
  readPath(path: string): Promise<Blob>;
  /** Bytes of a picture in the library. */
  readFile(fileId: string): Promise<Blob>;
  /** Saves a copy through the system save dialog. Resolves to where, or null when cancelled. */
  saveCopy(fileId: string): Promise<string | null>;
}

/**
 * One row of Home's task list.
 *
 * Deliberately not an `AgentTask`: the list shows every folder's recent work,
 * and a full task carries its whole message history and suggestion state. Home
 * needs a title, where it happened and how it is going — pulling the transcript
 * of a dozen finished runs to render a dozen rows is the kind of thing that is
 * cheap with three tasks and unusable with three hundred.
 */
export interface AgentTaskSummary {
  outcome?: AgentOutcome;
  id: string;
  title: string;
  /** One row per conversation; see `AgentTask.conversationId`. */
  conversationId?: string;
  folderId: string;
  status: AgentStatus;
  /** Free-text phase, same as `AgentTask.phase`. Shown as the row's subtitle. */
  phase: string;
  /**
   * Epoch ms of the last change, when the runtime knows it.
   *
   * Optional because the desktop's task records do not all carry a timestamp.
   * The port returns rows already ordered; this is for display and for merging
   * live updates, not for the caller to sort by.
   */
  updatedAt?: number;
  /**
   * Set when the task makes a picture. One row stands for the whole series —
   * every version of it — so four versions are one line on Home, not four; the
   * row's `id` is the series' first run, which does not change as versions
   * are added.
   */
  image?: AgentImageSeries;
  /**
   * The id of every run in this conversation, oldest first, when the port
   * tracks runs. `id` is the conversation's, which is also the *first* run's
   * id — so a file stamped with a later run's `artifactTaskId` matched
   * nothing until this existed.
   */
  runTaskIds?: string[];
}

export interface AgentPort {
  /** The task for a folder, or null when none has been started there. */
  current(folderId: string): Promise<AgentTask | null>;
  /**
   * Recent tasks across every folder, newest first. Home's "Continue working".
   *
   * Separate from `current` because Home is not scoped: a run started in one
   * folder is still the thing the user was doing, and scoping the list to the
   * folder chip would hide it the moment they switched. Includes finished runs
   * — "what was I doing" is mostly a question about work that already stopped.
   */
  list(options?: { limit?: number; individualRuns?: boolean }): Promise<AgentTaskSummary[]>;
  send(input: SendInput): Promise<void>;
  /**
   * Answers the pending question and lets the run continue.
   *
   * Separate from `send` because they are different acts: `send` asks for work,
   * this unblocks work already under way. Routing an answer through `send`
   * starts a second run and leaves the first one waiting.
   *
   * `outline` is the deck's plan as the user left it, and only the outline gate
   * sends one. That gate exists because the outline is the last point where a
   * change costs nothing — everything after it rewrites whole pages — so a gate
   * that can only be approved is a pause that buys nothing. Order is the array's
   * order and a page left out is a page dropped, which is how the runtime reads
   * a decision; the shell hands over the list and lets the service put it on the
   * wire, rather than assembling the runtime's payload shape itself.
   */
  answer(input: {
    optionId?: string;
    text?: string;
    outline?: readonly AgentOutlinePage[];
  }): Promise<void>;
  /** Push channel for phase/step/message/suggestion updates. Returns unsubscribe. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /**
   * Ends the task; leaves applied changes in place.
   *
   * `taskId` names the run to end. Without it the port ends whatever it
   * considers live, which is right for a composer's Stop and wrong for a
   * card's: the card knows which run it is showing.
   */
  finish(taskId?: string): Promise<void>;
  retry?(taskId: string): Promise<void>;
  /**
   * Runs a failed request again with its unreadable input file swapped for
   * another one (UX30-03). The request itself — its words, its mode, its
   * conversation — is the original's; only the file changes, and the run is
   * the next attempt of the same task rather than a new message.
   */
  retryWithFile?(taskId: string, replacement: InputFileReplacement): Promise<void>;
  moveConversation?(conversationId: string, folderId: string): Promise<void>;
  retryBatch?(taskId: string): Promise<void>;
  sendQueued?(taskId: string): Promise<void>;
  removeQueued?(taskId: string, messageId: string): Promise<void>;
  /**
   * Picks a failed run up from its `recovery`: finished pages are kept and only
   * the unfinished ones are written again, as a new run.
   *
   * Takes the task id because a failed run is no longer the active one — the
   * other run verbs act on whatever is live, and nothing is.
   */
  resumeFailed(taskId: string): Promise<void>;
  rejectSuggestion?(id: string): Promise<void>;
  suggestionChanges?(id: string): Promise<Array<{ part: string; before: string; after: string }>>;
  applySuggestion(id: string): Promise<void>;
  undoSuggestion(id: string): Promise<void>;
  /**
   * Empties the folder's panel; the next message starts a new conversation.
   * Runs already under way keep going — they are just no longer what the panel
   * shows.
   */
  startConversation(folderId: string): Promise<void>;
  /**
   * Makes `conversationId` the conversation the folder's panel shows, and
   * returns it as `current` would — or null when the port knows of no such
   * conversation in that folder.
   *
   * A project holds many conversations and the sidebar lists them; picking one
   * is a statement about which thread the next message continues. Without this
   * the port went on choosing for itself (a live run, else the most recent),
   * and a message typed under an older conversation would have joined a
   * different one.
   */
  openConversation(folderId: string, conversationId: string): Promise<AgentTask | null>;
  /**
   * Adds an exchange that happened outside the runtime — an in-place edit the
   * editor carried out — to the folder's current conversation.
   *
   * Without this the conversation has holes: the panel forgets the edit as soon
   * as the next message goes to the runtime, and the runtime is never told it
   * happened.
   */
  recordExchange(input: {
    folderId: string;
    /** The conversation the edit belongs to; absent means the folder's current one. */
    conversationId?: string;
    messages: readonly AgentMessage[];
  }): Promise<void>;
}

/* ----------------------------------------------------------------- models */

export interface Model {
  id: string;
  name: string;
  provider: string;
  detail?: string;
  custom?: boolean;
  /**
   * Set on a model that exists only while it is the one in use: switching away
   * from it removes it, endpoint and key included.
   *
   * The desktop stores a single provider, so its custom entry is one of these.
   * A picker has to ask before leaving such a model — to the user it is a tick
   * moving between two rows, and to the port it is deleting a key.
   */
  removedOnSwitch?: boolean;
}

export interface CustomModelInput {
  name: string;
  /** The provider's own model identifier, e.g. "gpt-6-astra". */
  modelId: string;
  provider: string;
  baseUrl: string;
  /**
   * Never persisted by the shell. The prototype keeps user-supplied keys in
   * memory for the session only, and this contract preserves that: the port
   * decides whether and where a key is stored.
   */
  apiKey?: string;
}

export interface ModelPort {
  list(): Promise<Model[]>;
  /**
   * Makes a model the one tasks actually run on.
   *
   * `settings.selectedModelId` records what the user picked; this makes the
   * pick take effect. They were the same call until it turned out nothing read
   * the former — the composer sent a `modelId` with every message, the runtime
   * has no per-message model, and every task ran on whatever provider was
   * configured. A picker that changes a label and nothing else is worse than
   * no picker.
   */
  select(id: string): Promise<void>;
  addCustom(input: CustomModelInput): Promise<Model>;
  updateCustom(id: string, input: CustomModelInput): Promise<Model>;
  removeCustom(id: string): Promise<void>;
}

/* --------------------------------------------------------------- settings */

/** How much the agent may do before asking. Surfaced in the composer. */
export type PermissionMode = "review" | "full" | "custom";

export interface ShellSettings {
  permission: PermissionMode;
  enterToSend: boolean;
  customInstructions: string;
  reduceMotion: boolean;
  selectedModelId: string;
}

export interface SettingsPort {
  get(): Promise<ShellSettings>;
  patch(patch: Partial<ShellSettings>): Promise<ShellSettings>;
}

/* ----------------------------------------------------------------- window */

/** The desktop window controls in the top-left. No-ops in a plain browser. */
export interface WindowPort {
  close(): void;
  minimize(): void;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
}

/* ------------------------------------------------------------------- port */

export interface UiPort {
  pptxTemplates?: PptxTemplatePort;
  folders: FolderPort;
  files: FilePort;
  agent: AgentPort;
  models: ModelPort;
  settings: SettingsPort;
  window: WindowPort;
  /** Native multi-file picker, when the shell is running in the desktop app. */
  pickAttachmentPaths?: () => Promise<string[] | null>;
  images?: ImagePort;
}

/**
 * The PPT Templates skill (1.0.12 §五): a file is chosen, its name confirmed,
 * and only then learned. Choosing and learning are separate calls so the user
 * can confirm the name in between and learning can be retried from the same
 * file without choosing it again.
 */
export interface PptxTemplatePort {
  list(): Promise<import("./pptxTemplates").PptxTemplateAssetSummary[]>;
  /** The system file picker; null when cancelled. */
  pick(): Promise<PptxTemplateSource | null>;
  /** Learns a chosen file under `name`; progress arrives as it goes. */
  learn(
    input: { sourcePath: string; name: string },
    onProgress: (progress: import("./types").PptxTemplateProgress) => void,
  ): Promise<import("./pptxTemplates").PptxTemplateAssetSummary>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface PptxTemplateSource {
  path: string;
  /** The file's own name, extension included. */
  fileName: string;
}

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
  /** Decision 2: a filter on the one file list, not a separate location. */
  pinned: boolean;
  /** Set for artifacts produced by an agent task; used to open the result when the task completes. */
  artifactTaskId?: string;
}

export interface FolderPort {
  list(): Promise<Folder[]>;
  create(name: string): Promise<Folder>;
  rename(id: string, name: string): Promise<void>;
  /** Files in a removed folder move to the default folder; they are not deleted. */
  remove(id: string): Promise<void>;
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
  save(id: string): Promise<void>;
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
 * A proposed change awaiting the user's Apply. The prototype's rule is kept:
 * the agent never writes to a document without an explicit Apply, and an
 * applied change stays undoable until the document moves on beneath it.
 */
export interface AgentSuggestion {
  id: string;
  targetFileId: string;
  summary: string;
  applied: boolean;
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
  id: string;
  text: string;
  options: AgentQuestionOption[];
  /** The runtime accepts typed text as well as one of the options. */
  allowFreeform: boolean;
}

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

export interface AgentTask {
  id: string;
  title: string;
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
  suggestion: AgentSuggestion | null;
  /** Set while the run is waiting for an answer; null the rest of the time. */
  question: AgentQuestion | null;
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
  | { kind: "task"; task: AgentTask }
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

export interface SendInput {
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
  id: string;
  title: string;
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
  list(options?: { limit?: number }): Promise<AgentTaskSummary[]>;
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
  /** Ends the task; leaves applied changes in place. */
  finish(): Promise<void>;
  /**
   * Picks a failed run up from its `recovery`: finished pages are kept and only
   * the unfinished ones are written again, as a new run.
   *
   * Takes the task id because a failed run is no longer the active one — the
   * other run verbs act on whatever is live, and nothing is.
   */
  resumeFailed(taskId: string): Promise<void>;
  applySuggestion(id: string): Promise<void>;
  undoSuggestion(id: string): Promise<void>;
}

/* ----------------------------------------------------------------- models */

export interface Model {
  id: string;
  name: string;
  provider: string;
  detail?: string;
  custom?: boolean;
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

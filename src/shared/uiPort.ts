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

export type FileType = "doc" | "sheet" | "slides";

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

export interface AgentTask {
  id: string;
  title: string;
  /** Decision 2: a task is scoped to a folder, not to a single file. */
  folderId: string;
  /** The runtime document kind, when known. Used to expose type-specific controls. */
  documentType?: "docx" | "xlsx" | "pptx";
  status: AgentStatus;
  /** Free-text phase shown next to the active step, e.g. "Reading project files". */
  phase: string;
  steps: AgentStep[];
  messages: AgentMessage[];
  suggestion: AgentSuggestion | null;
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
}

export interface AgentPort {
  /** The task for a folder, or null when none has been started there. */
  current(folderId: string): Promise<AgentTask | null>;
  send(input: SendInput): Promise<void>;
  /** Push channel for phase/step/message/suggestion updates. Returns unsubscribe. */
  subscribe(listener: (event: AgentEvent) => void): () => void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Ends the task; leaves applied changes in place. */
  finish(): Promise<void>;
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
}

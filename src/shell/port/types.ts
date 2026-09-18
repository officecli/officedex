/**
 * UiPort — everything the shell needs from the outside world, and nothing more.
 *
 * This file is the UI layer's *requirement specification*. The shell is built
 * and tested against it with an in-memory fake (`./fake/createFakePort.ts`);
 * the service layer is developed independently in its own session. At
 * integration time an adapter maps the service's shape onto this interface —
 * the shell never takes a dependency on the service's shape, and vice versa.
 *
 * Deliberately NOT reused: `src/shared/types.ts`'s `DesktopAPI`. That is a
 * ~150-method interface shaped by the old IA; adopting it would re-import the
 * assumptions this refactor exists to discard.
 *
 * Deliberately NOT in this port: the document canvas. Word/Excel/PowerPoint
 * rendering is a *slot*, not a service call — see `../editor/canvasContract.ts`.
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
  /** Records `lastOpenedAt`. The shell owns which tabs are open, not the port. */
  open(id: string): Promise<FileMeta>;
  move(id: string, folderId: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<FileMeta>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  save(id: string): Promise<void>;
  remove(id: string): Promise<void>;
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
  status: AgentStatus;
  /** Free-text phase shown next to the active step, e.g. "Reading project files". */
  phase: string;
  steps: AgentStep[];
  messages: AgentMessage[];
  suggestion: AgentSuggestion | null;
}

export type AgentEvent =
  | { kind: "task"; task: AgentTask }
  | { kind: "error"; message: string };

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
}

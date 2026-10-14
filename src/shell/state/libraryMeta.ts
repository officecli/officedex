/**
 * What the user has said about their projects and conversations that the
 * workspace itself has nowhere to keep: a conversation's chosen name, whether
 * it is pinned, and what has been archived.
 *
 * The runtime records runs and the folders they ran in. It has no notion of a
 * conversation's title beyond what the first message asked for, and none of
 * pinning or archiving at all — so these live beside the view state, in this
 * window's storage, as an overlay on what the port reports. Nothing here is
 * destructive: archiving hides a row and restoring shows it again, which is
 * exactly the recoverable behaviour WORKSPACE-STANDARD §01 asks of "Delete"
 * and "Archive" alike. Files are never touched.
 *
 * Two kinds of conversation exist here before the runtime knows of them, and
 * both are why the shell hands out conversation ids itself (`newConversationId`)
 * rather than waiting for a first run to name one:
 *
 *  - **A chat that has been named but not spoken in.** `folderId` on an entry
 *    says "this conversation exists, in this project" — the sidebar lists it
 *    from here until its first run gives the port a row for it, and the first
 *    message is sent under the same id, so the row never changes identity.
 *  - **The conversation a Local document owns.** `fileId` says which. Dex over
 *    a Local file speaks for that file's conversation and no other; without
 *    this it asked the folder for "the current conversation" and got whatever
 *    ran there last, which for Local files (all in the default folder) was the
 *    previous file's thread, or Home's.
 *
 * The desktop's store accepts any conversation id on a run's first record, so an
 * id minted here becomes the runtime's the moment a message goes out. Kept here
 * rather than in the desktop store because the store exposes no conversation
 * listing to the shell, and the name, pin and archive flag the row needs are
 * already here under the same key — splitting the record would put the one fact
 * the sidebar cannot do without in a second place.
 *
 * When the service layer grows real conversation records this overlay becomes
 * a migration source, not a second truth: every entry is keyed by the ids the
 * port already uses.
 */

const KEY = "officedex.shell.library.v1";

export interface ChatMeta {
  /** Explicit references for a chat without a shared project. */
  assetIds?: string[];
  excludedAssetIds?: string[];
  name?: string;
  pinned?: boolean;
  archived?: boolean;
  /**
   * Set when the shell created this conversation before any run: the project
   * it lives in. The port's own row, once there is one, says the same thing.
   */
  folderId?: string;
  /** The Local document whose Dex this conversation belongs to. */
  fileId?: string;
  /** Epoch ms, for ordering conversations that have no run to be ordered by. */
  createdAt?: number;
  /**
   * Started from a project's New chat (or a new project) and not sent yet: it
   * lives on Home's composer until its first message is accepted (1.0.12 §一).
   * A chat with a name typed by the user is never treated as reusable.
   */
  draft?: boolean;
  /**
   * Where the user was in this conversation (1.0.12 §四): the file it last
   * showed beside it, and the reading position. Per conversation, so another
   * chat or Local never lends it theirs.
   */
  workspace?: ChatWorkspace;
}

export interface ChatWorkspace {
  fileId?: string;
  /** Pixels from the top of the transcript, when the user had scrolled up. */
  scrollTop?: number;
  /** Following the newest message; false keeps `scrollTop`. */
  followLatest?: boolean;
}

export interface ProjectMeta {
  archived?: boolean;
}

export interface LibraryMeta {
  chats: Record<string, ChatMeta>;
  projects: Record<string, ProjectMeta>;
}

export const emptyLibraryMeta: LibraryMeta = { chats: {}, projects: {} };

export function readLibraryMeta(): LibraryMeta {
  if (typeof localStorage === "undefined") return emptyLibraryMeta;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyLibraryMeta;
    const value = JSON.parse(raw) as Partial<LibraryMeta> | null;
    return {
      chats: value && typeof value.chats === "object" && value.chats ? value.chats : {},
      projects: value && typeof value.projects === "object" && value.projects ? value.projects : {},
    };
  } catch {
    return emptyLibraryMeta;
  }
}

export function writeLibraryMeta(meta: LibraryMeta): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    // View state is disposable; a full quota must not break the session.
  }
}

const compact = <T extends object>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== false && entry !== "");
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

export function patchChatMeta(meta: LibraryMeta, id: string, patch: ChatMeta): LibraryMeta {
  const next = compact({ ...meta.chats[id], ...patch });
  const { [id]: _previous, ...rest } = meta.chats;
  return { ...meta, chats: next ? { ...rest, [id]: next } : rest };
}

/** Merges into a conversation's remembered place, keeping what the patch does not name. */
export function patchChatWorkspace(meta: LibraryMeta, id: string, patch: ChatWorkspace): LibraryMeta {
  return patchChatMeta(meta, id, { workspace: { ...meta.chats[id]?.workspace, ...patch } });
}

export function patchProjectMeta(meta: LibraryMeta, id: string, patch: ProjectMeta): LibraryMeta {
  const next = compact({ ...meta.projects[id], ...patch });
  const { [id]: _previous, ...rest } = meta.projects;
  return { ...meta, projects: next ? { ...rest, [id]: next } : rest };
}

/** A conversation id minted by the shell; the runtime adopts it on the first run. */
export function newConversationId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `conv-${random}`;
}

/** The conversation a Local document owns, if one has been started for it. */
export function conversationForFile(meta: LibraryMeta, fileId: string): string | null {
  for (const [id, chat] of Object.entries(meta.chats)) {
    if (chat.fileId === fileId) return id;
  }
  return null;
}

/**
 * Conversations the shell created that the port may not have a row for yet:
 * newest first. A Local document's conversation is left out — it is the
 * document's, and shows under Dex rather than in the tree until it has run.
 */
export function shellConversations(meta: LibraryMeta): Array<{ id: string; folderId: string; meta: ChatMeta }> {
  return Object.entries(meta.chats)
    .filter((entry): entry is [string, ChatMeta & { folderId: string }] => typeof entry[1].folderId === "string" && !entry[1].fileId)
    .map(([id, chat]) => ({ id, folderId: chat.folderId, meta: chat }))
    .sort((left, right) => (right.meta.createdAt ?? 0) - (left.meta.createdAt ?? 0));
}

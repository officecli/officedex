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
 * When the service layer grows real conversation records this overlay becomes
 * a migration source, not a second truth: every entry is keyed by the ids the
 * port already uses.
 */

const KEY = "officedex.shell.library.v1";

export interface ChatMeta {
  name?: string;
  pinned?: boolean;
  archived?: boolean;
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

export function patchProjectMeta(meta: LibraryMeta, id: string, patch: ProjectMeta): LibraryMeta {
  const next = compact({ ...meta.projects[id], ...patch });
  const { [id]: _previous, ...rest } = meta.projects;
  return { ...meta, projects: next ? { ...rest, [id]: next } : rest };
}

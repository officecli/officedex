import type { DesktopAPI, DocumentRecord, RecentFile } from "../shared/types";
import type { FileMeta, FilePort, FileType } from "../shared/uiPort";
import { NotImplementedError } from "../shared/notImplemented";

/**
 * The id the desktop uses for the folder that work lands in when the user has
 * not chosen one. Mirrors DefaultFolderID in app_folders.go.
 */
export const DEFAULT_FOLDER_ID = "folder:default";

/**
 * The three document types the new IA has a place for.
 *
 * The desktop also produces `img`, `gif` and `report`. They have no `FileType`
 * and are filtered out of the file list rather than coerced into one — a GIF
 * shown as a "document" would open an editor that cannot read it. Giving them
 * a home is part of the deferred scope in docs/uiport-scope.md.
 */
const FILE_TYPES: Record<string, FileType> = {
  pptx: "slides",
  docx: "doc",
  xlsx: "sheet",
};

const EXTENSIONS: Record<FileType, string> = { doc: "docx", sheet: "xlsx", slides: "pptx" };

function fileTypeOf(record: DocumentRecord): FileType | undefined {
  return FILE_TYPES[record.documentType.trim().toLowerCase()];
}

/** Timestamps cross the bridge as RFC3339; `FileMeta` wants epoch millis. */
function toEpoch(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface FileService extends FilePort {
  /** Resolves a file id to its path on disk, for the canvas adapter. */
  pathOf(id: string): Promise<string>;
  /** Reports the dirty flag the canvas owns. See the note on `dirty` below. */
  setDirty(id: string, dirty: boolean): void;
  /** Drops cached state for files that no longer exist. */
  forget(id: string): void;
}

export function createFileService(api: DesktopAPI): FileService {
  /**
   * `dirty` is the one field with no home on disk.
   *
   * It is a property of an open editor, not of a file: a document is dirty
   * because a canvas has unsaved changes for it, and that fact dies with the
   * session. Persisting it would mean a crash leaves every file permanently
   * marked. So it lives here, and the canvas adapter reports it.
   */
  const dirtyFiles = new Set<string>();

  /** `lastOpenedAt` lives in the recent-files list, not on the document row. */
  async function lastOpenedByPath(): Promise<Map<string, number>> {
    const recents = await api.listRecentFiles("").catch(() => [] as RecentFile[]);
    const byPath = new Map<string, number>();
    for (const recent of recents) {
      const opened = toEpoch(recent.lastOpenedAt);
      if (opened > 0) byPath.set(recent.filePath, opened);
    }
    return byPath;
  }

  function toFileMeta(record: DocumentRecord, lastOpened: Map<string, number>): FileMeta | null {
    const type = fileTypeOf(record);
    if (!type) return null;
    const created = toEpoch(record.createdAt);
    return {
      id: record.id,
      name: record.fileName,
      type,
      // Documents filed nowhere belong to the default folder, which is a real
      // directory — their files are already in it.
      folderId: record.workspaceId?.trim() || DEFAULT_FOLDER_ID,
      createdAt: created,
      updatedAt: toEpoch(record.updatedAt) || created,
      lastOpenedAt: lastOpened.get(record.filePath) ?? null,
      dirty: dirtyFiles.has(record.id),
      pinned: record.pinned,
    };
  }

  async function read(id: string): Promise<FileMeta> {
    const [record, lastOpened] = await Promise.all([api.getDocument(id), lastOpenedByPath()]);
    const meta = toFileMeta(record, lastOpened);
    if (!meta) throw new Error(`Unsupported document type: ${record.documentType}`);
    return meta;
  }

  return {
    async list() {
      const [page, lastOpened] = await Promise.all([api.listDocuments({}), lastOpenedByPath()]);
      const out: FileMeta[] = [];
      for (const record of page.items) {
        const meta = toFileMeta(record, lastOpened);
        if (meta) out.push(meta);
      }
      return out;
    },

    async create(_type, _folderId): Promise<FileMeta> {
      // Deliberately unimplemented, not forgotten. Creating an empty document
      // needs a blank seed (only blank.pptx exists) and, more importantly, a
      // decision about when the file appears on disk — Office writes nothing
      // until the first save, and FileMeta.dirty can express exactly that.
      // See docs/uiport-scope.md.
      throw new NotImplementedError(
        "files.create",
        "Creating a blank document is not built yet. Ask the agent for one, or open a file you already have.",
      );
    },

    async openFromDisk() {
      const record = await api.openLocalFile();
      // Cancelling a picker is an ordinary thing to do.
      if (!record) return null;
      const meta = toFileMeta(record, await lastOpenedByPath());
      // The Go side only accepts docx/xlsx/pptx, so this cannot normally fire —
      // it is here because returning null for "opened but unmappable" would be
      // indistinguishable from "cancelled", and the file would just not appear.
      if (!meta) throw new Error(`Unsupported document type: ${record.documentType}`);
      return meta;
    },

    async open(id) {
      const record = await api.getDocument(id);
      // openRecentFile records the open; it is what moves lastOpenedAt.
      await api.openRecentFile({
        filePath: record.filePath,
        fileName: record.fileName,
        documentType: record.documentType,
        source: "generated",
        lastOpenedAt: new Date().toISOString(),
        ...(record.currentArtifactTaskId ? { taskId: record.currentArtifactTaskId } : {}),
        ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      });
      return read(id);
    },

    async move(id, folderId) {
      await api.moveDocument(id, folderId);
    },

    async rename(id, name) {
      await api.renameDocument(id, name);
    },

    async duplicate(id) {
      const copy = await api.duplicateDocument(id);
      const meta = toFileMeta(copy, await lastOpenedByPath());
      if (!meta) throw new Error(`Unsupported document type: ${copy.documentType}`);
      return meta;
    },

    async setPinned(id, pinned) {
      await api.setDocumentPinned(id, pinned);
    },

    async save(id) {
      // The bytes are the canvas adapter's — each editor saves through its own
      // session (savePptxEditorSnapshot, saveXlsxEditor, saveDocx). What this
      // owns is the flag those saves clear.
      dirtyFiles.delete(id);
    },

    async remove(id) {
      const record = await api.getDocument(id);
      dirtyFiles.delete(id);
      await api.removeRecentFile(record.filePath);
    },

    async pathOf(id) {
      const record = await api.getDocument(id);
      return record.filePath;
    },

    setDirty(id, dirty) {
      if (dirty) dirtyFiles.add(id);
      else dirtyFiles.delete(id);
    },

    forget(id) {
      dirtyFiles.delete(id);
    },
  };
}

export { EXTENSIONS as FILE_EXTENSIONS };

import type { DesktopAPI } from "../shared/types";
import type { Folder, FolderPort } from "../shared/uiPort";
import { DEFAULT_FOLDER_ID, type FileService } from "./files";

/**
 * Folders are real directories. The desktop already reports them with the
 * default one first (app_folders.go), so this is mostly a pass-through.
 *
 * Two places match the fake rather than the desktop, because the UI was built
 * against the fake:
 *
 *   - Removing the default folder is a no-op, not an error. The desktop refuses
 *     it; the UI never offers the action, so an exception would only ever
 *     surface as an unexplained failure.
 *   - Removing a folder leaves its files alone. They fall back to the default
 *     folder because their `workspaceId` stops resolving, which is the same
 *     outcome the fake produces by reassigning them.
 */
export function createFolderService(api: DesktopAPI, files: FileService): FolderPort {
  return {
    async list(): Promise<Folder[]> {
      const folders = await api.listFolders();
      return folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
        ...(folder.isDefault ? { isDefault: true } : {}),
      }));
    },

    async create(name) {
      const created = await api.createFolder(name);
      return { id: created.id, name: created.name, path: created.path };
    },

    async rename(id, name) {
      if (id === DEFAULT_FOLDER_ID) return;
      await api.renameFolder(id, name);
    },

    async remove(id) {
      // The default folder is the one place work can always land.
      if (id === DEFAULT_FOLDER_ID) return;
      await api.removeFolder(id);
      // Files are neither deleted nor moved on disk; the rows that pointed at
      // this folder now resolve to the default one. Nothing cached here
      // survives that, so the file service is told to drop what it held.
      for (const file of await files.list()) {
        if (file.folderId === id) files.forget(file.id);
      }
    },
  };
}

import type {
  BridgeEvent,
  DesktopAPI,
  DocumentRecord,
  FolderRecord,
  RecentFile,
  TaskHistoryEntry,
  UserSettings,
} from "../../shared/types";

/**
 * An in-memory `DesktopAPI` covering what the file, folder, settings and model
 * services touch.
 *
 * This stands in for the Go side so the real services can be tested without a
 * desktop. It mirrors the behaviours those services depend on — extensions
 * preserved across a rename, ids stable across a move, the default folder
 * always present — and those behaviours have their own tests in Go
 * (app_document_files_test.go, app_folders_test.go). What is under test here is
 * the mapping between `DocumentRecord` and `FileMeta`, not the desktop.
 *
 * Anything a service does not use throws rather than returning a plausible
 * empty value: a silent stub is how a missing call site gets mistaken for a
 * working one.
 */

export const FAKE_DEFAULT_FOLDER_ID = "folder:default";
const DEFAULT_WORKSPACE_DIR = "/tmp/officedex";

export interface FakeDesktopSeed {
  readonly folders?: Array<{ id: string; name: string; path: string }>;
  readonly documents?: Array<{
    id?: string;
    fileName: string;
    documentType: string;
    workspaceId?: string;
    currentArtifactTaskId?: string;
    pinned?: boolean;
    lastOpenedAt?: string;
  }>;
  /**
   * Runs the desktop has already recorded, as `getTaskHistory` would hand them
   * back — newest-first, the way the Go side pages them.
   *
   * Without this the fake had `getTaskHistory` return `[]`, which is exactly
   * the plausible empty value the note above says this file does not do: every
   * test of `agent.current` and `agent.list` exercised only the live-event
   * path, and the half that replays recorded events could not be reached at
   * all. `list` in particular is *mostly* that half — Home's job is to show
   * work from before this window opened.
   */
  readonly taskHistory?: readonly TaskHistoryEntry[];
}

function documentIdFor(path: string): string {
  return `document:${encodeURIComponent(path)}`;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

/**
 * The fake plus the handles a test needs to drive it. The agent service is
 * event-driven, so a test has to be able to push an event the way the bridge
 * would.
 */
export type FakeDesktopApi = DesktopAPI & {
  emitBridgeEvent(event: BridgeEvent): void;
  /** What the next openLocalFile picker returns. Unset means cancelled. */
  pickLocalFile(filePath: string): void;
  /** Every generate/modify call made through this fake, in order. */
  readonly calls: Array<{ method: "generate" | "modify" | "respond" | "pausePptx"; input: Record<string, unknown> }>;
};

export function createFakeDesktopApi(seed: FakeDesktopSeed = {}): FakeDesktopApi {
  const bridgeListeners = new Set<(event: BridgeEvent) => void>();
  const calls: Array<{ method: "generate" | "modify" | "respond" | "pausePptx"; input: Record<string, unknown> }> = [];
  let picked: { filePath: string } | null = null;
  let taskCounter = 0;
  const history: TaskHistoryEntry[] = [...(seed.taskHistory ?? [])];
  const folders: FolderRecord[] = [
    { id: FAKE_DEFAULT_FOLDER_ID, name: "OfficeDex", path: DEFAULT_WORKSPACE_DIR, isDefault: true },
    ...(seed.folders ?? []).map((folder) => ({ ...folder })),
  ];

  const pathFor = (workspaceId: string | undefined, fileName: string) => {
    const folder = folders.find((entry) => entry.id === workspaceId) ?? folders[0];
    return `${folder.path}/${fileName}`;
  };

  let documents: DocumentRecord[] = (seed.documents ?? []).map((document, index) => {
    const path = pathFor(document.workspaceId, document.fileName);
    return {
      id: document.id ?? documentIdFor(path),
      filePath: path,
      fileName: document.fileName,
      documentType: document.documentType,
      workspaceId: document.workspaceId ?? "",
      ...(document.currentArtifactTaskId ? { currentArtifactTaskId: document.currentArtifactTaskId } : {}),
      createdAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      updatedAt: new Date(1_700_000_000_000 + index * 1000).toISOString(),
      migrationSource: "legacy",
      pinned: document.pinned ?? false,
    };
  });

  const recents: RecentFile[] = (seed.documents ?? [])
    .map((document, index) => ({ document, record: documents[index] }))
    .filter(({ document }) => Boolean(document.lastOpenedAt))
    .map(({ document, record }) => ({
      filePath: record.filePath,
      fileName: record.fileName,
      documentType: record.documentType,
      source: "generated" as const,
      lastOpenedAt: document.lastOpenedAt!,
    }));

  let settings: UserSettings = {
    version: 1,
    defaults: { documentType: "pptx", enableImages: true, imageQuality: "premium" },
    workspaceDir: DEFAULT_WORKSPACE_DIR,
    outputDir: null,
    llmProvider: null,
    onboardingCompletedAt: "2026-05-22T00:00:00.000Z",
    proxy: null,
    imageWatermark: { showWatermark: true, preferenceSource: "system" },
    waiting2048Enabled: false,
  };

  const find = (id: string): DocumentRecord => {
    const found = documents.find((document) => document.id === id);
    if (!found) throw new Error(`document not found: ${id}`);
    return found;
  };

  const touch = (record: DocumentRecord) => {
    record.updatedAt = new Date(Date.parse(record.updatedAt) + 1000).toISOString();
  };

  const refuse = (name: string) => () => {
    throw new Error(`fake DesktopAPI: ${name} is not implemented`);
  };

  return new Proxy({
    async listDocuments() {
      return { items: documents.map((document) => ({ ...document })) };
    },
    async getDocument(id: string) {
      return { ...find(id) };
    },
    async listDocumentRuns() {
      return [];
    },
    async listDocumentActivities() {
      return { items: [] };
    },
    async setDocumentPinned(id: string, pinned: boolean) {
      find(id).pinned = pinned;
    },
    // Mirrors app_document_files.go: the extension survives, the id does not
    // change, and a collision is refused.
    async renameDocument(id: string, name: string) {
      const record = find(id);
      const ext = extensionOf(record.fileName);
      const bare = name.endsWith(ext) ? name.slice(0, -ext.length) : name;
      const nextName = bare + ext;
      const directory = record.filePath.slice(0, record.filePath.lastIndexOf("/"));
      const nextPath = `${directory}/${nextName}`;
      if (documents.some((other) => other.id !== id && other.filePath === nextPath)) {
        throw new Error(`a file named ${nextName} already exists here`);
      }
      record.fileName = nextName;
      record.filePath = nextPath;
      touch(record);
      return { ...record };
    },
    async moveDocument(id: string, folderId: string) {
      const record = find(id);
      const folder = folders.find((entry) => entry.id === folderId);
      if (!folder) throw new Error(`folder not found: ${folderId}`);
      record.filePath = `${folder.path}/${record.fileName}`;
      record.workspaceId = folder.isDefault ? "" : folder.id;
      touch(record);
      return { ...record };
    },
    async duplicateDocument(id: string) {
      const source = find(id);
      const ext = extensionOf(source.fileName);
      const base = source.fileName.slice(0, source.fileName.length - ext.length);
      let name = `${base} copy${ext}`;
      const directory = source.filePath.slice(0, source.filePath.lastIndexOf("/"));
      for (let i = 2; documents.some((other) => other.filePath === `${directory}/${name}`); i += 1) {
        name = `${base} copy ${i}${ext}`;
      }
      const copy: DocumentRecord = {
        ...source,
        id: documentIdFor(`${directory}/${name}`),
        filePath: `${directory}/${name}`,
        fileName: name,
        migrationSource: "user",
        pinned: false,
      };
      documents = [...documents, copy];
      return { ...copy };
    },

    async openLocalFile() {
      // Stands in for the native picker: `pick` is what a test says the user
      // chose, and leaving it unset is a cancelled dialog.
      if (!picked) return null;
      const existing = documents.find((document) => document.filePath === picked!.filePath);
      if (existing) {
        // Mirrors RegisterLocalDocument: one path, one document, whether it got
        // here through the agent or through the picker.
        picked = null;
        return { ...existing };
      }
      const record: DocumentRecord = {
        id: documentIdFor(picked.filePath),
        filePath: picked.filePath,
        fileName: picked.filePath.slice(picked.filePath.lastIndexOf("/") + 1),
        documentType: extensionOf(picked.filePath).slice(1),
        // No workspace: an imported file is not inside any of the app's folders.
        workspaceId: "",
        createdAt: new Date(1_700_100_000_000).toISOString(),
        updatedAt: new Date(1_700_100_000_000).toISOString(),
        migrationSource: "user",
        pinned: false,
      };
      documents = [...documents, record];
      picked = null;
      return { ...record };
    },
    pickLocalFile(filePath: string) {
      picked = { filePath };
    },

    async listFolders() {
      return folders.map((folder) => ({ ...folder }));
    },
    async createFolder(name: string) {
      const folder: FolderRecord = {
        id: `folder-${folders.length}`,
        name: name.trim(),
        path: `${DEFAULT_WORKSPACE_DIR}/${name.trim()}`,
      };
      folders.push(folder);
      return { ...folder };
    },
    async renameFolder(id: string, name: string) {
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) throw new Error(`folder not found: ${id}`);
      folder.name = name.trim();
      return { ...folder };
    },
    async removeFolder(id: string) {
      const index = folders.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error(`folder not found: ${id}`);
      if (folders[index].isDefault) throw new Error("the default folder cannot be removed");
      folders.splice(index, 1);
      // Files are not deleted; their workspace simply stops resolving, which is
      // what the desktop does too.
      for (const document of documents) {
        if (document.workspaceId === id) document.workspaceId = "";
      }
    },
    async folderPath(id: string) {
      const folder = folders.find((entry) => entry.id === id);
      return folder?.path ?? DEFAULT_WORKSPACE_DIR;
    },

    async listRecentFiles() {
      return recents.map((recent) => ({ ...recent }));
    },
    async openRecentFile(file: RecentFile) {
      const existing = recents.find((recent) => recent.filePath === file.filePath);
      if (existing) existing.lastOpenedAt = file.lastOpenedAt;
      else recents.push({ ...file });
      const record = documents.find((document) => document.filePath === file.filePath);
      return {
        taskId: record?.currentArtifactTaskId ?? "",
        filePath: file.filePath,
        fileName: file.fileName,
        documentType: file.documentType,
      };
    },
    async removeRecentFile(filePath: string) {
      const index = recents.findIndex((recent) => recent.filePath === filePath);
      if (index >= 0) recents.splice(index, 1);
      documents = documents.filter((document) => document.filePath !== filePath);
    },

    onBridgeEvent(callback: (event: BridgeEvent) => void) {
      bridgeListeners.add(callback);
      return () => bridgeListeners.delete(callback);
    },
    emitBridgeEvent(event: BridgeEvent) {
      for (const listener of bridgeListeners) listener(event);
    },
    calls,

    async getTaskHistory(limit?: number) {
      // A page, the way the desktop pages it. Returning everything regardless
      // of `limit` would let a caller that forgot to bound its own list look
      // correct here and run away with the whole history against the real one.
      return typeof limit === "number" ? history.slice(0, limit) : [...history];
    },
    async generate(input: Record<string, unknown>) {
      calls.push({ method: "generate", input });
      taskCounter += 1;
      return { taskId: `task-${taskCounter}`, sessionId: "session", status: "running" };
    },
    async modify(input: Record<string, unknown>) {
      calls.push({ method: "modify", input });
      taskCounter += 1;
      return { taskId: `task-${taskCounter}`, sessionId: "session", status: "running" };
    },
    async respond(input: Record<string, unknown>) {
      calls.push({ method: "respond", input });
      return undefined;
    },
    async cancel() {
      return undefined;
    },
    async pausePptx(taskId: string) {
      // Recorded, not ignored: which run a pause lands on is the only visible
      // proof of which task the service considers active, and `list` is
      // required not to move that target.
      calls.push({ method: "pausePptx", input: { taskId } });
    },
    async resumePptxLive() {},

    async getSettings() {
      return { ...settings };
    },
    async updateSettings(patch: Partial<UserSettings>) {
      settings = { ...settings, ...patch };
      return { ...settings };
    },
  } as unknown as FakeDesktopApi, {
    get(target, property) {
      // This capability is intentionally absent from the legacy fake: the
      // desktop implementation is covered by Go tests, while service tests
      // retain the pre-bridge NotImplemented contract.
      if (property === "createBlankDocument") return undefined;
      const value = Reflect.get(target, property);
      return value ?? refuse(String(property));
    },
  });
}

/**
 * The in-memory UiPort the shell runs against while the service layer is built
 * separately. Everything lives in module state for the page's lifetime; nothing
 * is written to disk and no request leaves the page.
 */

import type {
  CustomModelInput,
  FileMeta,
  FileType,
  Folder,
  Model,
  ShellSettings,
  UiPort,
} from "../types";
import { createFakeAgent } from "./fakeAgent";
import { SEED_FOLDER_ID, seedFiles, seedFolders, seedModels, seedSettings } from "./seed";

export interface FakePortOptions {
  folders?: Folder[];
  files?: FileMeta[];
  models?: Model[];
  settings?: ShellSettings;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const EXTENSIONS: Record<FileType, string> = { doc: "docx", sheet: "xlsx", slides: "pptx" };
const TYPE_NAMES: Record<FileType, string> = {
  doc: "document",
  sheet: "workbook",
  slides: "presentation",
};

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

export function createFakePort(options: FakePortOptions = {}): UiPort {
  const now = options.now ?? (() => Date.now());
  let folders: Folder[] = options.folders ?? seedFolders();
  let files: FileMeta[] = options.files ?? seedFiles(now());
  let models: Model[] = options.models ?? seedModels();
  let settings: ShellSettings = options.settings ?? seedSettings();

  const defaultFolderId = () =>
    folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? SEED_FOLDER_ID;

  const find = (id: string) => {
    const file = files.find((entry) => entry.id === id);
    if (!file) throw new Error(`Unknown file: ${id}`);
    return file;
  };

  const agent = createFakeAgent({
    getFiles: () => files,
    markDirty: (fileId, dirty) => {
      const file = files.find((entry) => entry.id === fileId);
      if (file) {
        file.dirty = dirty;
        file.updatedAt = now();
      }
    },
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout,
    now,
  });

  return {
    folders: {
      async list() {
        return structuredClone(folders);
      },
      async create(name) {
        const folder: Folder = {
          id: nextId("folder"),
          name: name.trim(),
          path: `~/Documents/${name.trim()}`,
        };
        folders = [...folders, folder];
        return structuredClone(folder);
      },
      async rename(id, name) {
        const folder = folders.find((entry) => entry.id === id);
        if (folder) folder.name = name.trim();
      },
      async remove(id) {
        const folder = folders.find((entry) => entry.id === id);
        if (!folder || folder.isDefault) return;
        folders = folders.filter((entry) => entry.id !== id);
        // Decision 3: removing a folder never deletes files; they fall back to
        // the default folder, which is a real directory like any other.
        const fallback = defaultFolderId();
        for (const file of files) {
          if (file.folderId === id) file.folderId = fallback;
        }
      },
    },

    files: {
      async list() {
        return structuredClone(files);
      },
      async create(type, folderId) {
        const count = files.filter((entry) => entry.type === type).length + 1;
        const file: FileMeta = {
          id: nextId("file"),
          name: `Untitled ${TYPE_NAMES[type]} ${count}.${EXTENSIONS[type]}`,
          type,
          folderId: folders.some((entry) => entry.id === folderId) ? folderId : defaultFolderId(),
          createdAt: now(),
          updatedAt: now(),
          lastOpenedAt: now(),
          dirty: false,
          pinned: false,
        };
        files = [...files, file];
        return structuredClone(file);
      },
      async open(id) {
        const file = find(id);
        file.lastOpenedAt = now();
        return structuredClone(file);
      },
      async move(id, folderId) {
        const file = find(id);
        if (folders.some((entry) => entry.id === folderId)) file.folderId = folderId;
      },
      async rename(id, name) {
        const file = find(id);
        const trimmed = name.trim();
        const suffix = `.${EXTENSIONS[file.type]}`;
        file.name = trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
        file.updatedAt = now();
      },
      async duplicate(id) {
        const source = find(id);
        const suffix = `.${EXTENSIONS[source.type]}`;
        const copy: FileMeta = {
          ...structuredClone(source),
          id: nextId("file"),
          name: `${source.name.replace(new RegExp(`${suffix}$`), "")} copy${suffix}`,
          createdAt: now(),
          updatedAt: now(),
          lastOpenedAt: now(),
          dirty: false,
          pinned: false,
        };
        files = [...files, copy];
        return structuredClone(copy);
      },
      async setPinned(id, pinned) {
        find(id).pinned = pinned;
      },
      async save(id) {
        const file = find(id);
        file.dirty = false;
        file.updatedAt = now();
      },
      async remove(id) {
        files = files.filter((entry) => entry.id !== id);
      },
    },

    agent,

    models: {
      async list() {
        return structuredClone(models);
      },
      async addCustom(input) {
        const model = toModel(nextId("model"), input);
        models = [...models, model];
        return structuredClone(model);
      },
      async updateCustom(id, input) {
        const model = toModel(id, input);
        models = models.map((entry) => (entry.id === id ? model : entry));
        return structuredClone(model);
      },
      async removeCustom(id) {
        models = models.filter((entry) => entry.id !== id);
        if (settings.selectedModelId === id) {
          settings = { ...settings, selectedModelId: models[0]?.id ?? "" };
        }
      },
    },

    settings: {
      async get() {
        return { ...settings };
      },
      async patch(patch) {
        settings = { ...settings, ...patch };
        return { ...settings };
      },
    },

    window: createBrowserWindowPort(),
  };
}

function toModel(id: string, input: CustomModelInput): Model {
  return {
    id,
    name: input.name.trim(),
    provider: input.provider.trim() || "Custom",
    detail: input.baseUrl.trim() || undefined,
    custom: true,
    // `apiKey` is intentionally dropped: the fake port never retains a key,
    // matching the contract's note that storage is the port's decision.
  };
}

/**
 * Window controls in a plain browser. Close and minimize have no host to talk
 * to, so they are no-ops the shell can still wire up and lay out; fullscreen is
 * real via the Fullscreen API.
 */
function createBrowserWindowPort(): UiPort["window"] {
  const listeners = new Set<(fullscreen: boolean) => void>();
  const isFullscreen = () => typeof document !== "undefined" && Boolean(document.fullscreenElement);

  if (typeof document !== "undefined") {
    document.addEventListener("fullscreenchange", () => {
      for (const listener of listeners) listener(isFullscreen());
    });
  }

  return {
    close() {},
    minimize() {},
    toggleFullscreen() {
      if (typeof document === "undefined") return;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
    },
    isFullscreen,
    onFullscreenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

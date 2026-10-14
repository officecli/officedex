import { useEffect, useSyncExternalStore } from "react";

import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";
import type { PptxTemplateProgress } from "../../shared/types";
import type { PptxTemplatePort, UiPort } from "../../shared/uiPort";
import { errorMessage } from "../../renderer/utils/values";

/**
 * A file being learned, or one whose learning did not finish (1.0.12 §五).
 *
 * The desktop records a template only once it is learned, so until then the
 * card lives here: what was chosen, under which name, how far it got and why
 * it stopped. `sourcePath` is kept so Retry learns the same file again without
 * asking for it.
 */
export interface TemplateJob {
  key: string;
  name: string;
  sourcePath: string;
  sourceFileName: string;
  /** Replace: the template this one takes the place of once it is learned. */
  replaceId?: string;
  status: "learning" | "failed";
  progress: PptxTemplateProgress | null;
  error: string;
  createdAt: number;
}

export interface TemplateLibrarySnapshot {
  /** False when this build has no template library at all. */
  available: boolean;
  loaded: boolean;
  templates: PptxTemplateAssetSummary[];
  jobs: TemplateJob[];
}

const EMPTY: TemplateLibrarySnapshot = { available: false, loaded: true, templates: [], jobs: [] };

/**
 * One library per port, outside React: leaving the Skills page, switching
 * chats or going Home does not stop a file being learned or forget it failed.
 */
export class TemplateLibrary {
  #port: PptxTemplatePort;
  #snapshot: TemplateLibrarySnapshot = { available: true, loaded: false, templates: [], jobs: [] };
  #listeners = new Set<() => void>();
  #loading: Promise<void> | null = null;
  #counter = 0;

  constructor(port: PptxTemplatePort) {
    this.#port = port;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): TemplateLibrarySnapshot => this.#snapshot;

  #set(patch: Partial<TemplateLibrarySnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #patchJob(key: string, patch: Partial<TemplateJob>) {
    this.#set({ jobs: this.#snapshot.jobs.map((job) => (job.key === key ? { ...job, ...patch } : job)) });
  }

  load(): Promise<void> {
    this.#loading ??= this.refresh();
    return this.#loading;
  }

  async refresh(): Promise<void> {
    try {
      this.#set({ templates: await this.#port.list(), loaded: true });
    } catch {
      this.#set({ loaded: true });
    }
  }

  pick() {
    return this.#port.pick();
  }

  /** Whether `name` is taken by another template or a file being learned. */
  nameTaken(name: string, except?: string): boolean {
    const wanted = name.trim().toLocaleLowerCase();
    return (
      this.#snapshot.templates.some((template) => template.id !== except && template.name.trim().toLocaleLowerCase() === wanted) ||
      this.#snapshot.jobs.some((job) => job.key !== except && job.replaceId !== except && job.name.trim().toLocaleLowerCase() === wanted)
    );
  }

  /** Learns a chosen file. Resolves when it is learned or has failed; never rejects. */
  async learn(input: { sourcePath: string; sourceFileName: string; name: string; replaceId?: string }): Promise<void> {
    this.#counter += 1;
    const job: TemplateJob = {
      key: `job-${Date.now()}-${this.#counter}`,
      name: input.name,
      sourcePath: input.sourcePath,
      sourceFileName: input.sourceFileName,
      ...(input.replaceId ? { replaceId: input.replaceId } : {}),
      status: "learning",
      progress: null,
      error: "",
      createdAt: Date.now(),
    };
    this.#set({ jobs: [job, ...this.#snapshot.jobs] });
    await this.#run(job);
  }

  /** Learns a failed file again, from the same source. */
  async retry(key: string): Promise<void> {
    const job = this.#snapshot.jobs.find((entry) => entry.key === key);
    if (!job || job.status === "learning") return;
    this.#patchJob(key, { status: "learning", error: "", progress: null });
    await this.#run({ ...job, status: "learning" });
  }

  /** Forgets a file that did not finish learning. */
  dismiss(key: string) {
    this.#set({ jobs: this.#snapshot.jobs.filter((job) => job.key !== key) });
  }

  async #run(job: TemplateJob) {
    try {
      await this.#port.learn({ sourcePath: job.sourcePath, name: job.name }, (progress) => {
        this.#patchJob(job.key, { progress });
      });
      // A replacement takes over from the template it replaces, which is
      // removed only now — a failed replacement leaves the old one usable.
      if (job.replaceId) await this.#port.remove(job.replaceId).catch(() => undefined);
      this.dismiss(job.key);
      await this.refresh();
    } catch (reason) {
      this.#patchJob(job.key, { status: "failed", error: errorMessage(reason) });
    }
  }

  async rename(id: string, name: string): Promise<void> {
    await this.#port.rename(id, name);
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await this.#port.remove(id);
    await this.refresh();
  }
}

const libraries = new WeakMap<UiPort, TemplateLibrary>();
const subscribeNothing = () => () => {};
const emptySnapshot = () => EMPTY;

/** The port's template library, or null in a build that has none. */
export function templateLibraryFor(port: UiPort): TemplateLibrary | null {
  if (!port.pptxTemplates) return null;
  let library = libraries.get(port);
  if (!library) {
    library = new TemplateLibrary(port.pptxTemplates);
    libraries.set(port, library);
  }
  return library;
}

/** Subscribes to the template library; loads it the first time. */
export function useTemplateLibrary(port: UiPort): { library: TemplateLibrary | null; snapshot: TemplateLibrarySnapshot } {
  const library = templateLibraryFor(port);
  useEffect(() => {
    void library?.load();
  }, [library]);
  const snapshot = useSyncExternalStore(
    library?.subscribe ?? subscribeNothing,
    library?.getSnapshot ?? emptySnapshot,
    library?.getSnapshot ?? emptySnapshot,
  );
  return { library, snapshot };
}

/** Templates a message can use: learned, and nothing else. */
export const readyTemplates = (snapshot: TemplateLibrarySnapshot) =>
  snapshot.templates.filter((template) => template.status === "ready");

/* ------------------------------------------------- Use, and coming back */

/**
 * "Use" on a template card hands the template to the composer the user came
 * from, which puts `/name` at its caret. The composer may not be mounted yet —
 * Use navigates there first — so the request waits here until one takes it.
 */
let pendingUse: PptxTemplateAssetSummary | null = null;
const useListeners = new Set<() => void>();

export function requestTemplateUse(template: PptxTemplateAssetSummary): void {
  pendingUse = template;
  for (const listener of useListeners) listener();
}

export function takeTemplateUse(): PptxTemplateAssetSummary | null {
  const template = pendingUse;
  pendingUse = null;
  return template;
}

export function onTemplateUse(listener: () => void): () => void {
  useListeners.add(listener);
  return () => useListeners.delete(listener);
}

/**
 * Where Skills was opened from: the conversation on screen, or the draft chat
 * Home was writing into. Use goes back there rather than to a blank Home.
 */
export interface SkillsReturn {
  chat: import("../state/shellReducer").ChatRef | null;
  homeChat: import("../state/shellReducer").ChatRef | null;
}

let skillsReturn: SkillsReturn = { chat: null, homeChat: null };

export function rememberSkillsReturn(from: SkillsReturn): void {
  skillsReturn = from;
}

export function skillsReturnTarget(): SkillsReturn {
  return skillsReturn;
}

/** Opens Skills, remembering where to come back to on Use. */
export function openSkills(
  state: { chat: import("../state/shellReducer").ChatRef | null; homeChat: import("../state/shellReducer").ChatRef | null; page: string },
  dispatch: (action: import("../state/shellReducer").ShellAction) => void,
  section: import("../state/shellReducer").SkillsSection = "library",
): void {
  if (state.page !== "skills") {
    rememberSkillsReturn({ chat: state.chat, homeChat: state.page === "home" ? state.homeChat : null });
  }
  dispatch({ type: "go", page: "skills", skills: section });
}

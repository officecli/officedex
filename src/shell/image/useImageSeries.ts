import { useMemo } from "react";

import type { AgentImageRun, AgentTask, FileMeta } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";

/**
 * A picture task, read as a list of versions.
 *
 * An image is never edited in place: every instruction is a new run that
 * produces a new file, and the file it started from stays exactly where it was.
 * So the series — `AgentTask.image.runs`, oldest first — is the whole history,
 * and "Version N" is a position in it rather than anything the runtime records.
 * This module is the one place that numbering is decided, because the workspace
 * caption, the versions strip, the transcript's result cards and the composer's
 * "Editing Version N" all have to agree about it.
 *
 * Only a *finished* run that the library can show a file for becomes a version.
 * A run mid-flight has produced nothing, and a run that failed produced nothing
 * either; numbering them would make the strip disagree with itself the moment
 * one of them landed.
 */

export interface ImageVersion {
  /** 1-based position in the series, which is what the UI calls "Version N". */
  version: number;
  file: FileMeta;
  /** The run that produced it — null for a picture opened outside any task. */
  run: AgentImageRun | null;
}

/**
 * One message's worth of runs.
 *
 * Asking for four pictures is one thing the user said and four runs in the
 * series. The transcript shows what was said, so consecutive runs that carry
 * the same prompt and the same base are folded back into the message they came
 * from; the four pictures then arrive as four result cards under that one
 * bubble, which is the shape the prototype draws.
 */
export interface ImageBatch {
  /** The first run's id: stable, and unique inside a series. */
  id: string;
  prompt: string;
  /** The version this message changed, when it changed one. */
  baseVersion: number | null;
  runs: AgentImageRun[];
  status: "running" | "done" | "failed" | "cancelled";
  versions: ImageVersion[];
}

export interface ImageSeries {
  /** The task beside this workspace is making pictures. */
  isImageTask: boolean;
  runs: AgentImageRun[];
  /** Finished runs that have a file, in series order. */
  versions: ImageVersion[];
  /** The one on the canvas: the open file when it is one of these, else the newest. */
  selected: ImageVersion | null;
  busy: boolean;
  /**
   * The run that ended badly, when the series ends on one.
   *
   * Only the tail counts. A failure three messages ago is history the user has
   * already moved past, and an error box above a picture that arrived after it
   * says the wrong thing about the picture.
   */
  failure: AgentImageRun | null;
  batches: ImageBatch[];
  /** What "Try again" would ask for again. */
  lastPrompt: string;
}

const EMPTY: ImageSeries = {
  isImageTask: false,
  runs: [],
  versions: [],
  selected: null,
  busy: false,
  failure: null,
  batches: [],
  lastPrompt: "",
};

function batchStatus(runs: readonly AgentImageRun[]): ImageBatch["status"] {
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "failed")) return "failed";
  if (runs.some((run) => run.status === "cancelled")) return "cancelled";
  return "done";
}

/**
 * The series, from a task and the library — pure, so the numbering can be
 * tested without rendering a shell.
 *
 * `activeFileId` decides only which version is *selected*, never which ones
 * exist. A picture the user opened from the sidebar that this task never made
 * is its own series of one: the workspace still has something truthful to show
 * (a name, a picture, Download, Save to folder) without inventing a version
 * history for a file that has none.
 */
export function deriveImageSeries(
  task: AgentTask | null,
  files: readonly FileMeta[],
  activeFileId: string | null,
): ImageSeries {
  const isImageTask = task?.documentType === "img";
  const runs = isImageTask ? (task?.image?.runs ?? []) : [];
  const activeFile = activeFileId
    ? (files.find((file) => file.id === activeFileId) ?? null)
    : null;

  if (runs.length === 0 && activeFile?.type !== "image") {
    return { ...EMPTY, isImageTask };
  }

  const seriesVersions: ImageVersion[] = [];
  const versionOfRun = new Map<string, number>();
  for (const run of runs) {
    if (run.status !== "done") continue;
    const file = files.find(
      (candidate) => candidate.type === "image" && candidate.artifactTaskId === run.taskId,
    );
    if (!file) continue;
    const version = seriesVersions.length + 1;
    seriesVersions.push({ version, file, run });
    versionOfRun.set(run.taskId, version);
  }

  const batches: ImageBatch[] = [];
  for (const run of runs) {
    const previous = batches[batches.length - 1];
    const sameMessage =
      previous &&
      previous.prompt === run.prompt &&
      (previous.runs[0].baseTaskId ?? null) === (run.baseTaskId ?? null);
    if (sameMessage) {
      previous.runs.push(run);
      continue;
    }
    batches.push({
      id: run.taskId,
      prompt: run.prompt,
      baseVersion: run.baseTaskId ? (versionOfRun.get(run.baseTaskId) ?? null) : null,
      runs: [run],
      status: "running",
      versions: [],
    });
  }
  for (const batch of batches) {
    batch.status = batchStatus(batch.runs);
    batch.versions = batch.runs
      .map((run) => seriesVersions.find((version) => version.run?.taskId === run.taskId))
      .filter((version): version is ImageVersion => version !== undefined);
  }

  /*
   * A picture that this series does not contain is showing on its own.
   *
   * The alternative — keep the task's versions and quietly select the newest —
   * puts a caption ("Version 3 of 4") under a file that has nothing to do with
   * the run, and a Stop button over a picture no run is touching.
   */
  const standalone =
    activeFile?.type === "image" &&
    !seriesVersions.some((version) => version.file.id === activeFile.id);

  if (standalone && activeFile) {
    return {
      isImageTask: Boolean(isImageTask),
      runs,
      versions: [{ version: 1, file: activeFile, run: null }],
      selected: { version: 1, file: activeFile, run: null },
      busy: false,
      failure: null,
      batches,
      lastPrompt: runs[runs.length - 1]?.prompt ?? "",
    };
  }

  const last = runs[runs.length - 1];
  return {
    isImageTask: Boolean(isImageTask),
    runs,
    versions: seriesVersions,
    selected:
      seriesVersions.find((version) => version.file.id === activeFile?.id) ??
      seriesVersions[seriesVersions.length - 1] ??
      null,
    busy: runs.some((run) => run.status === "running"),
    failure: last && (last.status === "failed" || last.status === "cancelled") ? last : null,
    batches,
    lastPrompt: last?.prompt ?? "",
  };
}

/** `deriveImageSeries` against the shell's own library and open file. */
export function useImageSeries(task: AgentTask | null): ImageSeries {
  const { files, activeFile } = useShell();
  const activeFileId = activeFile?.id ?? null;
  return useMemo(
    () => deriveImageSeries(task, files, activeFileId),
    [task, files, activeFileId],
  );
}

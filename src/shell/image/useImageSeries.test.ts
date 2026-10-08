import { describe, expect, it } from "vitest";

import type { AgentImageRun, AgentTask, FileMeta } from "../../shared/uiPort";
import { deriveImageSeries } from "./useImageSeries";

/**
 * Version numbers are the whole of this module's job.
 *
 * Four surfaces state one — the canvas caption, the versions strip, the
 * transcript's result cards and the composer's "Editing Version N" — and the
 * runtime records none of them: a version is a position in the series, and the
 * series only counts runs that finished *and* left a file behind. Get that
 * wrong in one place and the four disagree; get it wrong here and they agree
 * on something false, which is worse.
 */

function run(partial: Partial<AgentImageRun> & { taskId: string }): AgentImageRun {
  return { status: "done", prompt: "A desk lamp", ...partial };
}

function file(id: string, artifactTaskId?: string): FileMeta {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    folderId: "folder-inbox",
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    dirty: false,
    pinned: false,
    ...(artifactTaskId ? { artifactTaskId } : {}),
  };
}

function imageTask(runs: AgentImageRun[]): AgentTask {
  return {
    id: runs[0]?.taskId ?? "task",
    title: "A desk lamp",
    folderId: "folder-inbox",
    documentType: "img",
    status: "writing",
    phase: "Creating image",
    steps: [],
    messages: [],
    suggestion: null,
    question: null,
    image: { runs },
  };
}

describe("an image task read as versions", () => {
  it("numbers finished runs that have a file, in series order", () => {
    const series = deriveImageSeries(
      imageTask([run({ taskId: "r1" }), run({ taskId: "r2" }), run({ taskId: "r3" })]),
      [file("f1", "r1"), file("f2", "r2"), file("f3", "r3")],
      null,
    );

    expect(series.versions.map((version) => [version.version, version.file.id])).toEqual([
      [1, "f1"],
      [2, "f2"],
      [3, "f3"],
    ]);
  });

  /*
   * A run mid-flight has produced nothing and must not take a number: if it
   * did, the picture that lands after it would be numbered twice — once while
   * it was pending and once when it arrived.
   */
  it("skips a run that is still going and one whose file is missing", () => {
    const series = deriveImageSeries(
      imageTask([
        run({ taskId: "r1" }),
        run({ taskId: "r2", status: "running" }),
        run({ taskId: "r3" }),
      ]),
      // `r3` finished; the library has no file for it yet.
      [file("f1", "r1")],
      null,
    );

    expect(series.versions).toHaveLength(1);
    expect(series.busy).toBe(true);
  });

  it("selects the open file when it is one of the versions, else the newest", () => {
    const task = imageTask([run({ taskId: "r1" }), run({ taskId: "r2" })]);
    const files = [file("f1", "r1"), file("f2", "r2")];

    expect(deriveImageSeries(task, files, "f1").selected?.version).toBe(1);
    expect(deriveImageSeries(task, files, null).selected?.version).toBe(2);
  });

  it("reports the tail run when it failed, and not a failure already recovered from", () => {
    const failed = deriveImageSeries(
      imageTask([run({ taskId: "r1" }), run({ taskId: "r2", status: "failed" })]),
      [file("f1", "r1")],
      null,
    );
    expect(failed.failure?.taskId).toBe("r2");

    const recovered = deriveImageSeries(
      imageTask([run({ taskId: "r1", status: "failed" }), run({ taskId: "r2" })]),
      [file("f2", "r2")],
      null,
    );
    expect(recovered.failure).toBeNull();
  });

  /* "Make me four" is four runs and one thing the user said. */
  it("folds a batch of identical prompts into one message", () => {
    const series = deriveImageSeries(
      imageTask([
        run({ taskId: "r1", prompt: "A desk lamp" }),
        run({ taskId: "r2", prompt: "A desk lamp" }),
        run({ taskId: "r3", prompt: "Warmer light", baseTaskId: "r1" }),
      ]),
      [file("f1", "r1"), file("f2", "r2"), file("f3", "r3")],
      null,
    );

    expect(series.batches).toHaveLength(2);
    expect(series.batches[0].runs).toHaveLength(2);
    expect(series.batches[0].versions.map((version) => version.version)).toEqual([1, 2]);
    expect(series.batches[0].baseVersion).toBeNull();
    // The second message changed version 1, and says so.
    expect(series.batches[1].baseVersion).toBe(1);
  });

  it("keeps two separate messages separate when one of them has a base", () => {
    const series = deriveImageSeries(
      imageTask([
        run({ taskId: "r1", prompt: "A desk lamp" }),
        run({ taskId: "r2", prompt: "A desk lamp", baseTaskId: "r1" }),
      ]),
      [file("f1", "r1"), file("f2", "r2")],
      null,
    );
    expect(series.batches).toHaveLength(2);
  });

  /*
   * A picture opened from the sidebar has no run behind it. The workspace still
   * has to show it — name, picture, Download, Save to folder — so it is a
   * series of one rather than nothing at all.
   */
  it("treats a picture that belongs to no run as a single version", () => {
    const series = deriveImageSeries(null, [file("loose")], "loose");
    expect(series.versions).toEqual([
      expect.objectContaining({ version: 1, run: null }),
    ]);
    expect(series.selected?.file.id).toBe("loose");
    expect(series.busy).toBe(false);
  });

  it("is empty for a task that is not making pictures", () => {
    const series = deriveImageSeries(
      { ...imageTask([run({ taskId: "r1" })]), documentType: "pptx" },
      [file("f1", "r1")],
      null,
    );
    expect(series.isImageTask).toBe(false);
    expect(series.versions).toEqual([]);
  });
});

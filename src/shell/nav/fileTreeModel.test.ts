import { describe, expect, it } from "vitest";

import { seedFiles, seedFolders } from "../port/fake/seed";
import type { FileMeta } from "../../shared/uiPort";
import {
  buildGroups,
  formatTouched,
  groupByFolder,
  groupByTime,
  locationLabel,
  timeBucket,
} from "./fileTreeModel";

const NOW = new Date("2026-09-17T12:00:00Z").getTime();
const DAY = 86_400_000;

const file = (id: string, folderId: string, daysAgo: number, extra: Partial<FileMeta> = {}): FileMeta => ({
  id,
  name: `${id}.docx`,
  type: "doc",
  folderId,
  createdAt: NOW - daysAgo * DAY,
  updatedAt: NOW - daysAgo * DAY,
  lastOpenedAt: NOW - daysAgo * DAY,
  dirty: false,
  pinned: false,
  ...extra,
});

describe("grouping by folder", () => {
  it("keeps the folders' own order and puts every file in exactly one", () => {
    const folders = seedFolders();
    const files = seedFiles(NOW);
    const groups = groupByFolder(folders, files);

    expect(groups.map((group) => group.label)).toEqual([
      "MO product launch",
      "Customer research",
      "Documents",
    ]);

    const placed = groups.flatMap((group) => group.files.map((entry) => entry.id));
    expect(new Set(placed).size).toBe(files.length);
  });

  it("orders files inside a folder by how recently they were touched", () => {
    const groups = groupByFolder(seedFolders().slice(0, 1), [
      file("older", "folder-launch", 5),
      file("newest", "folder-launch", 0),
      file("middle", "folder-launch", 2),
    ]);
    expect(groups[0].files.map((entry) => entry.id)).toEqual(["newest", "middle", "older"]);
  });

  it("reports the untruncated total so the caller can offer the rest", () => {
    const files = Array.from({ length: 9 }, (_, index) => file(`f${index}`, "folder-launch", index));
    const [group] = groupByFolder(seedFolders().slice(0, 1), files, { limit: 5 });
    expect(group.files).toHaveLength(5);
    expect(group.total).toBe(9);
  });
});

describe("grouping by time", () => {
  it("buckets by the prototype's headings", () => {
    expect(timeBucket(file("a", "x", 0), NOW)).toBe("Today");
    expect(timeBucket(file("b", "x", 3), NOW)).toBe("Previous 7 days");
    expect(timeBucket(file("c", "x", 12), NOW)).toBe("Previous 30 days");
    expect(timeBucket(file("d", "x", 60), NOW)).toBe("Earlier");
  });

  it("is a view over the flat list, so its groups carry no folder", () => {
    const groups = groupByTime(seedFiles(NOW), { now: NOW });
    expect(groups.length).toBeGreaterThan(0);
    // Decision 3: a time bucket is not a place a file can live, so it exposes
    // no folder for a drop to target.
    for (const group of groups) {
      expect(group.folderId).toBeNull();
    }
  });

  it("drops empty buckets rather than showing blank headings", () => {
    const groups = groupByTime([file("only", "folder-launch", 0)], { now: NOW });
    expect(groups.map((group) => group.label)).toEqual(["Today"]);
  });
});

describe("filters", () => {
  it("treats pinned as a filter over the same list, not a separate location", () => {
    const files = [
      file("pinned-one", "folder-launch", 1, { pinned: true }),
      file("plain", "folder-launch", 0),
    ];
    const all = groupByFolder(seedFolders().slice(0, 1), files, { filter: "all" });
    const pinned = groupByFolder(seedFolders().slice(0, 1), files, { filter: "pinned" });

    // Same folder, same grouping, fewer rows — the shape does not change.
    expect(all[0].folderId).toBe(pinned[0].folderId);
    expect(all[0].files.map((entry) => entry.id)).toEqual(["plain", "pinned-one"]);
    expect(pinned[0].files.map((entry) => entry.id)).toEqual(["pinned-one"]);
  });

  it("filters by file type", () => {
    const files = seedFiles(NOW);
    const [launch] = groupByFolder(seedFolders().slice(0, 1), files, { fileType: "sheet" });
    expect(launch.files.every((entry) => entry.type === "sheet")).toBe(true);
  });
});

describe("buildGroups", () => {
  it("is the single entry point both densities share", () => {
    const folders = seedFolders();
    const files = seedFiles(NOW);
    expect(buildGroups("folder", folders, files)).toEqual(groupByFolder(folders, files));
    expect(buildGroups("time", folders, files, { now: NOW })).toEqual(groupByTime(files, { now: NOW }));
  });
});

describe("labels", () => {
  it("always resolves a file to a real folder name", () => {
    const folders = seedFolders();
    for (const entry of seedFiles(NOW)) {
      expect(locationLabel(entry, folders)).not.toBe("On this computer");
    }
  });

  it("formats today with a time and older days with a date", () => {
    expect(formatTouched(file("a", "x", 0), NOW)).toMatch(/^Today, /);
    expect(formatTouched(file("b", "x", 4), NOW)).toMatch(/^Sep \d+$/);
    expect(formatTouched({ ...file("c", "x", 0), lastOpenedAt: null, updatedAt: 0, createdAt: 0 }, NOW)).toBe("—");
  });
});

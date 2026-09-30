/**
 * The overlay that keeps what the runtime has nowhere to put: a conversation's
 * chosen name, whether it is pinned, and what has been archived.
 *
 * Two properties matter more than the shape. It must survive a round trip
 * through storage, because the names in the sidebar come back from it after a
 * reload; and it must never throw on what it reads, because the value is
 * whatever happens to be under that key — an old format, another tool's write,
 * or half a string.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  emptyLibraryMeta,
  patchChatMeta,
  patchProjectMeta,
  readLibraryMeta,
  writeLibraryMeta,
  type LibraryMeta,
} from "./libraryMeta";

const KEY = "officedex.shell.library.v1";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("reading and writing", () => {
  it("has nothing to say about an untouched workspace", () => {
    expect(readLibraryMeta()).toEqual(emptyLibraryMeta);
  });

  it("brings back what it wrote", () => {
    const meta: LibraryMeta = {
      chats: { plan: { name: "Launch plan", pinned: true }, sales: { archived: true } },
      projects: { launch: { archived: true } },
    };
    writeLibraryMeta(meta);
    expect(readLibraryMeta()).toEqual(meta);
  });

  // Whatever is under the key is untrusted input, not a LibraryMeta.
  it("reads garbage as an empty overlay", () => {
    for (const raw of ["", "not json", "null", "42", '"a string"', "[]", '{"chats":7}']) {
      localStorage.setItem(KEY, raw);
      const meta = readLibraryMeta();
      expect(meta.chats).toEqual({});
      expect(meta.projects).toEqual({});
    }
  });

  it("keeps the half of a stored value that is usable", () => {
    localStorage.setItem(KEY, JSON.stringify({ chats: { plan: { pinned: true } }, projects: "gone" }));
    expect(readLibraryMeta()).toEqual({ chats: { plan: { pinned: true } }, projects: {} });
  });
});

describe("patchChatMeta", () => {
  it("adds an entry without touching the rest", () => {
    const base: LibraryMeta = { chats: { sales: { pinned: true } }, projects: { launch: { archived: true } } };
    const next = patchChatMeta(base, "plan", { name: "Launch plan" });
    expect(next.chats).toEqual({ sales: { pinned: true }, plan: { name: "Launch plan" } });
    expect(next.projects).toBe(base.projects);
    // The original is left alone: this is state a reducer can hold.
    expect(base.chats.plan).toBeUndefined();
  });

  it("merges into an entry that already exists", () => {
    const base = patchChatMeta(emptyLibraryMeta, "plan", { name: "Launch plan" });
    expect(patchChatMeta(base, "plan", { pinned: true }).chats.plan).toEqual({
      name: "Launch plan",
      pinned: true,
    });
  });

  /*
   * Unpinning is not "pinned: false" forever: the overlay only exists to record
   * a departure from the default, so a row that says nothing is dropped. That is
   * what keeps the stored object from growing one entry per conversation ever
   * looked at.
   */
  it("drops an entry that no longer says anything", () => {
    const base = patchChatMeta(emptyLibraryMeta, "plan", { pinned: true });
    expect(patchChatMeta(base, "plan", { pinned: false }).chats).toEqual({});
    const named = patchChatMeta(emptyLibraryMeta, "plan", { name: "Launch plan", pinned: true });
    expect(patchChatMeta(named, "plan", { name: "" }).chats.plan).toEqual({ pinned: true });
  });

  it("restores an archived conversation by clearing the flag", () => {
    const archived = patchChatMeta(emptyLibraryMeta, "plan", { archived: true });
    expect(archived.chats.plan).toEqual({ archived: true });
    expect(patchChatMeta(archived, "plan", { archived: false }).chats).toEqual({});
  });
});

describe("patchProjectMeta", () => {
  it("archives and restores a project without touching conversations", () => {
    const withChat = patchChatMeta(emptyLibraryMeta, "plan", { pinned: true });
    const archived = patchProjectMeta(withChat, "launch", { archived: true });
    expect(archived.projects).toEqual({ launch: { archived: true } });
    expect(archived.chats).toEqual({ plan: { pinned: true } });
    expect(patchProjectMeta(archived, "launch", { archived: false }).projects).toEqual({});
  });
});

describe("a full round trip", () => {
  it("survives every mutation followed by a reload", () => {
    let meta = emptyLibraryMeta;
    meta = patchChatMeta(meta, "plan", { name: "Launch plan" });
    meta = patchChatMeta(meta, "plan", { pinned: true });
    meta = patchChatMeta(meta, "sales", { archived: true });
    meta = patchProjectMeta(meta, "launch", { archived: true });
    writeLibraryMeta(meta);

    expect(readLibraryMeta()).toEqual({
      chats: { plan: { name: "Launch plan", pinned: true }, sales: { archived: true } },
      projects: { launch: { archived: true } },
    });
  });
});

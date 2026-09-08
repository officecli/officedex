import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { isolateSheetSdkChunk } from "./sdk-sheet-chunks.mjs";

test("all SDK chunks register without leaking or overwriting global helpers in either load order", async () => {
  const root = new URL("../node_modules/@shimo/sdk-sheet/lib/", import.meta.url);
  const names = (await readdir(root)).filter((name) => name.endsWith(".chunk.js"));
  const chunks = await Promise.all(names.map(async (name) => [name, await readFile(new URL(name, root), "utf8")]));
  for (const order of [chunks, [...chunks].reverse()]) {
    const registrations = [];
    const context = vm.createContext({ self: { webpackChunk_shimo_sm_sheet: registrations } });
    for (const [name, source] of order) {
      vm.runInContext(isolateSheetSdkChunk(name, source), context, { filename: name, timeout: 5000 });
    }
    assert.equal(registrations.length, chunks.length);
    assert.deepEqual(Object.keys(context), ["self"], "minifier helpers must stay local to their chunk");
  }
});

test("entry modules and locales are left unchanged", () => {
  for (const name of ["index.js", "zh-CN.js"]) {
    const source = "globalThis.localeReady = true;";
    assert.equal(isolateSheetSdkChunk(name, source), source);
  }
});

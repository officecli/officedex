import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { isolateSheetSdkChunk, lazifySheetSdkI18nProperties } from "./sdk-sheet-chunks.mjs";

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

test("toolbar tab and section labels re-read the current locale", async () => {
  const source = await readFile(new URL("../node_modules/@shimo/sdk-sheet/lib/p19.chunk.js", import.meta.url), "utf8");
  const transformed = lazifySheetSdkI18nProperties(source);
  assert.match(transformed, /get tabName\(\)\{return oa\("start"\)\}/);
  assert.match(transformed, /get label\(\)\{return la\("clipboard"\)\}/);
  assert.match(transformed, /,Ll=tr;/);
  assert.doesNotMatch(transformed, /Ll=tr\.map/);
  assert.doesNotMatch(transformed, /tabName:oa\("start"\)/);
});

test("a switched locale is visible on already-loaded tab config", () => {
  const source = lazifySheetSdkI18nProperties(
    'let locale="zh-CN";const oa=(key)=>({start:locale==="zh-CN"?"开始":"Start"})[key];const y2=(t,s)=>Object.assign(t,s);const tr=[{tab:"start",tabName:oa("start")}];let lr=0,Ll=tr.map(e=>y2({},e));globalThis.tabs=Ll;globalThis.setLocale=(next)=>{locale=next};',
  );
  const context = vm.createContext({ globalThis: {} });
  context.globalThis = context;
  vm.runInContext(source, context);
  assert.equal(String(context.tabs[0].tabName), "开始");
  vm.runInContext("setLocale('en-US')", context);
  assert.equal(String(context.tabs[0].tabName), "Start");
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractFacts } from "./facts.mjs";
import { distillFromFacts } from "./distill.mjs";

const mopPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../work/template/source.mop/content.json");

test("company template handbook groups cards and globals", { skip: !fs.existsSync(mopPath) }, () => {
  const distilled = distillFromFacts(extractFacts(JSON.parse(fs.readFileSync(mopPath, "utf8"))));
  const md = distilled.skillMarkdown;
  assert.match(md, /Template MOP fill handbook/);
  assert.doesNotMatch(md, /DO:|DON'T:/);
  assert.ok(distilled.handbook.globals.some((g) => g.id === "brand.name"));
  const grid = (i) => (distilled.handbook.pages.find((p) => p.index === i).modules || []).find((m) => m.kind === "card-grid")?.items || [];
  const sample = (i, id) => distilled.handbook.pages.find((p) => p.index === i).slots.find((s) => s.slotId === id)?.sample;
  const s13 = grid(13);
  assert.equal(s13.length, 4);
  assert.deepEqual(s13.map((c) => sample(13, c.titleSlot)), ["标题1", "标题2", "标题3", "标题4"]);
  const s18 = grid(18);
  assert.equal(s18.length, 6);
  assert.deepEqual(s18.map((c) => sample(18, c.titleSlot)), ["服务1", "服务2", "服务3", "服务4", "服务5", "服务6"]);
  const s9 = distilled.handbook.pages.find((p) => p.index === 9);
  assert.equal(s9.slots.find((s) => s.slotId === "s9-t1").role, "overview");
  assert.equal(grid(9).length, 3);
  const s28 = distilled.handbook.pages.find((p) => p.index === 28);
  assert.equal(s28.pageKind, "closing");
  assert.equal(s28.slots.find((s) => s.slotId === "s28-t0").role, "closing.message");
  assert.equal(s28.slots.find((s) => s.slotId === "s28-t1").role, "closing.kicker");
  assert.equal(grid(7).length, 3);
});

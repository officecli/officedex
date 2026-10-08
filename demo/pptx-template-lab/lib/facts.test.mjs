import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractFacts } from "./facts.mjs";

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../internal/pptxtemplate/testdata/two-slides.json",
);

test("extracts theme colors, fonts and cover text from a real MOP slice", () => {
  const facts = extractFacts(JSON.parse(fs.readFileSync(fixture, "utf8")));
  assert.equal(facts.pageCount, 2);
  assert.equal(facts.theme.colors.dark1, "#2A3033");
  assert.ok(facts.theme.majorFont);
  assert.ok(facts.textCount > 0);
  assert.ok(facts.slides[0].texts.length);
  assert.equal(facts.slides[0].texts[0].slotId, "s1-t0");
  assert.equal(facts.slides[0].texts[0].replaceable, true);
});

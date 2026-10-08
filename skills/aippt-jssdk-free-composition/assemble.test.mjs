import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assembleFreeDeck, itemsFromSlide, pagesFromContent } from "./assemble.mjs";

test("ticket-panels keep heading and detail instead of collapsing to letters", () => {
  const pages = pagesFromContent(
    {
      pages: [
        {
          title: "封面",
          subtitle: "说明",
          signature: "ticket-panels",
          items: [
            ["定位", "先说清拍给谁看"],
            ["生产", "做成可重复的周节奏"],
          ],
        },
      ],
    },
    { slides: [{ variant_selected: "ticket-panels" }] },
  );
  assert.equal(pages[0].signature, "ticket-panels");
  assert.deepEqual(pages[0].items[0], ["定位", "先说清拍给谁看"]);
});

test("unknown decorative variants map onto a mechanism drawer", () => {
  const pages = pagesFromContent(
    { slides: [{ title: "A", sections: [{ heading: "一", detail: "说明" }] }] },
    { slides: [{ variant_selected: "trapezoid-pendants" }] },
  );
  assert.equal(pages[0].signature, "icon-blocks");
});

test("assemble writes a Host program that paints with drawers", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "officedex-free-comp-"));
  const { source, pages } = await assembleFreeDeck({
    content: {
      title: "TikTok",
      pages: [
        {
          title: "TikTok 运营实践",
          subtitle: "可执行方法",
          items: [
            ["定位", "拍给谁看"],
            ["生产", "周节奏"],
            ["复盘", "写回选题"],
          ],
        },
      ],
    },
    plan: { slides: [{ variant_selected: "marker-columns" }] },
    outDir,
  });
  assert.equal(pages[0].signature, "marker-columns");
  assert.match(source, /export async function build/);
  assert.match(source, /paintPage/);
  assert.match(source, /getCount/);
  assert.doesNotMatch(source, /slides\.items/);
  const written = await readFile(path.join(outDir, "generated.mjs"), "utf8");
  assert.equal(written, source);
});

test("itemsFromSlide reads sections used by OfficeCLI payloads", () => {
  assert.deepEqual(
    itemsFromSlide({
      title: "能力",
      sections: [{ heading: "核心功能", detail: "主模块" }],
    }),
    [["核心功能", "主模块"]],
  );
});

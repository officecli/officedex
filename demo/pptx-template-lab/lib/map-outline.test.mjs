import assert from "node:assert/strict";
import test from "node:test";
import { mapOutlineToPages } from "./map-outline.mjs";
import { pageTypesFromHandbook } from "./page-types.mjs";
import { cloneMappedSlides } from "./clone.mjs";

test("8-page product outline maps onto company template page types", () => {
  const handbook = {
    pages: [
      { index: 1, pageKind: "cover", slots: [] },
      { index: 3, pageKind: "section-divider", slots: [] },
      { index: 13, pageKind: "parallel-4", slots: [] },
      { index: 14, pageKind: "parallel-4", slots: [] },
      { index: 9, pageKind: "team", slots: [] },
      { index: 18, pageKind: "parallel-6", slots: [] },
      { index: 21, pageKind: "kpi", slots: [] },
      { index: 28, pageKind: "closing", slots: [] },
      { index: 7, pageKind: "parallel-3", slots: [] },
    ],
  };
  const outline = {
    slides: [
      { purpose: "cover", bullets: ["realtime collab"] },
      { purpose: "section: about", bullets: [] },
      { purpose: "four services", bullets: ["docs", "sheets", "slides", "wiki"] },
      { purpose: "four more services", bullets: ["a", "b", "c", "d"] },
      { purpose: "team", bullets: ["lin", "zhou", "han"] },
      { purpose: "six capabilities", bullets: ["1", "2", "3", "4", "5", "6"] },
      { purpose: "market kpi 80%", bullets: ["80%", "60%"] },
      { purpose: "closing thanks", bullets: ["thanks"] },
    ],
  };
  const { mapping, warnings } = mapOutlineToPages(outline, pageTypesFromHandbook(handbook));
  assert.equal(mapping.length, 8);
  assert.equal(mapping[0].pageKind, "cover");
  assert.equal(mapping[0].sourceSlide, 1);
  assert.equal(mapping[1].pageKind, "section-divider");
  assert.equal(mapping[2].pageKind, "parallel-4");
  assert.equal(mapping[3].pageKind, "parallel-4");
  assert.equal(mapping[3].sourceSlide, 14);
  assert.equal(mapping[4].pageKind, "team");
  assert.equal(mapping[5].pageKind, "parallel-6");
  assert.equal(mapping[6].pageKind, "kpi");
  assert.equal(mapping[7].pageKind, "closing");
  assert.equal(warnings.length, 0);
});

test("cloneMappedSlides keeps theme and selected pages in outline order", () => {
  const mop = {
    blocks: [
      { type: "themes", data: [{ id: "theme-1" }] },
      { type: "slides", data: [{ name: "a" }, { name: "b" }, { name: "c" }] },
    ],
  };
  cloneMappedSlides(mop, [{ sourceSlide: 3 }, { sourceSlide: 1 }, { sourceSlide: 3 }]);
  const slides = mop.blocks.find((block) => block.type === "slides").data;
  assert.equal(slides.length, 3);
  assert.equal(slides[0].name, "c");
  assert.equal(slides[1].name, "a");
  assert.equal(slides[2].name, "c");
  assert.notEqual(slides[0], slides[2]);
  assert.equal(slides[0].attrs.logicalId, "slide-gen-1");
  assert.equal(slides[2].attrs.logicalId, "slide-gen-3");
  assert.equal(mop.blocks[0].data[0].id, "theme-1");
});

test("cloneMappedSlides remints object ids when a template page is reused", () => {
  const mop = {
    blocks: [
      {
        type: "slides",
        data: [
          {
            type: "slide",
            attrs: { logicalId: "slide-1" },
            data: [
              {
                type: "shape",
                attrs: { logicalId: "slide-1-object-1" },
                data: [],
              },
              {
                type: "connector",
                attrs: {
                  logicalId: "slide-1-object-2",
                  startTargetRef: "slide-1-object-1",
                  endTargetRef: "slide-1-object-1",
                },
                data: [],
              },
            ],
          },
        ],
      },
    ],
  };
  cloneMappedSlides(mop, [{ sourceSlide: 1 }, { sourceSlide: 1 }]);
  const slides = mop.blocks.find((block) => block.type === "slides").data;
  assert.equal(slides[0].data[0].attrs.logicalId, "slide-gen-1-object-1");
  assert.equal(slides[1].data[0].attrs.logicalId, "slide-gen-2-object-1");
  assert.equal(slides[1].data[1].attrs.startTargetRef, "slide-gen-2-object-1");
  assert.notEqual(slides[0].data[0].attrs.logicalId, slides[1].data[0].attrs.logicalId);
});

import assert from "node:assert/strict";
import test from "node:test";
import { fitLabeled, applyKnownFacts, leftoverPlaceholders, missingSlots, remapFillIds } from "./fill-plan.mjs";
import { classifyPicture } from "./images.mjs";

test("fitLabeled keeps prefix only when the value still fits", () => {
  assert.equal(fitLabeled("联系电话：xxxxxxxxxx", "400-000-0000", 17), "联系电话：400-000-0000");
  assert.equal(fitLabeled("联系电话：xxxxxxxxxx", "400-000-0000", 12), "400-000-0000");
  assert.equal(fitLabeled("联系地址：xxxxxxxxxxxxxx", "北京市海淀区", 12), "联系地址：北京市海淀区");
});

test("applyKnownFacts overwrites brand phone date presenter and closing", () => {
  const fills = [{ slotId: "s1-t1", text: "too long closing that should be replaced" }];
  applyKnownFacts(fills, [
    { slotId: "s1-t0", role: "brand.name", dataKind: "org-name", maxChars: 8 },
    { slotId: "s1-t2", role: "body", dataKind: "phone", maxChars: 14, sample: "联系电话：xxxxxxxxxx" },
    { slotId: "s1-t1", role: "closing.message", dataKind: "closing", maxChars: 6 },
  ], { brand: "石墨文档", phone: "400-000-0000", closingMessage: "感谢观看" });
  assert.equal(fills.find((fill) => fill.slotId === "s1-t0").text, "石墨文档");
  assert.equal(fills.find((fill) => fill.slotId === "s1-t1").text, "感谢观看");
  assert.ok([...fills.find((fill) => fill.slotId === "s1-t2").text].length <= 14);
});

test("remapFillIds rewrites source-slide ids onto cloned indexes", () => {
  const fills = [{ slotId: "s13-t3", text: "在线文档" }, { slotId: "s4-t3", text: "already new" }];
  remapFillIds(fills, [{ sourceSlide: 13, outlineIndex: 4 }]);
  assert.equal(fills[0].slotId, "s13-t3");
  assert.equal(fills[1].slotId, "s4-t3");
  remapFillIds(fills, [{ sourceSlide: 13, outlineIndex: 4 }]);
  const mapped = [{ slotId: "s13-t4", text: "body" }];
  remapFillIds(mapped, [{ sourceSlide: 13, outlineIndex: 4 }]);
  assert.equal(mapped[0].slotId, "s4-t4");
});

test("leftover and missing slot helpers", () => {
  const fills = [{ slotId: "s1-t0", text: "这是一段文字。您可以在此添加任意文字" }];
  assert.equal(leftoverPlaceholders(fills).length, 1);
  assert.deepEqual(missingSlots(fills, [{ slotId: "s1-t0" }, { slotId: "s1-t1", role: "title" }]).map((s) => s.slotId), ["s1-t1"]);
});

test("classifyPicture keeps chrome and icons, flags portraits as photos", () => {
  const canvas = { widthPt: 960, heightPt: 540 };
  assert.equal(classifyPicture({ width: 960, height: 540 }, "cover", canvas), "chrome");
  assert.equal(classifyPicture({ width: 40, height: 40 }, "parallel-3", canvas), "icon");
  assert.equal(classifyPicture({ width: 160, height: 360 }, "team", canvas), "photo");
  assert.equal(classifyPicture({ width: 241, height: 180 }, "parallel-4", canvas), "photo");
  assert.equal(classifyPicture({ width: 80, height: 40, logo: true }, "cover", canvas), "logo");
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fontFamilyOf, verifyBundledFonts } from "./verify-bundled-fonts.mjs";

async function bundleWith(...fileNames) {
  const root = await mkdtemp(path.join(os.tmpdir(), "font-gate-"));
  const assets = path.join(root, "assets");
  await mkdir(assets, { recursive: true });
  for (const name of fileNames) {
    await writeFile(path.join(assets, name), "");
  }
  return root;
}

test("a commercial face reaching the bundle fails the build", async () => {
  // This is the case the gate exists for: the HanYi and DengXian faces arrived
  // through the presentation runtime and shipped without a licence covering
  // redistribution.
  const root = await bundleWith("hy-zhong-hei-BZqOcrk.woff", "inter-latin-400-abc12345.woff2");
  await assert.rejects(
    verifyBundledFonts([root]),
    /HanYi commercial typefaces/,
  );
});

test("Microsoft DengXian is refused as well", async () => {
  const root = await bundleWith("dengxian-light-BHyCyYhc.woff");
  await assert.rejects(verifyBundledFonts([root]), /not redistributable/i);
});

test("an unfamiliar family fails rather than passing unnoticed", async () => {
  const root = await bundleWith("SomeNewFace-Regular-QQ1234567.woff2");
  await assert.rejects(verifyBundledFonts([root]), /is not in scripts\/bundled-font-allowlist\.json/);
});

test("licensed families pass and unresolved ones are reported, not failed", async () => {
  const root = await bundleWith(
    "inter-latin-600-BvOeHRLc.woff2",
    "KaTeX_Main-Regular-B22Nviop.woff2",
    "lucide-icons-BQp5NevF.woff2",
  );
  const result = await verifyBundledFonts([root]);
  assert.equal(result.checked, 3);
  assert.deepEqual(result.pending, ["lucide"]);
});

test("the reviewed watermark face ships, and is reported rather than silent", async () => {
  // writer rasters CJK VML ArtText watermarks from 汉仪中黑KW specifically, so
  // this one file is exempt from the 'hy' denial. It is surfaced every run.
  const root = await bundleWith("hyzhongheikw.woff");
  const result = await verifyBundledFonts([root]);
  assert.deepEqual(result.exempted, ["hyzhongheikw.woff"]);
  assert.deepEqual(result.pending, []);
});

test("the exemption covers one file, not the rest of the foundry", async () => {
  // The names writer ships have no hyphen, so the marker has to match them too.
  const root = await bundleWith("hyzhongheikw.woff", "hyshusongerkw.woff");
  await assert.rejects(verifyBundledFonts([root]), /HanYi commercial typefaces/);
});

test("the OFL faces writer bundles are all covered", async () => {
  const root = await bundleWith(
    "SourceHanSansCN-Regular.woff",
    "SourceHanSerifCN-Bold.woff",
    "NotoSansJP-Regular.woff",
    "NotoSerifJP-Regular.woff",
    "Amiri-BoldItalic.woff",
    "SourceCodePro.woff",
  );
  const result = await verifyBundledFonts([root]);
  assert.equal(result.checked, 6);
  assert.deepEqual(result.pending, []);
});

test("family detection strips the build hash and the weight suffix", () => {
  assert.equal(fontFamilyOf("inter-latin-600-BvOeHRLc.woff2"), "inter");
  assert.equal(fontFamilyOf("KaTeX_Main-Regular-B22Nviop.woff2"), "katex");
  assert.equal(fontFamilyOf("hy-kai-ti-Cx95UuP2.woff"), "hy");
});

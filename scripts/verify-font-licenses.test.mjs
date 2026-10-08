import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyFontLicenses } from "./verify-font-licenses.mjs";

async function createFixture({ includeMissingFont = false } = {}) {
  const fontsDir = await mkdtemp(path.join(os.tmpdir(), "officedex-font-licenses-"));
  await mkdir(path.join(fontsDir, "licenses"), { recursive: true });
  await writeFile(path.join(fontsDir, "Inter.woff2"), "font");
  if (includeMissingFont) await writeFile(path.join(fontsDir, "Missing.woff2"), "font");
  await writeFile(path.join(fontsDir, "licenses", "OFL-1.1.txt"), "SIL Open Font License 1.1\n");
  await writeFile(path.join(fontsDir, "LICENSES.json"), `${JSON.stringify({
    "Inter.woff2": {
      family: "Inter",
      license: "SIL Open Font License 1.1",
      licenseFile: "licenses/OFL-1.1.txt",
      source: "https://github.com/rsms/inter",
    },
  }, null, 2)}\n`);
  return fontsDir;
}

test("accepts a font directory with complete license metadata", async () => {
  const fontsDir = await createFixture();
  const result = await verifyFontLicenses(fontsDir);
  assert.deepEqual(result.fonts, ["Inter.woff2"]);
});

test("rejects every shipped font missing license metadata", async () => {
  const fontsDir = await createFixture({ includeMissingFont: true });
  await assert.rejects(verifyFontLicenses(fontsDir), /Missing font license metadata.*Missing\.woff2/i);
});

test("rejects manifest entries whose declared license file is absent", async () => {
  const fontsDir = await createFixture();
  await writeFile(path.join(fontsDir, "LICENSES.json"), `${JSON.stringify({
    "Inter.woff2": {
      family: "Inter",
      license: "SIL Open Font License 1.1",
      licenseFile: "licenses/missing.txt",
      source: "https://github.com/rsms/inter",
    },
  }, null, 2)}\n`);
  await assert.rejects(verifyFontLicenses(fontsDir), /Font license file is missing.*licenses\/missing\.txt/i);
});

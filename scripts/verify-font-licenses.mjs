import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_FIELDS = ["family", "license", "licenseFile", "source"];

export async function verifyFontLicenses(fontsDir) {
  if (!fontsDir) throw new Error("Font directory is required");
  const manifestPath = path.join(fontsDir, "LICENSES.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const fonts = (await readdir(fontsDir)).filter((name) => name.endsWith(".woff2")).sort();

  for (const font of fonts) {
    const metadata = manifest[font];
    if (!metadata) throw new Error(`Missing font license metadata for ${font}`);
    for (const field of REQUIRED_FIELDS) {
      if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
        throw new Error(`Missing ${field} in font license metadata for ${font}`);
      }
    }
    const licensePath = path.resolve(fontsDir, metadata.licenseFile);
    const relativeLicensePath = path.relative(fontsDir, licensePath);
    if (relativeLicensePath.startsWith("..") || path.isAbsolute(relativeLicensePath)) {
      throw new Error(`Font license file escapes the font directory for ${font}: ${metadata.licenseFile}`);
    }
    try {
      await access(licensePath);
    } catch {
      throw new Error(`Font license file is missing for ${font}: ${metadata.licenseFile}`);
    }
  }

  const staleEntries = Object.keys(manifest).filter((font) => !fonts.includes(font));
  if (staleEntries.length > 0) {
    throw new Error(`Font license metadata references unshipped fonts: ${staleEntries.sort().join(", ")}`);
  }

  return { fonts, manifestPath };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyFontLicenses(process.argv[2])
    .then(({ fonts }) => console.log(`Verified font license metadata for ${fonts.length} fonts.`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

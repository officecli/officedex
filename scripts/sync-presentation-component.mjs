import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = 1;

export async function syncPresentationComponent({ distDir, publicDir, sourceRevision }) {
  if (!distDir || !publicDir) {
    throw new Error("distDir and publicDir are required");
  }
  const indexPath = path.join(distDir, "index.html");
  const index = await readFile(indexPath, "utf8");
  if (!/<script\b[^>]*type=["']module["']/i.test(index)) {
    throw new Error(`Presentation component index has no module entry: ${indexPath}`);
  }
  await rm(publicDir, { recursive: true, force: true });
  await mkdir(path.dirname(publicDir), { recursive: true });
  await cp(distDir, publicDir, { recursive: true });
  await writeFile(
    path.join(publicDir, "officedex-component.json"),
    `${JSON.stringify({
      name: "learnof/pptx",
      protocolVersion: PROTOCOL_VERSION,
      sourceRevision: sourceRevision || "unknown",
    }, null, 2)}\n`,
  );
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return {
    distDir: values.get("dist"),
    publicDir: values.get("public"),
    sourceRevision: values.get("source-revision"),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncPresentationComponent(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

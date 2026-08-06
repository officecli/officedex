import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vendorName = ["shi", "mo"].join("");
const forbiddenMarkers = [
  vendorName,
  `@${vendorName}/`,
  ["sdk", "sheet"].join("-"),
  ["office2", "modoc"].join(""),
  ["weboffice", "design"].join("-"),
  `${vendorName}dev.com`,
];
const textExtensions = new Set([".cjs", ".css", ".go", ".html", ".js", ".json", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const excludedDirectories = new Set([".git", "build", "dist", "node_modules", "third_party"]);
const verifierFiles = new Set(["scripts/verify-release-boundary.mjs", "scripts/verify-release-boundary.test.mjs"]);

async function collectTextFiles(root, entry, { includeBuildOutput = false } = {}) {
  const absolute = path.join(root, entry);
  let info;
  try {
    info = await stat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (info.isFile()) return textExtensions.has(path.extname(entry)) ? [entry] : [];
  if (!info.isDirectory()) return [];

  const files = [];
  for (const child of await readdir(absolute)) {
    if (!includeBuildOutput && excludedDirectories.has(child)) continue;
    files.push(...await collectTextFiles(root, path.join(entry, child), { includeBuildOutput }));
  }
  return files;
}

function findForbiddenMarker(content) {
  const normalized = content.toLowerCase();
  return forbiddenMarkers.find((marker) => normalized.includes(marker));
}

async function scanFiles(root, files) {
  const violations = [];
  for (const relativePath of files) {
    const normalizedPath = relativePath.split(path.sep).join("/");
    if (verifierFiles.has(normalizedPath)) continue;
    const marker = findForbiddenMarker(await readFile(path.join(root, relativePath), "utf8"));
    if (marker) violations.push(`${normalizedPath}: forbidden vendor marker ${JSON.stringify(marker)}`);
  }
  return violations;
}

export async function verifyReleaseBoundary({ root = process.cwd(), distPath } = {}) {
  const absoluteRoot = path.resolve(root);
  const rootFiles = (await readdir(absoluteRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && textExtensions.has(path.extname(entry.name)))
    .map((entry) => entry.name);
  const sourceEntries = [".github", "internal", "public", "scripts", "src", ...rootFiles];
  const sourceFiles = (await Promise.all(sourceEntries.map((entry) => collectTextFiles(absoluteRoot, entry)))).flat();
  const violations = await scanFiles(absoluteRoot, sourceFiles);

  let distFiles = [];
  if (distPath) {
    const absoluteDist = path.resolve(absoluteRoot, distPath);
    const relativeDist = path.relative(absoluteRoot, absoluteDist);
    distFiles = await collectTextFiles(absoluteRoot, relativeDist, { includeBuildOutput: true });
    violations.push(...await scanFiles(absoluteRoot, distFiles));
  }

  if (violations.length > 0) {
    throw new Error(`Release boundary violation:\n${violations.join("\n")}`);
  }
  return { sourceFiles: sourceFiles.length, distFiles: distFiles.length };
}

function parseArgs(argv) {
  const options = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--root" || key === "--dist") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${key}`);
      if (key === "--root") options.root = value;
      else options.distPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${key}`);
  }
  return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  verifyReleaseBoundary(parseArgs(process.argv.slice(2)))
    .then(({ sourceFiles, distFiles }) => console.log(`Verified release boundary across ${sourceFiles} source files and ${distFiles} dist files.`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

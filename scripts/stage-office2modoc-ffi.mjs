#!/usr/bin/env node
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const version = (await readFile(new URL("../office2modoc.version", import.meta.url), "utf8")).trim();
const target = process.env.OFFICE2MODOC_TARGET || (process.platform === "darwin" ? "aarch64-apple-darwin" : process.platform === "win32" ? "x86_64-pc-windows-msvc" : `${process.arch}-unknown-linux-gnu`);
const sourceRoot = path.resolve(process.env.OFFICE2MODOC_SOURCE_ROOT || path.join(process.cwd(), "..", "officecli-internal"));
const assetRoot = path.join(sourceRoot, "third_party", "office2modoc-ffi", version, target);
const fileName = target.includes("apple") ? "liboffice2modoc_ffi.dylib" : target.includes("windows") ? "office2modoc_ffi.dll" : "liboffice2modoc_ffi.so";
const source = path.join(assetRoot, fileName);
// The cache directory is keyed by the arch vocabulary build-mac-dmg.sh uses
// (darwin-arm64, darwin-x64), not by the Rust target triple, so an Intel dylib
// must not land in the arm64 directory and get packaged into the wrong app.
function cacheDirName(triple) {
  const arch = triple.startsWith("aarch64") ? "arm64" : triple.startsWith("x86_64") ? "x64" : triple.split("-")[0];
  if (triple.includes("apple")) return `darwin-${arch}`;
  if (triple.includes("windows")) return `windows-${arch === "x64" ? "amd64" : arch}`;
  return `linux-${arch === "x64" ? "amd64" : arch}`;
}
const destination = path.resolve(process.env.OFFICE2MODOC_OUTPUT || path.join(process.cwd(), "build", "cache", "office2modoc", version, cacheDirName(target), fileName));

await access(source);
const manifest = JSON.parse(await readFile(path.join(sourceRoot, "third_party", "office2modoc-ffi", version, "manifest.json"), "utf8"));
const expected = manifest.artifacts?.[target]?.sha256;
if (!expected) throw new Error(`office2modoc manifest has no checksum for ${target}`);
const actual = createHash("sha256").update(await readFile(source)).digest("hex");
if (actual !== expected) throw new Error(`office2modoc checksum mismatch for ${target}: ${actual}`);
await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log(`staged office2modoc ${target} -> ${destination} (${actual})`);

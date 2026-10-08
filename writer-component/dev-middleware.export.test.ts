import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { exportDocxFromMowZip } from "./dev-middleware";

const CELL_TEXT = "Ready for release";
const CONVERT = path.resolve("build/writer-convert/convert");

describe("exportDocxFromMowZip", () => {
  it("exports a nodeId-bearing table through the staged converter and keeps the cell text", async () => {
    const zip = await tablePackageWithNodeIds();
    const docx = await exportDocxFromMowZip(CONVERT, zip);
    const xml = unzipPart(docx, "word/document.xml");
    expect(xml).toContain(CELL_TEXT);
  });

  it("still rejects an unknown table attr key", async () => {
    const zip = await tablePackageWithNodeIds((snapshot) => {
      const table = findBlock(snapshot, "tbl");
      expect(table).toBeTruthy();
      const attrs = (table!.attrs ??= {});
      attrs.notARealKey = "x";
    });
    await expect(exportDocxFromMowZip(CONVERT, zip)).rejects.toThrow(/unknown tbl attr key/);
  });
});

async function tablePackageWithNodeIds(mutate?: (snapshot: Snapshot) => void): Promise<Buffer> {
  const root = await mkdtemp(path.join(tmpdir(), "officedex-export-fixture-"));
  try {
    const input = path.join(root, "table.docx");
    await writeFile(input, tableDocx(CELL_TEXT));
    const packageDir = path.join(root, "document.mow.dir");
    await runConvert(["import", "-i", input, "-m", packageDir]);
    const contentPath = path.join(packageDir, "content.json");
    const snapshot = JSON.parse(await readFile(contentPath, "utf8")) as Snapshot;
    if (!stampNodeIds(snapshot)) throw new Error("imported snapshot has no table topology");
    mutate?.(snapshot);
    await writeFile(contentPath, JSON.stringify(snapshot));
    const entries = await directoryEntries(packageDir);
    return Buffer.from(zipSync(entries));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function stampNodeIds(value: unknown): boolean {
  const ids: Record<string, string> = {
    tbl: "table",
    tableGrid: "grid",
    row: "row",
    cell: "cell",
    p: "paragraph",
    run: "run",
  };
  let stamped = false;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const block = node as SnapshotBlock;
    const id = ids[block.type ?? ""];
    if (id !== undefined) {
      block.attrs ??= {};
      block.attrs.nodeId = id;
      stamped = true;
    }
    for (const child of Object.values(block)) visit(child);
  };
  visit(value);
  return stamped;
}

function findBlock(value: unknown, type: string): SnapshotBlock | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findBlock(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const block = value as SnapshotBlock;
  if (block.type === type) return block;
  for (const child of Object.values(block)) {
    const found = findBlock(child, type);
    if (found) return found;
  }
  return undefined;
}

async function directoryEntries(root: string): Promise<Record<string, Uint8Array>> {
  const { readdir } = await import("node:fs/promises");
  const entries: Record<string, Uint8Array> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, child.name);
      if (child.isDirectory()) await visit(full);
      else if (child.isFile()) {
        entries[path.relative(root, full).split(path.sep).join("/")] = new Uint8Array(await readFile(full));
      }
    }
  };
  await visit(root);
  return entries;
}

function unzipPart(docx: Buffer, name: string): string {
  const entries = unzipSync(new Uint8Array(docx));
  const part = entries[name];
  if (part === undefined) throw new Error(`docx is missing ${name}`);
  return new TextDecoder().decode(part);
}

function runConvert(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(CONVERT, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `convert exited ${String(code)}`));
    });
  });
}

function tableDocx(cellText: string): Buffer {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>
      <w:tr><w:tc><w:p><w:r><w:t>${cellText}</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`,
  };
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) encoded[name] = new TextEncoder().encode(content);
  return Buffer.from(zipSync(encoded));
}

interface SnapshotBlock {
  type?: string;
  attrs?: Record<string, unknown>;
  [key: string]: unknown;
}

type Snapshot = SnapshotBlock;

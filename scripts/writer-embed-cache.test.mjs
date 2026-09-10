import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkWriterEmbedCache,
  computeDirectoryFingerprint,
  computeWriterSourceFingerprint,
  isGitRepository,
  writeWriterEmbedCache,
  writerEmbedEnvFingerprint,
} from "./writer-embed-cache.mjs";

async function makeTempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function createGitRepo(t) {
  const dir = await makeTempDir(t, "officedex-writer-cache-git-");
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "OfficeDex Test");
  git("config", "commit.gpgsign", "false");
  await writeFile(path.join(dir, "tracked.txt"), "tracked\n");
  await mkdir(path.join(dir, "nested"), { recursive: true });
  await writeFile(path.join(dir, "nested", "value.txt"), "value\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return { dir, git };
}

async function createPublicTree(t) {
  const dir = await makeTempDir(t, "officedex-writer-cache-public-");
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "index.html"), '<script type="module"></script>');
  await writeFile(path.join(dir, "assets", "app.js"), "export {};\n");
  return dir;
}

async function createRecordPath(t) {
  const dir = await makeTempDir(t, "officedex-writer-cache-record-");
  return path.join(dir, "record.json");
}

test("writer source fingerprint is stable and follows tracked, untracked and env changes", async (t) => {
  const { dir } = await createGitRepo(t);
  const first = await computeWriterSourceFingerprint({ sourceDir: dir });
  assert.equal(await computeWriterSourceFingerprint({ sourceDir: dir }), first);

  await writeFile(path.join(dir, "tracked.txt"), "changed\n");
  const trackedChanged = await computeWriterSourceFingerprint({ sourceDir: dir });
  assert.notEqual(trackedChanged, first);

  await writeFile(path.join(dir, "untracked.txt"), "untracked\n");
  const untrackedAdded = await computeWriterSourceFingerprint({ sourceDir: dir });
  assert.notEqual(untrackedAdded, trackedChanged);

  await writeFile(path.join(dir, "untracked.txt"), "untracked again\n");
  assert.notEqual(
    await computeWriterSourceFingerprint({ sourceDir: dir }),
    untrackedAdded,
  );

  const envA = await computeWriterSourceFingerprint({
    sourceDir: dir,
    env: { WRITER_LEGACY_FONT_DIR: "/tmp/fonts-a" },
  });
  const envB = await computeWriterSourceFingerprint({
    sourceDir: dir,
    env: { WRITER_LEGACY_FONT_DIR: "/tmp/fonts-b" },
  });
  assert.notEqual(envA, envB);

  const extraA = await computeWriterSourceFingerprint({
    sourceDir: dir,
    extraFingerprints: { "build-embedded-writer.sh": "a" },
  });
  const extraB = await computeWriterSourceFingerprint({
    sourceDir: dir,
    extraFingerprints: { "build-embedded-writer.sh": "b" },
  });
  assert.notEqual(extraA, extraB);
});

test("directory fingerprint follows added, removed and modified files", async (t) => {
  const dir = await createPublicTree(t);
  const first = await computeDirectoryFingerprint({ dir });
  assert.equal(await computeDirectoryFingerprint({ dir }), first);

  await writeFile(path.join(dir, "assets", "app.js"), "export const x = 1;\n");
  const modified = await computeDirectoryFingerprint({ dir });
  assert.notEqual(modified, first);

  await writeFile(path.join(dir, "extra.txt"), "extra\n");
  const added = await computeDirectoryFingerprint({ dir });
  assert.notEqual(added, modified);

  await rm(path.join(dir, "extra.txt"));
  assert.equal(await computeDirectoryFingerprint({ dir }), modified);
});

test("cache misses without a record, then hits, then follows source changes", async (t) => {
  const { dir } = await createGitRepo(t);
  const publicDir = await createPublicTree(t);
  const recordPath = await createRecordPath(t);

  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "no-record" },
  );

  await writeWriterEmbedCache({ sourceDir: dir, publicDir, recordPath });
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: true, reason: "hit" },
  );

  await writeFile(path.join(dir, "tracked.txt"), "changed\n");
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "source-changed" },
  );
});

test("cache misses when the synced public tree changed or disappeared", async (t) => {
  const { dir } = await createGitRepo(t);
  const publicDir = await createPublicTree(t);
  const recordPath = await createRecordPath(t);
  await writeWriterEmbedCache({ sourceDir: dir, publicDir, recordPath });

  await writeFile(path.join(publicDir, "assets", "app.js"), "export const y = 1;\n");
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "public-changed" },
  );

  await rm(publicDir, { recursive: true, force: true });
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "public-missing" },
  );
});

test("cache misses when the staged build/writer/dist tree is missing", async (t) => {
  const { dir } = await createGitRepo(t);
  const publicDir = await createPublicTree(t);
  const distDir = await makeTempDir(t, "officedex-writer-cache-dist-");
  await writeFile(path.join(distDir, "index.html"), '<script type="module"></script>');
  const recordPath = await createRecordPath(t);
  await writeWriterEmbedCache({ sourceDir: dir, publicDir, recordPath });

  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, distDir, recordPath }),
    { hit: true, reason: "hit" },
  );

  await rm(path.join(distDir, "index.html"));
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, distDir, recordPath }),
    { hit: false, reason: "dist-missing" },
  );
});

test("cache never hits for a source that is not a git checkout", async (t) => {
  const dir = await makeTempDir(t, "officedex-writer-cache-nongit-");
  await writeFile(path.join(dir, "file.txt"), "x\n");
  const publicDir = await createPublicTree(t);
  const recordPath = await createRecordPath(t);

  assert.equal(isGitRepository(dir), false);
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "no-record" },
  );

  await writeFile(
    recordPath,
    `${JSON.stringify(
      { version: 1, sourceFingerprint: "source", publicFingerprint: "public" },
      null,
      2,
    )}\n`,
  );
  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "source-not-git" },
  );
});

test("cache misses on a record written by an incompatible version", async (t) => {
  const { dir } = await createGitRepo(t);
  const publicDir = await createPublicTree(t);
  const recordPath = await createRecordPath(t);
  await writeWriterEmbedCache({ sourceDir: dir, publicDir, recordPath });
  await writeFile(recordPath, `${JSON.stringify({ version: 0 })}\n`);

  assert.deepEqual(
    await checkWriterEmbedCache({ sourceDir: dir, publicDir, recordPath }),
    { hit: false, reason: "record-invalid" },
  );
});

test("env fingerprint only carries output-affecting variables", () => {
  assert.deepEqual(
    writerEmbedEnvFingerprint({
      WRITER_LEGACY_FONT_DIR: "/fonts",
      WRITER_SOURCE_REVISION: "deadbeef",
      WRITER_SKIP_INSTALL: "1",
      WRITER_NPM_REGISTRY: "https://example.invalid",
    }),
    { WRITER_LEGACY_FONT_DIR: "/fonts", WRITER_SOURCE_REVISION: "deadbeef" },
  );
});

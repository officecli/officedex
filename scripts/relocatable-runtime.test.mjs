import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fakePortableExecutable } from "./pe-executable.mjs";
import {
  canExecuteRuntime,
  foreignDependencies,
  readMachODependencies,
  verifyRelocatableRuntime,
} from "./relocatable-runtime.mjs";

/**
 * A runtime directory whose `node` is a shell script. The dependency reader is
 * injected in the tests that care about dependencies, so the fixture does not
 * have to be a real Mach-O binary to exercise everything around it.
 */
async function runtimeTree({ script = '#!/bin/sh\necho v24.18.0\n', mode = 0o755 } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-"));
  const dir = path.join(root, "mop-runtime");
  await mkdir(path.join(dir, "bin"), { recursive: true });
  const executable = path.join(dir, "bin", "node");
  await writeFile(executable, script);
  await chmod(executable, mode);
  return { root, dir, executable };
}

const systemOnly = async () => ["/usr/lib/libSystem.B.dylib", "/System/Library/Frameworks/Security.framework/Versions/A/Security"];

// The fixture's `node` is a shell script, which Windows cannot start; the
// tests that only need "it ran and said a version" inject the run instead.
const saysVersion = async () => ({ stdout: "v24.18.0\n" });

test("a self-contained runtime that runs is accepted", async () => {
  const { root, dir } = await runtimeTree();
  const result = await verifyRelocatableRuntime(dir, {
    platform: "darwin",
    hostPlatform: "darwin",
    readDependencies: systemOnly,
    run: saysVersion,
  });
  assert.equal(result.version, "v24.18.0");
  await rm(root, { recursive: true, force: true });
});

test("Homebrew's node is rejected, and every borrowed library is named", async () => {
  // The staging fallback that caused this: a package manager's node loads
  // libnode and two dozen others from where it was installed, and the bundle
  // carries none of them.
  const { root, dir } = await runtimeTree();
  const homebrewDependencies = async () => [
    "@rpath/libnode.147.dylib",
    "/usr/lib/libz.1.dylib",
    "/opt/homebrew/opt/icu4c@78/lib/libicuuc.78.dylib",
  ];
  await assert.rejects(
    verifyRelocatableRuntime(dir, { platform: "darwin", readDependencies: homebrewDependencies }),
    (error) => {
      assert.match(error.message, /@rpath\/libnode\.147\.dylib/);
      assert.match(error.message, /libicuuc/);
      assert.doesNotMatch(error.message, /libz/, "system libraries are not defects");
      return true;
    },
  );
  await rm(root, { recursive: true, force: true });
});

test("a runtime staged as a symlink is rejected before anything runs it", async () => {
  // The symlink is why the old check passed: it still resolved to the tree it
  // was about to be separated from. Bundling copies the file, not the tree.
  const { root, dir, executable } = await runtimeTree();
  const elsewhere = path.join(root, "cellar-node");
  await writeFile(elsewhere, '#!/bin/sh\necho v26.3.1\n');
  await chmod(elsewhere, 0o755);
  await rm(executable);
  await symlink(elsewhere, executable);

  await assert.rejects(
    verifyRelocatableRuntime(dir, { platform: "darwin", readDependencies: systemOnly }),
    /symlink/,
  );
  await rm(root, { recursive: true, force: true });
});

test("a runtime that does not execute is rejected", async () => {
  const { root, dir } = await runtimeTree({ mode: 0o644 });
  const refuses = async () => {
    const error = new Error("spawn EACCES");
    error.stderr = "";
    throw error;
  };
  await assert.rejects(
    verifyRelocatableRuntime(dir, { platform: "darwin", hostPlatform: "darwin", readDependencies: systemOnly, run: refuses }),
    /does not run from/,
  );
  await rm(root, { recursive: true, force: true });
});

test("a missing runtime is reported as missing, not as a crash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "runtime-"));
  await assert.rejects(
    verifyRelocatableRuntime(path.join(root, "mop-runtime"), { platform: "darwin" }),
    /no runtime executable at/,
  );
  await rm(root, { recursive: true, force: true });
});

test("relocate proves the runtime somewhere other than where it was staged", async () => {
  // A runtime that only works next to its staging directory is the whole bug,
  // so the probe has to happen after a move. This fixture reports where it ran
  // from; that path must not be the staging directory.
  const { root, dir } = await runtimeTree({ script: '#!/bin/sh\necho v24.18.0\n' });
  const result = await verifyRelocatableRuntime(dir, {
    platform: "darwin",
    hostPlatform: "darwin",
    relocate: true,
    readDependencies: systemOnly,
    run: saysVersion,
  });
  assert.notEqual(result.provenFrom, dir);
  assert.equal(result.version, "v24.18.0");
  await rm(root, { recursive: true, force: true });
});

test("foreignDependencies keeps OS libraries and returns the rest", () => {
  assert.deepEqual(
    foreignDependencies([
      "/usr/lib/libSystem.B.dylib",
      "/System/Library/Frameworks/Security.framework/Versions/A/Security",
      "@rpath/libnode.147.dylib",
      "/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib",
      "/usr/local/lib/libfoo.dylib",
    ]),
    ["@rpath/libnode.147.dylib", "/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib", "/usr/local/lib/libfoo.dylib"],
  );
});

test("readMachODependencies drops otool's first line, which is the binary", async () => {
  const run = async () => ({
    stdout: [
      "/path/to/node:",
      "\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)",
      "\t@rpath/libnode.147.dylib (compatibility version 0.0.0, current version 0.0.0)",
      "",
    ].join("\n"),
  });
  assert.deepEqual(await readMachODependencies("/path/to/node", { run }), [
    "/usr/lib/libSystem.B.dylib",
    "@rpath/libnode.147.dylib",
  ]);
});

test("a cross-built Windows runtime is checked as a file and reported as not run", async () => {
  // A Mac cannot start node.exe. The honest result is "present, well-formed,
  // never executed", with the reason attached, so runtime.json cannot claim a
  // verification that did not happen.
  const { root, dir } = await runtimeTree();
  await rm(path.join(dir, "bin", "node"));
  await writeFile(path.join(dir, "bin", "node.exe"), fakePortableExecutable());
  const neverRun = async () => {
    throw new Error("the probe must not execute a foreign binary");
  };
  const result = await verifyRelocatableRuntime(dir, {
    platform: "win32",
    arch: "x64",
    hostPlatform: "darwin",
    probe: false,
    relocate: true,
    run: neverRun,
  });
  assert.equal(result.probed, false);
  assert.equal(result.version, null);
  assert.match(result.unverifiedReason, /cross-build/);
  assert.match(result.unverifiedReason, /windows-smoke/);
  assert.deepEqual(result.fileChecks, { symlink: false, regularFile: true, format: "PE32+", machine: "x86-64" });
  await rm(root, { recursive: true, force: true });
});

test("a cross-built Windows runtime that is not a PE32+ x86-64 image is rejected", async () => {
  // The one thing the headers can prove, so it is enforced: an arm64 node.exe
  // in the x64 slice would start on no customer machine.
  const { root, dir } = await runtimeTree();
  await rm(path.join(dir, "bin", "node"));
  await writeFile(path.join(dir, "bin", "node.exe"), fakePortableExecutable({ machine: 0xaa64 }));
  await assert.rejects(
    verifyRelocatableRuntime(dir, { platform: "win32", arch: "x64", hostPlatform: "darwin", probe: false }),
    /PE32\+ arm64; a x64 Windows package needs PE32\+ x86-64/,
  );
  await rm(root, { recursive: true, force: true });
});

test("skipping the probe is refused when this host could run the runtime", async () => {
  // "Skip verification" must not become a flag anyone can pass to make a
  // native build green; it is only for the case where running is impossible.
  const { root, dir } = await runtimeTree();
  await assert.rejects(
    verifyRelocatableRuntime(dir, { platform: "darwin", hostPlatform: "darwin", probe: false, readDependencies: systemOnly }),
    /refusing to skip the execution probe/,
  );
  await rm(root, { recursive: true, force: true });
});

test("canExecuteRuntime is decided by platform, not architecture", () => {
  assert.equal(canExecuteRuntime("darwin", "darwin"), true);
  assert.equal(canExecuteRuntime("win32", "darwin"), false);
  assert.equal(canExecuteRuntime("win32", "win32"), true);
});

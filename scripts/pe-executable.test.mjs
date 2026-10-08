import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPortableExecutable,
  expectedMachineForArch,
  fakePortableExecutable,
  inspectPortableExecutable,
} from "./pe-executable.mjs";

async function fixture(bytes) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pe-"));
  const file = path.join(dir, "sample.exe");
  await writeFile(file, bytes);
  return { dir, file };
}

test("a PE32+ x86-64 image is classified from its headers", async () => {
  const { dir, file } = await fixture(fakePortableExecutable());
  assert.deepEqual(await inspectPortableExecutable(file), { format: "PE32+", machine: "x86-64" });
  assert.deepEqual(await assertPortableExecutable(file, "x64"), { format: "PE32+", machine: "x86-64" });
  await rm(dir, { recursive: true, force: true });
});

test("the wrong CPU or a 32-bit image is refused for a win32-x64 slice", async () => {
  const arm = await fixture(fakePortableExecutable({ machine: 0xaa64 }));
  await assert.rejects(assertPortableExecutable(arm.file, "x64"), /PE32\+ arm64; a x64 Windows package needs PE32\+ x86-64/);
  await rm(arm.dir, { recursive: true, force: true });

  const pe32 = await fixture(fakePortableExecutable({ magic: 0x10b, machine: 0x014c }));
  await assert.rejects(assertPortableExecutable(pe32.file, "x64"), /PE32 i386/);
  await rm(pe32.dir, { recursive: true, force: true });
});

test("a file that is not a PE image is named as such, not misread", async () => {
  // A Mach-O copied into the Windows slice is the realistic mistake.
  const machO = Buffer.alloc(64);
  machO.writeUInt32LE(0xfeedfacf, 0);
  const { dir, file } = await fixture(machO);
  await assert.rejects(inspectPortableExecutable(file), /not a PE image \(no MZ header\)/);
  await rm(dir, { recursive: true, force: true });
});

test("arch names map to the machine the linker must have targeted", () => {
  assert.equal(expectedMachineForArch("x64"), "x86-64");
  assert.equal(expectedMachineForArch("amd64"), "x86-64");
  assert.equal(expectedMachineForArch("arm64"), "arm64");
  assert.throws(() => expectedMachineForArch("ia32"), /no PE machine type/);
});

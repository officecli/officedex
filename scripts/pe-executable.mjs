#!/usr/bin/env node
// Reads the two facts a Windows build cares about from a PE file: whether it
// is a 64-bit image (PE32+) and which CPU it was linked for.
//
// A Windows package assembled on a Mac cannot run any of its executables, so
// "does node.exe start" and "is mop-convert.exe really x86-64" are answered
// here from the file headers instead, and the gap between the two kinds of
// proof is recorded by the caller rather than papered over.
//
// Only the headers are parsed: the DOS stub's e_lfanew pointer, the "PE\0\0"
// signature, the COFF machine field and the optional header magic.

import { open } from "node:fs/promises";
import { basename } from "node:path";

/** IMAGE_FILE_MACHINE_* values that can ship in an OfficeDex package. */
export const PE_MACHINES = Object.freeze({
  0x8664: "x86-64",
  0xaa64: "arm64",
  0x014c: "i386",
});

const PE_FORMATS = Object.freeze({
  0x20b: "PE32+",
  0x10b: "PE32",
});

/** The machine a `<platform>-<arch>` build slice must be linked for. */
export function expectedMachineForArch(arch) {
  switch (arch) {
    case "x64":
    case "amd64":
      return "x86-64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`no PE machine type is known for arch ${arch}`);
  }
}

/**
 * Returns `{ format, machine }` for a PE image, or throws describing what the
 * file is instead. `format` is "PE32+" or "PE32"; `machine` is a name from
 * PE_MACHINES, or the raw hex value when it is not one we recognise.
 */
export async function inspectPortableExecutable(file) {
  const handle = await open(file, "r");
  try {
    const dos = Buffer.alloc(64);
    const { bytesRead } = await handle.read(dos, 0, 64, 0);
    if (bytesRead < 64 || dos.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`${basename(file)} is not a PE image (no MZ header)`);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    // Signature (4) + COFF header (20) + the optional header's magic (2).
    const header = Buffer.alloc(26);
    const read = await handle.read(header, 0, 26, peOffset);
    if (read.bytesRead < 26 || header.readUInt32LE(0) !== 0x00004550) {
      throw new Error(`${basename(file)} is not a PE image (no PE signature at ${peOffset})`);
    }
    const machineValue = header.readUInt16LE(4);
    const magic = header.readUInt16LE(24);
    return {
      format: PE_FORMATS[magic] ?? `unknown optional header magic 0x${magic.toString(16)}`,
      machine: PE_MACHINES[machineValue] ?? `0x${machineValue.toString(16)}`,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Throws unless `file` is a 64-bit PE image for `arch`. Used both on the staged
 * Node runtime and on every .exe/.dll in a finished Windows package.
 */
export async function assertPortableExecutable(file, arch) {
  const wantedMachine = expectedMachineForArch(arch);
  const { format, machine } = await inspectPortableExecutable(file);
  if (format !== "PE32+" || machine !== wantedMachine) {
    throw new Error(`${file} is ${format} ${machine}; a ${arch} Windows package needs PE32+ ${wantedMachine}`);
  }
  return { format, machine };
}

/**
 * A minimal PE32+ image for tests: enough header for inspectPortableExecutable
 * to classify it, nothing that would run.
 */
export function fakePortableExecutable({ machine = 0x8664, magic = 0x20b } = {}) {
  const peOffset = 0x80;
  const image = Buffer.alloc(peOffset + 26);
  image.writeUInt16LE(0x5a4d, 0);
  image.writeUInt32LE(peOffset, 0x3c);
  image.writeUInt32LE(0x00004550, peOffset);
  image.writeUInt16LE(machine, peOffset + 4);
  image.writeUInt16LE(magic, peOffset + 24);
  return image;
}

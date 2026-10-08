import { describe, expect, it } from "vitest";
import type { UiPort } from "../../shared/uiPort";

/**
 * The `UiPort` contract, run against every implementation of it.
 *
 * One contract, two implementations: the in-memory fake the UI is built
 * against, and the desktop services. Where they disagree, the UI has already
 * been written against the fake — so a difference is a defect in the desktop
 * service, not a note to leave in a doc.
 *
 * Deliberately excluded:
 *
 *   - Anything about seeded content. The fake boots with a sample workspace and
 *     the desktop boots with whatever the user has; asserting on names or ids
 *     would test the fixture rather than the contract.
 *   - `files.create`. Not implemented on the desktop yet, on purpose — see
 *     docs/uiport-scope.md.
 *   - The agent. The fake drives its script with timers, the desktop is driven
 *     by bridge events; the shapes are the same but nothing about *how* they
 *     advance is shared. S4 gives it its own suite.
 *   - Models. The fake keeps a list; the desktop stores one provider, so
 *     "add two" means something different on each. Stated in services/models.ts.
 */
export interface UiPortContractOptions {
  /**
   * Puts a file in the system picker before `openFromDisk` is called.
   *
   * The one place the two implementations cannot share a driver: the fake has no
   * picker and invents a file, while the desktop service asks one that a test has
   * to arm first. The arrange step differs; everything asserted afterwards is the
   * same contract, which is the part worth sharing.
   */
  armFilePicker?: (port: UiPort) => void;
}

export function describeUiPortContract(
  name: string,
  createPort: () => Promise<UiPort> | UiPort,
  options: UiPortContractOptions = {},
): void {
  const port = async () => createPort();

  describe(`UiPort contract · ${name}`, () => {
    it("has exactly one default folder", async () => {
      const folders = await (await port()).folders.list();
      expect(folders.filter((folder) => folder.isDefault)).toHaveLength(1);
    });

    it("gives every file a folder that exists", async () => {
      const subject = await port();
      const [folders, files] = await Promise.all([subject.folders.list(), subject.files.list()]);
      const ids = new Set(folders.map((folder) => folder.id));
      for (const file of files) {
        expect(ids.has(file.folderId)).toBe(true);
      }
    });

    it("reports folder paths as absolute", async () => {
      const folders = await (await port()).folders.list();
      for (const folder of folders) {
        expect(folder.path.length).toBeGreaterThan(0);
      }
    });

    // Removing a folder is not a way to delete work.
    it("keeps files when their folder is removed", async () => {
      const subject = await port();
      const folders = await subject.folders.list();
      const removable = folders.find((folder) => !folder.isDefault);
      if (!removable) return;
      const before = await subject.files.list();
      const affected = before.filter((file) => file.folderId === removable.id).map((file) => file.id);

      await subject.folders.remove(removable.id);

      const after = await subject.files.list();
      expect(after.some((folder) => folder.id === removable.id)).toBe(false);
      for (const id of affected) {
        expect(after.some((file) => file.id === id)).toBe(true);
      }
      // And they land somewhere that exists.
      const ids = new Set((await subject.folders.list()).map((folder) => folder.id));
      for (const file of after) {
        expect(ids.has(file.folderId)).toBe(true);
      }
    });

    // The one place work can always land is not the user's to remove.
    it("will not remove the default folder", async () => {
      const subject = await port();
      const fallback = (await subject.folders.list()).find((folder) => folder.isDefault);
      expect(fallback).toBeDefined();

      await subject.folders.remove(fallback!.id);

      const after = await subject.folders.list();
      expect(after.some((folder) => folder.id === fallback!.id)).toBe(true);
    });

    it("creates a folder that then appears in the list", async () => {
      const subject = await port();
      const created = await subject.folders.create("Contract folder");
      expect(created.name).toBe("Contract folder");
      expect(created.isDefault).toBeFalsy();
      const after = await subject.folders.list();
      expect(after.some((folder) => folder.id === created.id)).toBe(true);
    });

    it("keeps the extension when a file is renamed", async () => {
      const subject = await port();
      const file = (await subject.files.list())[0];
      if (!file) return;
      const extension = file.name.slice(file.name.lastIndexOf("."));

      await subject.files.rename(file.id, "Renamed by the contract");

      const renamed = (await subject.files.list()).find((entry) => entry.id === file.id);
      expect(renamed?.name).toBe(`Renamed by the contract${extension}`);
    });

    // The id is the file's identity; a rename is not a new file.
    it("keeps a file's id across a rename", async () => {
      const subject = await port();
      const file = (await subject.files.list())[0];
      if (!file) return;

      await subject.files.rename(file.id, "Still the same file");

      const after = await subject.files.list();
      expect(after.some((entry) => entry.id === file.id)).toBe(true);
      expect(after).toHaveLength((await subject.files.list()).length);
    });

    it("moves a file into another folder without renaming it", async () => {
      const subject = await port();
      const file = (await subject.files.list())[0];
      if (!file) return;
      const target = await subject.folders.create("Move target");

      await subject.files.move(file.id, target.id);

      const moved = (await subject.files.list()).find((entry) => entry.id === file.id);
      expect(moved?.folderId).toBe(target.id);
      expect(moved?.name).toBe(file.name);
    });

    it("pins and unpins a file", async () => {
      const subject = await port();
      const file = (await subject.files.list())[0];
      if (!file) return;

      await subject.files.setPinned(file.id, true);
      expect((await subject.files.list()).find((entry) => entry.id === file.id)?.pinned).toBe(true);

      await subject.files.setPinned(file.id, false);
      expect((await subject.files.list()).find((entry) => entry.id === file.id)?.pinned).toBe(false);
    });

    it("duplicates a file into a new one", async () => {
      const subject = await port();
      const file = (await subject.files.list())[0];
      if (!file) return;
      const before = (await subject.files.list()).length;

      const copy = await subject.files.duplicate(file.id);

      expect(copy.id).not.toBe(file.id);
      expect(copy.type).toBe(file.type);
      expect(copy.pinned).toBe(false);
      const after = await subject.files.list();
      expect(after).toHaveLength(before + 1);
      expect(after.some((entry) => entry.id === copy.id)).toBe(true);
    });

    // An imported file is not inside any of the app's directories, so it must
    // not claim to be: it lands in the default folder, which is where "filed
    // nowhere" goes. Everything else about it is an ordinary file.
    it("adds a file from disk to the default folder", async () => {
      const subject = await port();
      const before = await subject.files.list();
      options.armFilePicker?.(subject);

      const imported = await subject.files.openFromDisk();

      expect(imported, "the picker was armed, so something should have come back").not.toBeNull();
      const fallback = (await subject.folders.list()).find((folder) => folder.isDefault)!;
      expect(imported!.folderId).toBe(fallback.id);
      expect(imported!.pinned).toBe(false);

      const after = await subject.files.list();
      expect(after).toHaveLength(before.length + 1);
      expect(after.some((entry) => entry.id === imported!.id)).toBe(true);
    });

    // A drop follows the picker's rules — default folder, one path one entry —
    // but has no "cancel", so a file the app cannot open is an error to show.
    it("adds a dropped file to the default folder and refuses other types", async () => {
      const subject = await port();
      const before = await subject.files.list();

      const dropped = await subject.files.openDropped("/tmp/officedex-drop/Quarterly.xlsx");
      const again = await subject.files.openDropped("/tmp/officedex-drop/Quarterly.xlsx");

      const fallback = (await subject.folders.list()).find((folder) => folder.isDefault)!;
      expect(dropped.type).toBe("sheet");
      expect(dropped.name).toBe("Quarterly.xlsx");
      expect(dropped.folderId).toBe(fallback.id);
      expect(again.id).toBe(dropped.id);
      expect(await subject.files.list()).toHaveLength(before.length + 1);

      await expect(subject.files.openDropped("/tmp/officedex-drop/notes.txt")).rejects.toThrow(/notes\.txt/);
      expect(await subject.files.list()).toHaveLength(before.length + 1);
    });

    // A caller that mutates what it was handed must not change the port's
    // answer to the next question.
    it("never returns internal state by reference", async () => {
      const subject = await port();
      const files = await subject.files.list();
      if (files.length === 0) return;
      const original = files[0].name;
      files[0].name = "mutated";
      expect((await subject.files.list())[0].name).toBe(original);
    });

    it("round-trips settings through patch", async () => {
      const subject = await port();
      const before = await subject.settings.get();

      const patched = await subject.settings.patch({ enterToSend: !before.enterToSend });

      expect(patched.enterToSend).toBe(!before.enterToSend);
      expect((await subject.settings.get()).enterToSend).toBe(!before.enterToSend);
    });
  });
}

import { useCallback, useState } from "react";

import { useT } from "../../renderer/i18n";
import { Input, Modal } from "../../renderer/ui";
import { usePort } from "../port/PortContext";
import type { Folder } from "../../shared/uiPort";

type Pending =
  | { kind: "create" }
  | { kind: "rename"; folder: Folder }
  | { kind: "remove"; folder: Folder }
  | null;

/**
 * Folder create / rename / remove, using the shared `@vo-ui` Modal and Input so
 * the shell does not grow a second dialog implementation.
 */
export function useFolderDialogs(onDone: () => Promise<void> | void) {
  const t = useT();
  const port = usePort();
  const [pending, setPending] = useState<Pending>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const close = useCallback(() => {
    setPending(null);
    setName("");
    setError("");
  }, []);

  const createFolder = useCallback(() => {
    setPending({ kind: "create" });
    setName("");
    setError("");
  }, []);

  const renameFolder = useCallback((folder: Folder) => {
    setPending({ kind: "rename", folder });
    setName(folder.name);
    setError("");
  }, []);

  const removeFolder = useCallback((folder: Folder) => {
    setPending({ kind: "remove", folder });
    setError("");
  }, []);

  const confirm = async () => {
    if (!pending) return;
    // Folder operations are real filesystem work, so they fail for real
    // reasons — a name already taken, a directory that cannot be written.
    // The modal has a place to say so; a toast behind a dialog does not.
    if (pending.kind === "remove") {
      try {
        await port.folders.remove(pending.folder.id);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      await onDone();
      close();
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("shell.folder.nameRequired"));
      return;
    }
    try {
      if (pending.kind === "create") await port.folders.create(trimmed);
      else await port.folders.rename(pending.folder.id, trimmed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    await onDone();
    close();
  };

  const element = pending ? (
    <Modal
      open
      title={
        pending.kind === "create"
          ? t("shell.tree.newFolder")
          : pending.kind === "rename"
            ? t("shell.folder.renameTitle")
            : t("shell.folder.removeTitle", { folder: pending.folder.name })
      }
      okText={t(pending.kind === "remove" ? "shell.tree.removeFolder" : "shell.common.save")}
      onOk={confirm}
      onCancel={close}
      width={420}
    >
      {pending.kind === "remove" ? (
        <p className="shell-dialog-note">{t("shell.folder.removeNote")}</p>
      ) : (
        <>
          <label className="shell-dialog-label" htmlFor="shell-folder-name">
            {t("shell.folder.nameLabel")}
          </label>
          <Input
            id="shell-folder-name"
            value={name}
            status={error ? "error" : undefined}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            onPressEnter={() => void confirm()}
          />
        </>
      )}
      <p className="shell-dialog-error" role="alert">
        {error}
      </p>
    </Modal>
  ) : null;

  return { createFolder, renameFolder, removeFolder, element };
}

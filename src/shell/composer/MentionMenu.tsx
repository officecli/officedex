import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../renderer/i18n";
import { FileIcon, extensionOf } from "../kit/Icon";
import type { FileMeta, Folder, Mention } from "../../shared/uiPort";

export interface MentionOption {
  id: string;
  kind: "upload-files" | "upload-folder" | "folder" | "file";
  label: string;
  mention?: Mention;
  file?: FileMeta;
}

/** How many files the list offers at once (prototype: `slice(0, 8)`). */
const LIMIT = 8;

/**
 * Files whose name contains what was typed after `@`, most recently updated
 * first. Mentions and the explicit "Task context" dialog produce the same
 * thing — a file reference on the message — so they offer the same files.
 */
export function buildMentionOptions(_folders: Folder[], files: FileMeta[], query: string): MentionOption[] {
  const needle = query.trim().toLowerCase();
  return files
    .filter((file) => file.name.toLowerCase().includes(needle))
    .slice(0, LIMIT)
    .map((file) => ({
      id: `file:${file.id}`,
      kind: "file" as const,
      label: file.name,
      file,
      mention: { kind: "file" as const, id: file.id, label: file.name },
    }));
}

/** True while the key press belongs to an IME (candidate selection/confirm). */
export function isImeKeyEvent(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

export interface MentionMenuProps {
  open: boolean;
  query: string;
  folders: Folder[];
  files: FileMeta[];
  onPick: (option: MentionOption) => void;
  onClose: () => void;
  /** The textarea the menu is attached to. */
  inputId: string;
}

/**
 * The `@` list.
 *
 * It opens over the composer it belongs to and typing carries on in the
 * textarea: Enter takes the first match, ArrowDown steps into the list, Escape
 * closes it. A list that has nothing to offer says so rather than vanishing.
 */
export function MentionMenu({ open, query, folders, files, onPick, onClose, inputId }: MentionMenuProps) {
  const t = useT();
  const options = useMemo(() => buildMentionOptions(folders, files, query), [folders, files, query]);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    const input = document.getElementById(inputId);
    if (!element || !input) return;
    const rect = input.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, rect.top - element.offsetHeight - 12)}px`;
  }, [open, inputId, options.length, query]);

  useEffect(() => {
    if (!open) return;
    const input = document.getElementById(inputId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;
      const element = panel.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        input?.focus();
        return;
      }
      if (event.target === input && (event.key === "Enter" || event.key === "ArrowDown")) {
        const first = element?.querySelector<HTMLButtonElement>("button");
        if (!first) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Enter") first.click();
        else first.focus();
        return;
      }
      if (element?.contains(event.target as Node) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rows = [...element.querySelectorAll<HTMLButtonElement>("button")];
        const index = rows.indexOf(event.target as HTMLButtonElement);
        rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || input?.contains(target)) return;
      onClose();
    };
    // Capture: the composer's own Enter handler must not send the message.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, inputId, onClose]);

  if (!open || typeof document === "undefined") return null;
  const host = document.getElementById("dx-layers");
  if (!host) return null;

  return createPortal(
    <div
      ref={panel}
      className="dx-menu dx-mention-menu"
      role="listbox"
      aria-label={t("dx.composer.mentionAria")}
    >
      {options.length > 0 ? (
        options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected="false"
            data-act="mention-file"
            data-id={option.file?.id}
            onClick={() => onPick(option)}
          >
            {option.file ? <FileIcon ext={extensionOf(option.file)} /> : null}
            <span className="dx-ellipsis">{option.label}</span>
          </button>
        ))
      ) : (
        <p>{t("dx.composer.mentionEmpty")}</p>
      )}
    </div>,
    host,
  );
}

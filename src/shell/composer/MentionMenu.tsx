import { Folder as FolderIcon, Paperclip, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { FileTypeIcon } from "../chrome/FileTypeIcon";
import type { FileMeta, Folder, Mention } from "../port/types";

export interface MentionOption {
  id: string;
  kind: "upload-files" | "upload-folder" | "folder" | "file";
  label: string;
  description: string;
  group: string;
  mention?: Mention;
  fileType?: FileMeta["type"];
}

export function buildMentionOptions(
  folders: Folder[],
  files: FileMeta[],
  query: string,
): MentionOption[] {
  const uploads: MentionOption[] = [
    {
      id: "upload-files",
      kind: "upload-files",
      label: "Upload files",
      description: "Choose files from this computer",
      group: "From this computer",
    },
    {
      id: "upload-folder",
      kind: "upload-folder",
      label: "Upload folder",
      description: "Include the files inside a folder",
      group: "From this computer",
    },
  ];

  const workspace: MentionOption[] = [
    ...folders.map((folder) => ({
      id: `folder:${folder.id}`,
      kind: "folder" as const,
      label: folder.name,
      description: `${files.filter((file) => file.folderId === folder.id).length} files`,
      group: "Folders",
      mention: { kind: "folder" as const, id: folder.id, label: folder.name },
    })),
    ...files.map((file) => ({
      id: `file:${file.id}`,
      kind: "file" as const,
      label: file.name,
      description: folders.find((folder) => folder.id === file.folderId)?.name ?? "",
      group: "Files",
      fileType: file.type,
      mention: { kind: "file" as const, id: file.id, label: file.name },
    })),
  ];

  const needle = query.trim().toLowerCase();
  if (!needle) return [...uploads, ...workspace];

  const matches = workspace.filter((option) =>
    `${option.label} ${option.description}`.toLowerCase().includes(needle),
  );
  return [...matches, ...uploads];
}

export interface MentionMenuProps {
  open: boolean;
  query: string;
  folders: Folder[];
  files: FileMeta[];
  onPick: (option: MentionOption) => void;
  onClose: () => void;
  /** The textarea the menu is attached to, for aria wiring. */
  inputId: string;
}

/**
 * The `@` menu.
 *
 * Decision 2 folded the prototype's separate "folder selector" into this one
 * mechanism: a folder is mentioned the same way a file is, so task scope and
 * task references share a control instead of having two that mean almost the
 * same thing.
 */
export function MentionMenu({
  open,
  query,
  folders,
  files,
  onPick,
  onClose,
  inputId,
}: MentionMenuProps) {
  const options = useMemo(() => buildMentionOptions(folders, files, query), [folders, files, query]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ side: "above" | "below"; maxHeight: number }>({
    side: "above",
    maxHeight: 340,
  });

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  /**
   * Flip above/below based on the room available.
   *
   * The hero composer sits near the top of Home, so a menu that always opened
   * upwards was clipped by the window; the docked composer sits at the bottom,
   * where a menu that always opened downwards would be. Measuring is the only
   * thing that works for both placements.
   */
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const anchor = panelRef.current?.parentElement;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const above = rect.top - 56;
      const below = window.innerHeight - rect.bottom - 16;
      const side = above > 260 || above > below ? "above" : "below";
      setPlacement({
        side,
        maxHeight: Math.max(160, Math.min(340, side === "above" ? above : below)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const input = document.getElementById(inputId);
    if (!input) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex((index) => {
          const next = index + (event.key === "ArrowDown" ? 1 : -1);
          return (next + options.length) % options.length;
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (!options.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onPick(options[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };

    input.addEventListener("keydown", onKeyDown, true);
    return () => input.removeEventListener("keydown", onKeyDown, true);
  }, [open, options, activeIndex, onPick, onClose, inputId]);

  useEffect(() => {
    listRef.current?.querySelector(".is-highlighted")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  let previousGroup = "";

  return (
    <div
      ref={panelRef}
      className="shell-mention"
      data-side={placement.side}
      style={{ maxHeight: placement.maxHeight }}
      role="listbox"
      aria-label="Files and folders"
      id={`${inputId}-mentions`}
    >
      <div className="shell-mention-heading">
        <span aria-hidden="true">@</span> Files and folders
      </div>

      <div className="shell-mention-options" ref={listRef}>
        {options.length === 0 ? (
          <p className="shell-mention-empty">Nothing matches “{query}”.</p>
        ) : (
          options.map((option, index) => {
            const heading = option.group !== previousGroup ? option.group : null;
            previousGroup = option.group;
            return (
              <div key={option.id}>
                {heading ? <div className="shell-mention-group">{heading}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`shell-mention-option${index === activeIndex ? " is-highlighted" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onPick(option)}
                >
                  <span className="shell-mention-icon">
                    {option.kind === "file" && option.fileType ? (
                      <FileTypeIcon type={option.fileType} size={18} />
                    ) : option.kind === "folder" ? (
                      <FolderIcon size={17} strokeWidth={1.6} aria-hidden="true" />
                    ) : option.kind === "upload-folder" ? (
                      <Upload size={17} strokeWidth={1.6} aria-hidden="true" />
                    ) : (
                      <Paperclip size={17} strokeWidth={1.6} aria-hidden="true" />
                    )}
                  </span>
                  <span className="shell-mention-text">
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <span className="shell-mention-enter" aria-hidden="true">
                    ↵
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="shell-mention-footer">
        <span>↑ ↓ navigate · ↵ select · esc close</span>
      </div>
    </div>
  );
}

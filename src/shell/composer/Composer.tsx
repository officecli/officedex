import { ArrowUp, ChevronDown, Folder as FolderIcon, Mic, Plus, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { toast } from "../../renderer/ui";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Menu } from "../chrome/Menu";
import type { Attachment, Mention, PermissionMode, SendInput } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { MentionMenu, type MentionOption } from "./MentionMenu";
import { ModelMenu } from "./ModelMenu";
import { useComposerSettings } from "./useComposerSettings";
import "./composer.css";

export type ComposerPlacement = "home" | "task" | "floating";

const PERMISSIONS: Array<{ value: PermissionMode; label: string; description: string }> = [
  { value: "review", label: "Review changes", description: "Nothing is applied without you" },
  { value: "full", label: "Full access", description: "Apply edits inside this folder" },
  { value: "custom", label: "Custom", description: "Use your own instructions" },
];

const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 20 * 1024 * 1024;

/** Everything the composer gathers; the caller adds model and permission. */
export type ComposerSubmission = Pick<
  SendInput,
  "text" | "folderId" | "mentions" | "attachments" | "activeFileId"
>;

export interface ComposerProps {
  placement: ComposerPlacement;
  /** True while a task is running, which turns an empty Send into Stop. */
  busy?: boolean;
  onSend: (submission: ComposerSubmission) => void | Promise<void>;
  onStop?: () => void;
}

/**
 * One composer, three placements.
 *
 * The hero on Agent Home, the docked task column and the floating panel are the
 * same component with different padding — and, more importantly, the same
 * mention menu, model menu, permission control and scope chip. The prototype
 * had a separate folder dropdown on Home for what the scope chip does here;
 * folding the two together is decision 2.
 */
export function Composer({ placement, busy = false, onSend, onStop }: ComposerProps) {
  const { state, folders, files, scopeFolderId, dispatch } = useShell();
  const settings = useComposerSettings();
  const inputId = useId();

  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const scope = folders.find((folder) => folder.id === scopeFolderId) ?? folders[0];
  const canSend = text.trim().length > 0;
  const stopping = busy && !canSend;

  // Auto-height, capped so a long draft scrolls instead of eating the panel.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const min = placement === "home" ? 88 : 58;
    const max = placement === "home" ? 220 : 145;
    input.style.height = "auto";
    input.style.height = `${Math.min(max, Math.max(min, input.scrollHeight))}px`;
  }, [text, placement]);

  function addAttachments(list: FileList | null, asFolder = false) {
    const incoming = [...(list ?? [])];
    if (incoming.length === 0) return;

    const tooBig = incoming.find((file) => file.size > MAX_BYTES);
    if (tooBig) {
      toast.error(`${tooBig.name} is larger than 20 MB.`);
      return;
    }

    if (asFolder) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS} items.`);
        return;
      }
      const name = incoming[0].webkitRelativePath?.split("/")[0] || "Uploaded folder";
      setAttachments((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          name,
          size: incoming.reduce((total, file) => total + file.size, 0),
          fileCount: incoming.length,
        },
      ]);
      return;
    }

    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} items.`);
      return;
    }
    if (incoming.length > room) toast.info(`Only the first ${room} files were attached.`);
    setAttachments((current) => [
      ...current,
      ...incoming.slice(0, room).map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
      })),
    ]);
  }

  function handleInput(value: string, caret: number) {
    setText(value);
    const before = value.slice(0, caret);
    const match = /(?:^|\s)@([^@\n]{0,100})$/.exec(before);
    setMentionQuery(match ? match[1] : null);
  }

  function pickMention(option: MentionOption) {
    if (option.kind === "upload-files" || option.kind === "upload-folder") {
      setMentionQuery(null);
      (option.kind === "upload-folder" ? folderInputRef : fileInputRef).current?.click();
      return;
    }
    const mention = option.mention;
    if (!mention) return;

    const input = inputRef.current;
    const caret = input?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const start = before.search(/(?:^|\s)@[^@\n]{0,100}$/);
    const head = start < 0 ? before : before.slice(0, start === 0 ? 0 : start + 1);
    const token = `@${mention.label} `;

    setText(`${head}${token}${text.slice(caret)}`);
    setMentions((current) =>
      current.some((entry) => entry.kind === mention.kind && entry.id === mention.id)
        ? current
        : [...current, mention],
    );
    setMentionQuery(null);
    queueMicrotask(() => {
      input?.focus();
      const position = head.length + token.length;
      input?.setSelectionRange(position, position);
    });
  }

  function removeMention(mention: Mention) {
    setMentions((current) => current.filter((entry) => entry !== mention));
    setText((current) => current.split(`@${mention.label}`).join("").replace(/ {2,}/g, " "));
  }

  async function submit() {
    if (stopping) {
      onStop?.();
      return;
    }
    if (!canSend) return;

    const submission: ComposerSubmission = {
      text: text.trim(),
      folderId: scope?.id ?? "",
      mentions,
      attachments,
      activeFileId: state.activeFileId,
    };

    setText("");
    setMentions([]);
    setAttachments([]);
    setMentionQuery(null);
    await onSend(submission);
  }

  const permission =
    PERMISSIONS.find((entry) => entry.value === settings.value.permission) ?? PERMISSIONS[0];

  const scopeItems = useMemo(
    () =>
      folders.map((folder) => ({
        id: folder.id,
        label: folder.name,
        description: folder.path,
        checked: folder.id === scope?.id,
        onSelect: () => dispatch({ type: "select-folder", folderId: folder.id }),
      })),
    [folders, scope?.id, dispatch],
  );

  return (
    <div
      className={`shell-cx shell-cx--${placement}${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        addAttachments(event.dataTransfer.files);
      }}
    >
      {mentions.length > 0 || attachments.length > 0 ? (
        <div className="shell-cx-chips">
          {mentions.map((mention) => (
            <span key={`${mention.kind}:${mention.id}`} className={`shell-cx-chip is-${mention.kind}`}>
              {mention.kind === "folder" ? (
                <FolderIcon size={13} strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <FileTypeIcon
                  type={files.find((file) => file.id === mention.id)?.type ?? "doc"}
                  size={13}
                />
              )}
              <span className="shell-cx-chip-name">{mention.label}</span>
              <button
                type="button"
                aria-label={`Remove ${mention.label}`}
                onClick={() => removeMention(mention)}
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}

          {attachments.map((attachment) => (
            <span key={attachment.id} className="shell-cx-chip">
              <Plus size={13} strokeWidth={1.7} aria-hidden="true" />
              <span className="shell-cx-chip-name">
                {attachment.name}
                {attachment.fileCount ? ` · ${attachment.fileCount} files` : ""}
              </span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() =>
                  setAttachments((current) => current.filter((entry) => entry !== attachment))
                }
              >
                <X size={11} strokeWidth={2} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        id={inputId}
        ref={inputRef}
        className="shell-cx-input"
        rows={2}
        value={text}
        aria-label={placement === "home" ? "New task instructions" : "Message Agent"}
        placeholder={
          placement === "home"
            ? "Describe the task. Use @ to add files or folders…"
            : "Message Agent, @ files or folders…"
        }
        onChange={(event) => handleInput(event.target.value, event.target.selectionStart ?? 0)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          if (!settings.value.enterToSend && !event.metaKey && !event.ctrlKey) return;
          event.preventDefault();
          void submit();
        }}
      />

      <div className="shell-cx-toolbar">
        <div className="shell-cx-left">
          <button
            type="button"
            className="shell-cx-button"
            aria-label="Add files or folders"
            title="Add files or folders"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={18} strokeWidth={1.7} aria-hidden="true" />
          </button>

          {/* Decision 2: task scope is a property of this message, shown inline. */}
          <Menu label="Task scope" items={scopeItems} align="start" width={260}>
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className="shell-cx-button shell-cx-scope"
                title={`Scope: ${scope?.name ?? "none"}`}
              >
                <FolderIcon size={14} strokeWidth={1.7} aria-hidden="true" />
                <span className="shell-cx-scope-name">{scope?.name ?? "No folder"}</span>
                <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </Menu>
        </div>

        <div className="shell-cx-right">
          <Menu
            label="Permissions"
            align="end"
            width={280}
            items={[
              ...PERMISSIONS.map((entry) => ({
                id: entry.value,
                label: entry.label,
                description: entry.description,
                checked: entry.value === settings.value.permission,
                onSelect: () => void settings.patch({ permission: entry.value }),
              })),
              {
                id: "enter",
                label: settings.value.enterToSend ? "Enter sends · on" : "Enter sends · off",
                description: "Shift + Enter adds a new line",
                onSelect: () => void settings.patch({ enterToSend: !settings.value.enterToSend }),
              },
            ]}
          >
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className="shell-cx-button shell-cx-permission"
                title={`Permission: ${permission.label}`}
              >
                <ShieldCheck size={14} strokeWidth={1.7} aria-hidden="true" />
                <span className="shell-cx-permission-name">{permission.label}</span>
              </button>
            )}
          </Menu>

          <ModelMenu
            models={settings.models}
            selectedId={settings.value.selectedModelId}
            onSelect={(id) => void settings.patch({ selectedModelId: id })}
            onModelsChanged={settings.reloadModels}
          />

          <button type="button" className="shell-cx-button shell-cx-mic" aria-label="Dictate" title="Dictate">
            <Mic size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="shell-cx-send"
            disabled={!canSend && !busy}
            aria-label={stopping ? "Stop task" : "Send message"}
            title={stopping ? "Stop task" : "Send message"}
            onClick={() => void submit()}
          >
            {stopping ? (
              <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            ) : (
              <ArrowUp size={20} strokeWidth={1.7} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {dragging ? <div className="shell-cx-drop">Drop files to add context</div> : null}

      <MentionMenu
        open={mentionQuery !== null}
        query={mentionQuery ?? ""}
        folders={folders}
        files={files}
        inputId={inputId}
        onPick={pickMention}
        onClose={() => setMentionQuery(null)}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          addAttachments(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        // `webkitdirectory` is not in React's HTML typings but is what every
        // engine implements for folder pickers.
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          addAttachments(event.target.files, true);
          event.target.value = "";
        }}
      />
    </div>
  );
}

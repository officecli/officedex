import { ArrowUp, ChevronDown, Folder as FolderIcon, Mic, Plus, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { toast } from "../../renderer/ui";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Menu } from "../chrome/Menu";
import { useCanvas } from "../canvas/CanvasContext";
import { useCanvasSelection, selectionForFile } from "../canvas/SelectionContext";
import type { Attachment, Mention, PermissionMode, SendInput } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { usePort } from "../port/PortContext";
import { notBuiltYet } from "../port/reportPortFailure";
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

/**
 * Half-written messages, per placement, for as long as the tab is open.
 *
 * Docking the panel, floating it or going to Home unmounts one composer and
 * mounts another, and everything typed went with it — the prototype kept a
 * `drafts[kind]` for exactly this. Module scope rather than persisted state:
 * an unsent message is not worth restoring after a restart, but losing it
 * because a panel moved is the app throwing away the user's typing.
 */
const drafts = new Map<ComposerPlacement, string>();

/** Everything the composer gathers; the caller adds model and permission. */
export type ComposerSubmission = Pick<
  SendInput,
  "text" | "folderId" | "mentions" | "attachments" | "activeFileId" | "reference"
>;

export interface ComposerProps {
  placement: ComposerPlacement;
  /** True while a task is running, which turns an empty Send into Stop. */
  busy?: boolean;
  onSend: (submission: ComposerSubmission) => void | Promise<void>;
  onStop?: () => void;
  /**
   * Hands the parent a function that types into this composer.
   *
   * Home's quick prompts need to *fill* the input rather than send — the
   * prototype's whole point there is that you edit the suggestion before it
   * goes out. Lifting `text` into the parent to achieve that would make every
   * keystroke on Home a parent re-render, and the docked and floating
   * placements would pay for a feature only the hero uses.
   *
   * Wrap the callback in `useCallback`: it is an effect dependency, and a new
   * identity each render re-registers on every keystroke.
   */
  onRegisterFill?: (fill: (text: string) => void) => void;
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
export function Composer({ placement, busy = false, onSend, onStop, onRegisterFill }: ComposerProps) {
  const { state, folders, files, scopeFolderId, dispatch } = useShell();
  const port = usePort();
  const settings = useComposerSettings();
  const canvas = useCanvas();
  const { selection, clear: clearSelection } = useCanvasSelection();
  const inputId = useId();

  const [text, setTextState] = useState(() => drafts.get(placement) ?? "");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Every write to the text goes through here so the draft cannot drift from
  // what is on screen.
  const setText: typeof setTextState = (value) => {
    setTextState((current) => {
      const next = typeof value === "function" ? (value as (prev: string) => string)(current) : value;
      if (next) drafts.set(placement, next);
      else drafts.delete(placement);
      return next;
    });
  };

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const scope = folders.find((folder) => folder.id === scopeFolderId) ?? folders[0];
  const canSend = text.trim().length > 0;
  const stopping = busy && !canSend;

  /**
   * The quoted span, when there is one and it belongs to the file on screen.
   *
   * Home never carries one: there is no document being looked at, so "this
   * paragraph" means nothing there.
   */
  const reference = placement === "home" ? null : selectionForFile(selection, state.activeFileId);

  // Auto-height, capped so a long draft scrolls instead of eating the panel.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const min = placement === "home" ? 88 : 58;
    const max = placement === "home" ? 220 : 145;
    input.style.height = "auto";
    input.style.height = `${Math.min(max, Math.max(min, input.scrollHeight))}px`;
  }, [text, placement]);

  /*
   * Replace, not append: a quick prompt is a different suggestion, not an
   * addition to the one already there. The caret lands at the end so the
   * next thing typed continues the sentence.
   */
  useEffect(() => {
    if (!onRegisterFill) return;
    onRegisterFill((next) => {
      setText(next);
      setMentionQuery(null);
      queueMicrotask(() => {
        const input = inputRef.current;
        input?.focus();
        input?.setSelectionRange(next.length, next.length);
      });
    });
    // `setText` is redefined each render but only ever calls the state setter,
    // so it is safe to leave out — including it would re-register constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterFill]);

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

  async function pickNativeAttachments() {
    const picker = port.pickAttachmentPaths;
    if (!picker) return false;
    const paths = await picker();
    if (!paths || paths.length === 0) return true;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} items.`);
      return true;
    }
    if (paths.length > room) toast.info(`Only the first ${room} files were attached.`);
    setAttachments((current) => [
      ...current,
      ...paths.slice(0, room).map((path) => ({
        id: crypto.randomUUID(),
        name: path.split(/[\\/]/).pop() || path,
        size: 0,
        path,
      })),
    ]);
    return true;
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

    /*
     * The quote's words are fetched here rather than when the selection
     * changed: reading them costs a round trip into the editor and re-targets
     * its one tracked edit scope, so it happens once, for the message going
     * out. A failure is swallowed on purpose — a reference that could not be
     * read must not swallow the message with it.
     */
    let quoted = reference;
    if (reference && canvas?.resolveSelection) {
      try {
        const resolved = await canvas.resolveSelection();
        if (resolved && resolved.fileId === reference.fileId) quoted = resolved;
      } catch {
        // Keep the label-only reference.
      }
    }

    const submission: ComposerSubmission = {
      text: text.trim(),
      folderId: scope?.id ?? "",
      mentions,
      attachments,
      activeFileId: state.activeFileId,
      ...(quoted
        ? { reference: { fileId: quoted.fileId, label: quoted.label, text: quoted.text } }
        : {}),
    };

    setText("");
    setMentions([]);
    setAttachments([]);
    setMentionQuery(null);
    // The quote went with the message; leaving it up would make the next one
    // look like it is about the same passage.
    if (reference) clearSelection();
    await onSend(submission);
  }

  function dictate() {
    type Recognition = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
    };
    const speech = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Constructor = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!Constructor) {
      notBuiltYet("dictate", "Dictation is not available in this browser. Type your instruction for now.");
      return;
    }
    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) setText((current) => `${current}${current ? " " : ""}${transcript}`);
    };
    recognition.onerror = () => toast.error("Dictation could not start.");
    try {
      recognition.start();
    } catch {
      toast.error("Dictation could not start.");
    }
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
      {/*
        The quoted span sits above the chips, not among them: a mention and an
        attachment are things the user added to the message, while this is
        something the document is telling the composer about itself. It also
        shows its text — the whole point is being able to check what "this"
        refers to before asking for a rewrite of it.
      */}
      {reference ? (
        <div className="shell-cx-reference">
          <div className="shell-cx-reference-head">
            <span>{reference.label}</span>
            <button
              type="button"
              className="shell-cx-chip-remove"
              aria-label={`Remove the reference to ${reference.label}`}
              onClick={clearSelection}
            >
              <X size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {reference.text ? <p>{reference.text}</p> : null}
        </div>
      ) : null}

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
            ? "Ask anything, @ to add files or folders…"
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
            onClick={() => {
              void pickNativeAttachments().then((picked) => {
                if (!picked) fileInputRef.current?.click();
              });
            }}
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

          <button
            type="button"
            className="shell-cx-button shell-cx-mic"
            aria-label="Dictate"
            title="Dictate"
            onClick={dictate}
          >
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

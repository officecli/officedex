import {
  ArrowUp,
  ChevronDown,
  Folder as FolderIcon,
  FolderPlus,
  Mic,
  Plus,
  ShieldCheck,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { toast } from "../../renderer/ui";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Menu } from "../chrome/Menu";
import { useCanvas } from "../canvas/CanvasContext";
import { useCanvasSelection, selectionForFile } from "../canvas/SelectionContext";
import type { Attachment, FileType, Mention, PermissionMode, SendInput } from "../../shared/uiPort";
import { useFolderDialogs } from "../nav/useFolderDialogs";
import { useShell } from "../state/ShellContext";
import { usePort } from "../port/PortContext";
import { notBuiltYet } from "../port/reportPortFailure";
import { MentionMenu, type MentionOption } from "./MentionMenu";
import { ModelMenu } from "./ModelMenu";
import { useComposerSettings } from "./useComposerSettings";
import "./composer.css";

export type ComposerPlacement = "home" | "task" | "floating";

/**
 * The three tiers the IA drew, and the one the runtime can honour.
 *
 * Full access is first because it is the default everywhere — services/
 * settings.ts, the fake port's seed and useComposerSettings' fallback all say
 * `full`, and the `?? PERMISSIONS[0]` below has to land on a tier that works.
 *
 * The other two keep their rows. `unsupportedParts()` in services/agent.ts
 * already downgraded them to a direct write and mentioned it in a notice
 * *after* the message had gone — the gate was promised here and quietly
 * withdrawn in the transcript. Custom is the worse of the two: its description
 * offers your own instructions, and no screen in this app can write
 * `settings.customInstructions`, so choosing it has always meant choosing none.
 *
 * Shown-but-unbuilt rather than hidden, for the reason every other gap in this
 * shell is (see port/reportPortFailure): the shape of the choice is the design,
 * and deleting the rows loses the record of it. Pressing one says so.
 */
const PERMISSIONS: Array<{
  value: PermissionMode;
  label: string;
  description: string;
  /** False while nothing behind the port enforces this tier. */
  available: boolean;
}> = [
  {
    value: "full",
    label: "Full access",
    description: "Apply edits inside this folder",
    available: true,
  },
  {
    value: "review",
    label: "Review changes",
    description: "Nothing is applied without you",
    available: false,
  },
  { value: "custom", label: "Custom", description: "Use your own instructions", available: false },
];

const MAX_ATTACHMENTS = 10;
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * What this message will produce, as the user states it.
 *
 * `auto` is the historical behaviour and stays the default: the runtime reads
 * the instruction and picks a type. It is a heuristic, though, and Home's own
 * "Write a document" prompt is a case it gets wrong — no word in "Draft a
 * project plan covering goals, milestones, owners and risks" matches the
 * document rule, so it fell through to the settings default and the document
 * button produced a deck. A stated type is not a hint; it is the answer.
 *
 * The three types are the ones `SendInput.documentType` carries, which is in
 * turn the three the generate runtime accepts from this shell.
 */
type OutputChoice = "auto" | FileType;

const OUTPUTS: Array<{ value: FileType; label: string; description: string }> = [
  { value: "doc", label: "New document", description: "A Word file (.docx)" },
  { value: "sheet", label: "New workbook", description: "An Excel file (.xlsx)" },
  { value: "slides", label: "New presentation", description: "A PowerPoint file (.pptx)" },
];

const DOCUMENT_TYPES: Record<FileType, NonNullable<SendInput["documentType"]>> = {
  doc: "docx",
  sheet: "xlsx",
  slides: "pptx",
};

/** Everything a half-written message carries, not just its words. */
interface Draft {
  text: string;
  mentions: Mention[];
  attachments: Attachment[];
  /** What the user said to make, or "auto" to let the instruction decide. */
  output: OutputChoice;
}

const EMPTY_DRAFT: Draft = { text: "", mentions: [], attachments: [], output: "auto" };

/**
 * Half-written messages, per placement, for as long as the tab is open.
 *
 * Docking the panel, floating it or going to Home unmounts one composer and
 * mounts another, and everything typed went with it — the prototype kept a
 * `drafts[kind]` for exactly this. Module scope rather than persisted state:
 * an unsent message is not worth restoring after a restart, but losing it
 * because a panel moved is the app throwing away the user's typing.
 *
 * The whole draft, because keeping only the string was worse than keeping
 * nothing. `mentions` and `attachments` were plain component state, so coming
 * back to Home restored text reading "@MO sales forecast.xlsx" with no mention
 * behind it: the message still looked like it carried the file and silently
 * did not, and the attachments were gone without even a chip left to notice.
 */
const drafts = new Map<ComposerPlacement, Draft>();

/**
 * Forgets every kept draft.
 *
 * Exists for tests. The map is module state, so one test's half-written message
 * is the next one's starting value — which was survivable while it held a
 * string and is not now that it holds chips.
 */
export function resetComposerDrafts(): void {
  drafts.clear();
}

/** Everything the composer gathers; the caller adds model and permission. */
export type ComposerSubmission = Pick<
  SendInput,
  "text" | "folderId" | "mentions" | "attachments" | "activeFileId" | "reference" | "documentType"
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
   * The second argument sets the output type along with the words. A quick
   * prompt is a whole intent — "Write a document" says the type out loud, and
   * leaving it to be re-derived from the sentence is what made that button
   * produce a deck.
   *
   * Wrap the callback in `useCallback`: it is an effect dependency, and a new
   * identity each render re-registers on every keystroke.
   */
  onRegisterFill?: (fill: (text: string, output?: FileType) => void) => void;
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
  const { state, folders, files, scopeFolderId, dispatch, reload } = useShell();
  const port = usePort();
  const settings = useComposerSettings();
  const canvas = useCanvas();
  const { selection, clear: clearSelection } = useCanvasSelection();
  const inputId = useId();

  const [draft, setDraft] = useState<Draft>(() => drafts.get(placement) ?? EMPTY_DRAFT);
  const { text, mentions, attachments, output } = draft;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** True while a speech recogniser is running — see `dictate`. */
  const [listening, setListening] = useState(false);

  // Every write to the draft goes through here so what is kept cannot drift
  // from what is on screen — the parts are saved together or not at all.
  function patchDraft(patch: (current: Draft) => Partial<Draft>) {
    setDraft((current) => {
      const next = { ...current, ...patch(current) };
      const empty =
        !next.text && next.mentions.length === 0 && next.attachments.length === 0 && next.output === "auto";
      if (empty) drafts.delete(placement);
      else drafts.set(placement, next);
      return next;
    });
  }

  /** React's own setState shape — a value or an updater — for one draft field. */
  type Update<T> = T | ((current: T) => T);
  const resolve = <T,>(value: Update<T>, current: T): T =>
    typeof value === "function" ? (value as (previous: T) => T)(current) : value;

  const setText = (value: Update<string>) =>
    patchDraft((current) => ({ text: resolve(value, current.text) }));
  const setMentions = (value: Update<Mention[]>) =>
    patchDraft((current) => ({ mentions: resolve(value, current.mentions) }));
  const setAttachments = (value: Update<Attachment[]>) =>
    patchDraft((current) => ({ attachments: resolve(value, current.attachments) }));
  const setOutput = (value: OutputChoice) => patchDraft(() => ({ output: value }));

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const scope = folders.find((folder) => folder.id === scopeFolderId) ?? folders[0];
  const canSend = text.trim().length > 0;
  /**
   * The send button doubles as Stop — but never on Home.
   *
   * `busy` is the scope *folder's* task, not one this composer started, and
   * Home's composer is for starting something new. So a run going anywhere in
   * the selected folder turned the hero's main button into Stop the moment the
   * input was empty: a destructive action, with no confirmation, on the first
   * control a new user sees, cancelling work they may not even know about.
   *
   * Home already makes this same exception twice — `reference` and
   * `targetFileId` both refuse to read the workspace from here. `busy` was the
   * one that got missed. Stopping a run stays available where the run is: the
   * task panel, and Home's own task list.
   */
  const stopping = placement !== "home" && busy && !canSend;

  /**
   * The quoted span, when there is one and it belongs to the file on screen.
   *
   * Home never carries one: there is no document being looked at, so "this
   * paragraph" means nothing there.
   */
  const reference = placement === "home" ? null : selectionForFile(selection, state.activeFileId);

  /**
   * The document this message is about — and on Home, nothing is.
   *
   * The same argument as `reference` above, which for a long time was the only
   * half of it that got made. `SendInput.activeFileId` is not a hint: the
   * service layer treats its presence as the whole routing decision, sending
   * the run down `office.modify` against that file instead of generating
   * anything (see `send` in services/agent.ts). Home passed whatever tab
   * happened to be open, so asking Home for a *new* deck while a document sat
   * behind it rewrote that document — a file the user had opened from disk,
   * edited in place, seven operations deep, with nothing on screen having
   * suggested that was the plan.
   *
   * To work on a specific file, open it: the docked and floating composers
   * both carry it, and that is what makes them about it.
   */
  const targetFileId = placement === "home" ? null : state.activeFileId;

  /**
   * The file this message would edit, once the stated output type is taken
   * into account.
   *
   * Picking a type is how the user says "a new one, not this one". Without
   * that, a document open in the editor captures every message sent from the
   * panel beside it — including "now write me the summary memo", which would
   * rewrite the document being read rather than produce the memo.
   */
  const editingFileId = output === "auto" ? targetFileId : null;
  const openFile = files.find((file) => file.id === targetFileId) ?? null;
  const editingFile = output === "auto" ? openFile : null;

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
   * A recogniser outlives the component that started it. Leaving the composer
   * mid-dictation would keep the microphone open with nothing left to receive
   * the transcript — a live mic and no indicator anywhere in the app.
   */
  useEffect(() => () => recognitionRef.current?.stop(), []);

  /*
   * Replace, not append: a quick prompt is a different suggestion, not an
   * addition to the one already there. The caret lands at the end so the
   * next thing typed continues the sentence.
   */
  useEffect(() => {
    if (!onRegisterFill) return;
    onRegisterFill((next, output) => {
      setText(next);
      // A quick prompt states its own type; a plain fill leaves the choice
      // alone rather than resetting one the user made by hand.
      if (output) setOutput(output);
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
      activeFileId: editingFileId,
      ...(output === "auto" ? {} : { documentType: DOCUMENT_TYPES[output] }),
      ...(quoted
        ? { reference: { fileId: quoted.fileId, label: quoted.label, text: quoted.text } }
        : {}),
    };

    setText("");
    setMentions([]);
    setAttachments([]);
    // Back to auto: a stated type belongs to the message that stated it. Left
    // sticky, one "New document" would silently turn every later instruction
    // typed beside an open file into a new file.
    setOutput("auto");
    setMentionQuery(null);
    // The quote went with the message; leaving it up would make the next one
    // look like it is about the same passage.
    if (reference) clearSelection();
    await onSend(submission);
  }

  /**
   * Speech to text, with the fact that it is listening on screen.
   *
   * It used to run entirely in the dark: pressing the mic opened the
   * browser's permission flow, sat silent for as long as it took, and then
   * appended a sentence to whatever was in the box. Nothing said a recogniser
   * was running, nothing said one had failed, and there was no way to call it
   * off — so a mic pressed by accident could only be waited out.
   *
   * The handle lives in a ref because the second press has to reach the same
   * recogniser the first one started.
   */
  function dictate() {
    if (recognitionRef.current) {
      // `stop` still delivers whatever was heard so far, which is what someone
      // pressing a live mic button means by it.
      recognitionRef.current.stop();
      return;
    }

    type Recognition = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
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
    /*
     * `onend` fires however the session finished — a result, an error, the
     * recogniser's own silence timeout — so it is the one place that can
     * honestly clear the listening state. Clearing it in `onresult` alone would
     * leave the button pulsing after a recogniser that simply heard nothing.
     */
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognition.onerror = () => toast.error("Dictation could not start.");
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      toast.error("Dictation could not start.");
    }
  }

  const permission =
    PERMISSIONS.find((entry) => entry.value === settings.value.permission) ?? PERMISSIONS[0];

  /*
   * Creating a folder from the one control that says where a task will write.
   *
   * The menu listed existing folders and stopped there, so a workspace with
   * none opened an empty panel — a dead end reached from the place the user was
   * already standing, with the only way out being the sidebar's New folder
   * button and a trip back. The dialog is the sidebar's own rather than a
   * second one: folder names fail for real filesystem reasons, and that modal
   * is where those are reported.
   */
  const folderDialogs = useFolderDialogs(async () => {
    const before = new Set(folders.map((folder) => folder.id));
    await reload();
    /*
     * `useFolderDialogs` does not hand back what it created, so the new folder
     * is whichever one the refreshed list has that the old one did not.
     * Selecting it is the point of creating it here — a folder made from the
     * scope menu and then not scoped to would make the user pick it twice.
     */
    const created = (await port.folders.list()).find((folder) => !before.has(folder.id));
    if (created) dispatch({ type: "select-folder", folderId: created.id });
  });

  const scopeItems = useMemo(
    () => [
      ...folders.map((folder) => ({
        id: folder.id,
        label: folder.name,
        description: folder.path,
        checked: folder.id === scope?.id,
        onSelect: () => dispatch({ type: "select-folder", folderId: folder.id }),
      })),
      {
        id: "new-folder",
        label: "New folder…",
        description: "Create one and scope this message to it",
        icon: <FolderPlus size={16} strokeWidth={1.8} aria-hidden="true" />,
        onSelect: folderDialogs.createFolder,
      },
    ],
    [folders, scope?.id, dispatch, folderDialogs.createFolder],
  );

  /*
   * What this message will do, as one readable phrase.
   *
   * Two questions collapse into one control here, because they are one
   * question: does this instruction change the document I am looking at, or
   * make something new — and if new, of what kind. Splitting them into an
   * "edit / create" toggle plus a type picker would put two controls on screen
   * whose only legal combinations are the four rows below.
   */
  const outputItems = useMemo(
    () => [
      ...(targetFileId && openFile
        ? [
            {
              id: "edit",
              label: `Edit ${openFile.name}`,
              description: "Change the document on screen",
              icon: <FileTypeIcon type={openFile.type} size={16} />,
              checked: output === "auto",
              onSelect: () => setOutput("auto"),
            },
          ]
        : [
            {
              id: "auto",
              label: "Decide from my instruction",
              description: "Read the type off what I asked for",
              icon: <Wand2 size={16} strokeWidth={1.8} aria-hidden="true" />,
              checked: output === "auto",
              onSelect: () => setOutput("auto"),
            },
          ]),
      ...OUTPUTS.map((entry) => ({
        id: entry.value,
        label: entry.label,
        description: entry.description,
        icon: <FileTypeIcon type={entry.value} size={16} />,
        checked: output === entry.value,
        onSelect: () => setOutput(entry.value),
      })),
    ],
    // `setOutput` closes over `patchDraft`, redefined every render; including it
    // would rebuild this list on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetFileId, openFile?.id, openFile?.name, openFile?.type, output],
  );

  /** The chip's own face: an icon and the shortest true phrase for it. */
  const outputFace =
    output !== "auto"
      ? {
          icon: <FileTypeIcon type={output} size={14} />,
          name: OUTPUTS.find((entry) => entry.value === output)?.label ?? "New file",
          title: `This message creates a ${OUTPUTS.find((entry) => entry.value === output)?.description ?? "new file"}`,
        }
      : editingFile
        ? {
            icon: <FileTypeIcon type={editingFile.type} size={14} />,
            name: editingFile.name,
            title: `This message edits ${editingFile.name}`,
          }
        : {
            icon: <Wand2 size={14} strokeWidth={1.7} aria-hidden="true" />,
            name: "Auto",
            title: "The type is read off your instruction. Pick one to be sure.",
          };

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

          {/*
            And what it will produce. Same argument as the scope chip: the
            answer travels with the message, so the control does too.
          */}
          <Menu label="What this message makes" items={outputItems} align="start" width={280}>
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className="shell-cx-button shell-cx-output"
                data-stated={String(output !== "auto")}
                title={outputFace.title}
              >
                {outputFace.icon}
                <span className="shell-cx-output-name">{outputFace.name}</span>
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
                /*
                 * Clickable, not disabled. A greyed row says "not for you";
                 * these two are for everyone the day the runtime grows a gate,
                 * and until then the honest answer is a sentence rather than a
                 * dead row with no explanation attached to it.
                 */
                onSelect: () => {
                  if (!entry.available) {
                    notBuiltYet(
                      `composer.permission.${entry.value}`,
                      `${entry.label} is not available yet — every run applies its changes directly. Full access is the only mode the agent honours.`,
                    );
                    return;
                  }
                  void settings.patch({ permission: entry.value });
                },
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
            className={`shell-cx-button shell-cx-mic${listening ? " is-listening" : ""}`}
            aria-label={listening ? "Stop dictation" : "Dictate"}
            aria-pressed={listening}
            title={listening ? "Listening — press to stop" : "Dictate"}
            onClick={dictate}
          >
            <Mic size={16} strokeWidth={1.7} aria-hidden="true" />
          </button>

          {/*
            Enabled when there is something to send, or something to stop — and
            that is `stopping`, not `busy`. Keyed to `busy` it stayed clickable
            on Home with an empty box, where it now neither sends nor stops.
          */}
          <button
            type="button"
            className="shell-cx-send"
            disabled={!canSend && !stopping}
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

      {/* Portals to the body, so where it sits in this tree does not matter. */}
      {folderDialogs.element}
    </div>
  );
}

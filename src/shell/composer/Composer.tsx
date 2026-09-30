import { ArrowUp, Square } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { toast } from "../../renderer/ui";
import { translate, useT } from "../../renderer/i18n";
import { referenceRequests } from "../chrome/useFileActions";
import { useCanvas } from "../canvas/CanvasContext";
import { useCanvasSelection, selectionForFile } from "../canvas/SelectionContext";
import type { Attachment, FileType, Mention, SendInput } from "../../shared/uiPort";
import { FileIcon, Icon, extensionOf } from "../kit/Icon";
import { openMenu } from "../kit/layers";
import { useShell } from "../state/ShellContext";
import { usePort } from "../port/PortContext";
import { useDiskDrop } from "../home/useDiskDrop";
import { notBuiltYet } from "../port/reportPortFailure";
import { MentionMenu, isImeKeyEvent, type MentionOption } from "./MentionMenu";
import { openTaskContext } from "./TaskContextDialog";
import { useComposerSettings } from "./useComposerSettings";
import { ImageComposerHeader, ImageSummary, ImageTools } from "../image/composer/ImageTools";
import { ReferenceList, ReferenceStrip } from "../image/composer/ReferenceList";
import { EMPTY_IMAGE_DRAFT, restoreImageDraft, toImageGenerationInput, type ImageDraft } from "../image/composer/imageDraft";
import { useComposerFillRequests } from "../image/composerFill";
import { useImageBesideDocument, useImageEditTarget } from "../image/useImageEditTarget";
import { ImageAsideNotice } from "../image/composer/ImageAsideNotice";
import "./composer.css";
import "../image/composer/imageComposer.css";

export type ComposerPlacement = "home" | "task" | "floating";

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

/** `label` / `description` are dictionary keys, translated at render. */
const OUTPUTS: Array<{ value: FileType; label: string; description: string }> = [
  { value: "doc", label: "shell.tree.newDocument", description: "shell.cx.output.docDescription" },
  { value: "sheet", label: "shell.tree.newWorkbook", description: "shell.cx.output.sheetDescription" },
  { value: "slides", label: "shell.tree.newPresentation", description: "shell.cx.output.slidesDescription" },
];

const DOCUMENT_TYPES: Record<FileType, NonNullable<SendInput["documentType"]>> = {
  doc: "docx",
  sheet: "xlsx",
  slides: "pptx",
  image: "img",
};

/** Everything a half-written message carries, not just its words. */
interface Draft {
  text: string;
  mentions: Mention[];
  attachments: Attachment[];
  /** What the user said to make, or "auto" to let the instruction decide. */
  output: OutputChoice;
  mode: "agent" | "image";
  /**
   * The document on screen when image mode was picked, or null when none was.
   *
   * Image mode chosen beside a picture is not a choice about the deck opened
   * after it, and the draft outlives both the tab switch and the panel's
   * remount — so the mode is only honoured beside the file it was picked for.
   */
  modeFileId?: string | null;
  image: ImageDraft;
}

const EMPTY_DRAFT: Draft = { text: "", mentions: [], attachments: [], output: "auto", mode: "agent", image: EMPTY_IMAGE_DRAFT };

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
const drafts = new Map<string, Draft>();

/**
 * Forgets every kept draft.
 *
 * Exists for tests. The map is module state, so one test's half-written message
 * is the next one's starting value — which was survivable while it held a
 * string and is not now that it holds chips.
 */
export function resetComposerDrafts(): void {
  drafts.clear();
  lastSent = null;
}

/**
 * The message that started the run now going, exactly as it sat in the input.
 *
 * An Enter pressed too early sends a half-written message, and Stop used to be
 * the end of it: the words were in the transcript, not in the input, so fixing
 * one typo meant typing the whole thing again. Stop now puts them back — the
 * way the send took them, chips and attachments included — so the fix is an
 * edit and a second Enter.
 *
 * Module scope for the same reason as `drafts`, and more so: the commonest
 * slip is on Home, whose composer is gone by the time Stop is pressed from the
 * task panel's. Cleared when the run ends on its own, so a Stop pressed on some
 * later run — one started by a quick reply or a retry — does not bring back an
 * old message.
 */
let lastSent: Draft | null = null;

/** Everything the composer gathers; the caller adds model and permission. */
export type ComposerSubmission = Pick<
  SendInput,
  "text" | "folderId" | "mentions" | "attachments" | "activeFileId" | "reference" | "documentType" | "imageGeneration"
>;

export interface ComposerProps {
  placement: ComposerPlacement;
  /**
   * What the half-written message belongs to — a conversation, a document.
   * Drafts are kept per object (OD-UI-1.2 §02), so a message begun in one
   * conversation is still there on the way back and never shows up in another.
   */
  draftKey?: string;
  /**
   * Starts in image mode and stays there: the image creator's composer. Home's
   * "AI image" opens that page rather than switching this control's mode.
   */
  imageOnly?: boolean;
  /** True while a task is running, which turns an empty Send into Stop. */
  busy?: boolean;
  onSend: (submission: ComposerSubmission) => void | Promise<void>;
  /**
   * Stops the run. Resolving to `false` says it did not stop, and the message
   * that started it stays out of the input.
   */
  onStop?: () => void | boolean | Promise<void | boolean>;
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
  onRegisterFill?: (fill: (text: string, output?: FileType | "image") => void) => void;
  /**
   * Hands the caller a way to switch image mode on and off without touching
   * the words — Home's "Create an image" is a mode, not a suggested sentence.
   */
  onRegisterImageMode?: (set: (on: boolean) => void) => void;
  /** Told whenever image mode turns on or off, so Home can retitle itself. */
  onImageModeChange?: (on: boolean) => void;
  /**
   * The task beside this composer is making a picture. Every message from here
   * is then a change to it, so the composer stays in image mode and cannot be
   * switched out of it.
   */
  imageTask?: boolean;
}

/**
 * One composer, three placements — OD-CHAT-2026.09.
 *
 * Home, the project conversation and the Dex panel over a document are the
 * same component at three widths. Top to bottom: what the message refers to
 * (when anything), the text, then one row of tools — a single "add" on the
 * left; Model, voice and the round send on the right. Nothing in that row
 * changes size or place between empty, typing, sending and running: an empty
 * input beside a running task turns Send into Stop in the same 32px circle.
 *
 * Container 24px radius with 8px padding; the text sits 4px further in. The
 * text box grows from 56 to 200px and then scrolls. The focus ring is the
 * container's — the 1.0 colour glow, drawn by `attention/inputGlow` — and the
 * textarea inside has no outline of its own.
 *
 * The image creator keeps the interface it already had (§18: "AI image 保留
 * 既有图像创作界面"); that branch of this component is unchanged.
 */
export function Composer({ placement, draftKey = "", imageOnly = false, busy = false, onSend, onStop, onRegisterFill, onRegisterImageMode, onImageModeChange, imageTask = false }: ComposerProps) {
  const { state, folders, files, activeFile, scopeFolderId, dispatch } = useShell();
  const t = useT();
  const port = usePort();
  const settings = useComposerSettings();
  const canvas = useCanvas();
  const { selection, clear: clearSelection } = useCanvasSelection();
  const inputId = useId();

  const [draft, setDraft] = useState<Draft>(() => {
    const saved = drafts.get(`${placement}:${draftKey}`);
    return saved ? { ...EMPTY_DRAFT, ...saved, image: restoreImageDraft(saved.image) } : EMPTY_DRAFT;
  });
  /** The draft as of the last write, so several in one event build on each other. */
  const latestDraft = useRef(draft);
  const { text, mentions, attachments, output, image } = draft;
  const suggestedTarget = useImageEditTarget();
  /*
   * "New image instead", for a version the shell picked rather than one the
   * user opened. Held as the file it was said about, so it lapses by itself
   * when a newer version lands or a picture is opened — the choice was about
   * that one picture, not a standing preference.
   */
  const [declinedTarget, setDeclinedTarget] = useState<string | null>(null);
  const editTarget =
    suggestedTarget && !(suggestedTarget.source === "latest" && suggestedTarget.fileId === declinedTarget)
      ? suggestedTarget
      : null;
  const declined = suggestedTarget && !editTarget ? suggestedTarget : null;
  const imageAside = useImageBesideDocument();
  /**
   * A document open in the editor — never on Home, where nothing is.
   *
   * The panel's task is the *folder's* latest, not the open file's. Open a
   * deck in a folder whose last run made a picture, and `imageTask` is still
   * true: without this, "summarise this deck" was locked into image mode and
   * went to the image model as a brief, with the deck left untouched.
   */
  const documentOnScreen = placement !== "home" && activeFile !== null && activeFile.type !== "image";
  /*
   * Beside an image task the mode is not a choice. Anything typed there is a
   * change to the picture on screen; letting it fall back to Agent would send
   * it down the document path, which has no idea what to do with an image.
   * Unless what is on screen is a document: then the message is about that.
   */
  const forcedImage =
    imageOnly || (placement !== "home" && (editTarget !== null || (imageTask && !documentOnScreen)));
  /*
   * Picked beside something else — a picture, the workspace, another file —
   * and now looking at a document: the message is about the document.
   */
  const staleImage = draft.mode === "image" && documentOnScreen && (draft.modeFileId ?? null) !== activeFile?.id;
  const mode: Draft["mode"] = forcedImage ? "image" : staleImage ? "agent" : draft.mode;
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  /** True while a speech recogniser is running — see `dictate`. */
  const [listening, setListening] = useState(false);

  // Every write to the draft goes through here so what is kept cannot drift
  // from what is on screen — the parts are saved together or not at all.
  //
  // The kept copy is written here, as the call is made, and not from inside the
  // state update. Sending a conversation's first message gives it an id, which
  // re-keys this composer: it is replaced in the same commit, its queued
  // updates are dropped with it, and a write that waited for them left the
  // message that had just gone out — attachments included — as the draft of
  // the next new chat in that project.
  function patchDraft(patch: (current: Draft) => Partial<Draft>) {
    const next = { ...latestDraft.current, ...patch(latestDraft.current) };
    latestDraft.current = next;
    const empty = !next.text && next.mentions.length === 0 && next.attachments.length === 0 && next.output === "auto" && next.mode === "agent";
    if (empty) drafts.delete(`${placement}:${draftKey}`);
    else drafts.set(`${placement}:${draftKey}`, next);
    setDraft(next);
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
  const setMode = (value: Draft["mode"]) =>
    patchDraft(() => ({ mode: value, modeFileId: documentOnScreen ? (activeFile?.id ?? null) : null }));
  const setImage = (patch: Partial<ImageDraft>) => patchDraft((current) => ({ image: { ...current.image, ...patch } }));

  useEffect(() => {
    onRegisterImageMode?.((on) => setMode(on ? "image" : "agent"));
    // `setMode` only calls the state setter; see the fill registration below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onRegisterImageMode]);

  useEffect(() => {
    onImageModeChange?.(mode === "image");
  }, [mode, onImageModeChange]);

  /*
   * "Create another" and "Try again" on the image workspace put words here.
   * Only the composer beside the task listens: Home's belongs to the next task.
   */
  useComposerFillRequests((next) => {
    if (placement === "home") return;
    setText(next);
    queueMicrotask(() => {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(next.length, next.length);
    });
  });

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
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

  /*
   * A run that ends on its own took its message with it — see `lastSent`.
   *
   * Only the busy-to-idle edge counts. Idle on its own proves nothing: the
   * render right after a send is still idle, because the run has not reported
   * in yet, and clearing there would forget the message before Stop could
   * reach it.
   */
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) lastSent = null;
    wasBusy.current = busy;
  }, [busy]);

  async function stop() {
    const sent = lastSent;
    const stopped = await onStop?.();
    if (stopped === false || !sent) return;
    // Another message went out while the stop was in flight; that one is now
    // the run, and this one is history.
    if (lastSent !== null && lastSent !== sent) return;
    lastSent = null;
    // Only into an empty input: anything typed while the stop was in flight is
    // newer than the message coming back, and is not the user's to lose.
    patchDraft((current) =>
      current.text.trim() || current.mentions.length > 0 || current.attachments.length > 0
        ? {}
        : { ...sent, modeFileId: documentOnScreen ? (activeFile?.id ?? null) : null },
    );
    queueMicrotask(() => {
      const input = inputRef.current;
      input?.focus();
      const end = input?.value.length ?? 0;
      input?.setSelectionRange(end, end);
    });
  }

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

  /*
   * Auto-height, capped so a long draft scrolls instead of eating the panel.
   * Measured again when the width changes: the task column opens from zero
   * width, and a placeholder measured mid-animation wraps a word per line and
   * leaves the box at its cap with nothing in it.
   */
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // OD-CHAT §2: 56–200 in every placement. The image creator keeps its own.
    const min = mode === "image" ? (placement === "home" ? 88 : 58) : 56;
    const max = mode === "image" ? (placement === "home" ? 220 : 145) : 200;
    const fit = () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(max, Math.max(min, input.scrollHeight))}px`;
      input.style.overflowY = input.scrollHeight > max ? "auto" : "hidden";
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      fit();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [text, placement, mode]);

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
      // A stated document type is a way out of image mode too: "Write a
      // document" pressed after "Create an image" means a document, and left
      // in image mode it would be sent to the image model as a picture brief.
      if (output === "image") setMode("image");
      else if (output) {
        setMode("agent");
        setOutput(output);
      }
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
      toast.error(translate("shell.cx.attach.tooBig", { name: tooBig.name }));
      return;
    }

    if (asFolder) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast.error(translate("shell.cx.attach.max", { count: MAX_ATTACHMENTS }));
        return;
      }
      const name = incoming[0].webkitRelativePath?.split("/")[0] || translate("shell.cx.attach.uploadedFolder");
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
      toast.error(translate("shell.cx.attach.max", { count: MAX_ATTACHMENTS }));
      return;
    }
    if (incoming.length > room) toast.info(translate("shell.cx.attach.onlyFirst", { count: room }));
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
    if (paths && paths.length > 0) attachPaths(paths);
    return true;
  }

  /** Real paths — from the native picker or a drop — which the agent can read. */
  function attachPaths(paths: string[]) {
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      toast.error(translate("shell.cx.attach.max", { count: MAX_ATTACHMENTS }));
      return;
    }
    if (paths.length > room) toast.info(translate("shell.cx.attach.onlyFirst", { count: room }));
    setAttachments((current) => [
      ...current,
      ...paths.slice(0, room).map((path) => ({
        id: crypto.randomUUID(),
        name: path.split(/[\\/]/).pop() || path,
        size: 0,
        path,
      })),
    ]);
  }

  /*
   * Files dragged in from the desktop are attached by path, which only the
   * port can supply: on the desktop Wails keeps the drop from the webview and
   * reports the paths natively, so the DOM `drop` never arrives. Handling it
   * here left `dragging` set for good, and the drop overlay covered the whole
   * composer — it looked frozen. `dataTransfer.files` would not have helped
   * either; a browser `File` has no path, and pathless attachments are dropped
   * at send.
   */
  const { overlay: dropOverlay, zoneHandlers: dropZone } = useDiskDrop(attachPaths);
  const dragging = dropOverlay !== null;

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

  // The Enter that confirms an IME candidate must stay inside the IME. WebKit
  // (Wails) fires compositionend before that keydown, so isComposing is already
  // false there — keyCode 229 is what still marks it.
  function onCompositionStart() {
    composingRef.current = true;
  }

  function onCompositionEnd() {
    composingRef.current = false;
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (isImeKeyEvent(event.nativeEvent) || composingRef.current) return;
    if (!settings.value.enterToSend && !event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    void submit();
  }

  async function submit() {
    if (stopping) {
      await stop();
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
      activeFileId: mode === "image" ? null : editingFileId,
      ...(output === "auto" ? {} : { documentType: DOCUMENT_TYPES[output] }),
      ...(mode === "image" ? {
        documentType: "img" as const,
        imageGeneration: toImageGenerationInput(image, text.trim(), placement === "home" ? null : editTarget?.fileId ?? null),
      } : {}),
      ...(quoted
        ? { reference: { fileId: quoted.fileId, label: quoted.label, text: quoted.text } }
        : {}),
    };

    // Kept whole, before any of it is cleared, so Stop can put it back.
    lastSent = draft;
    setText("");
    setMentions([]);
    setAttachments([]);
    // Back to auto: a stated type belongs to the message that stated it. Left
    // sticky, one "New document" would silently turn every later instruction
    // typed beside an open file into a new file.
    setOutput("auto");
    // The references went with the picture they were for; the look (ratio,
    // style, camera) is kept, since the next version usually wants the same.
    if (mode === "image") setImage({ references: [] });
    // "New image instead" was about this message.
    setDeclinedTarget(null);
    if (placement === "home") setMode("agent");
    setMentionQuery(null);
    // The quote went with the message; leaving it up would make the next one
    // look like it is about the same passage.
    if (reference) clearSelection();
    // A picture asked for beside a document is a new thing, not a change to
    // that document: step off it the way Home does, so "Creating your image"
    // has the canvas instead of waiting behind the deck.
    // The mode goes with it: coming back to the deck is coming back to Agent.
    if (mode === "image" && documentOnScreen) {
      patchDraft(() => ({ modeFileId: null }));
      dispatch({ type: "enter-stage" });
    }
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
      notBuiltYet("dictate", translate("shell.cx.dictateUnavailable"));
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
    recognition.onerror = () => toast.error(translate("shell.cx.dictateFailed"));
    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      toast.error(translate("shell.cx.dictateFailed"));
    }
  }

  /*
   * A file picked from a menu elsewhere ("Reference") joins the message being
   * written here. Only the composer beside the work listens; on Home it is the
   * hero's, because that is the only one there is.
   */
  useEffect(
    () =>
      referenceRequests.subscribe((fileId) => {
        const file = files.find((entry) => entry.id === fileId);
        if (!file) return;
        setMentions((current) =>
          current.some((entry) => entry.kind === "file" && entry.id === file.id)
            ? current
            : [...current, { kind: "file", id: file.id, label: file.name }],
        );
        inputRef.current?.focus();
      }),
    // `setMentions` only calls the state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files],
  );

  /** The "add" button: which files this message may use, and what it should make. */
  function chooseContext() {
    openTaskContext({
      files,
      currentFile: openFile,
      selected: mentions.filter((mention) => mention.kind === "file").map((mention) => mention.id),
      attachments,
      output,
      provider: settings.models.find((model) => model.id === settings.value.selectedModelId)?.provider ?? "",
      onChooseFromDisk: () =>
        void pickNativeAttachments().then((picked) => {
          if (!picked) fileInputRef.current?.click();
        }),
      onApply: (next) => {
        setMentions((current) => [
          ...current.filter((mention) => mention.kind !== "file"),
          ...next.fileIds
            .map((id) => files.find((file) => file.id === id))
            .filter((file): file is NonNullable<typeof file> => Boolean(file))
            .map((file): Mention => ({ kind: "file", id: file.id, label: file.name })),
        ]);
        setOutput(next.output);
      },
    });
  }

  function chooseModel(anchor: HTMLElement) {
    openMenu(anchor, [
      ...settings.models.map((model) => ({
        label: model.provider ? `${model.name} · ${model.provider}` : model.name,
        checked: model.id === settings.value.selectedModelId,
        onSelect: () => void settings.patch({ selectedModelId: model.id }),
      })),
      "-",
      { label: t("dx.composer.manageModels"), onSelect: () => dispatch({ type: "go", page: "settings", section: "models" }) },
    ]);
  }

  /** "@" at the caret, and the mention menu open on it — the @ tool's job. */
  function startMention() {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const gap = start > 0 && !/\s$/.test(text.slice(0, start)) ? " " : "";
    const next = `${text.slice(0, start)}${gap}@${text.slice(end)}`;
    setText(next);
    setMentionQuery("");
    queueMicrotask(() => {
      input?.focus();
      const caret = start + gap.length + 1;
      input?.setSelectionRange(caret, caret);
    });
  }

  /**
   * Quotes the selection — or opens an empty pair at the caret. Words in
   * quotes are what image models read as "draw this text", which is the whole
   * of what the Tт tool promises.
   */
  function quoteSelection() {
    const input = inputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const gap = start > 0 && !/\s$/.test(text.slice(0, start)) ? " " : "";
    const picked = text.slice(start, end);
    setText(`${text.slice(0, start)}${gap}"${picked}"${text.slice(end)}`);
    queueMicrotask(() => {
      input?.focus();
      const from = start + gap.length + 1;
      input?.setSelectionRange(from, from + picked.length);
    });
  }

  const imageMode = mode === "image";
  /* The task column is ~300px: Home's two-column prompt and wide strip do not fit it. */
  const compactImage = imageMode && placement !== "home";
  const placeholder = placement === "home"
    ? imageMode ? t("shell.cx.placeholder.homeImage") : t("shell.cx.placeholder.home")
    : imageMode
      ? editTarget ? t("shell.cx.placeholder.imageVersion", { version: editTarget.version }) : t("shell.cx.placeholder.homeImage")
      : t("shell.cx.placeholder.task");

  const hiddenInputs = (
    <>
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
    </>
  );

  const sendButton = (
    <button
      type="button"
      className={imageMode ? "shell-cx-send" : "dx-send"}
      data-act={stopping ? "task-stop" : "send"}
      disabled={!canSend && !stopping}
      aria-label={stopping ? t("shell.cx.stop") : t("shell.cx.send")}
      title={stopping ? t("shell.cx.stop") : t("shell.cx.send")}
      onClick={() => void submit()}
    >
      {imageMode ? (
        stopping ? (
          <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        ) : (
          <ArrowUp size={20} strokeWidth={1.7} aria-hidden="true" />
        )
      ) : (
        <Icon name={stopping ? "Square" : "ArrowUp"} />
      )}
    </button>
  );

  if (imageMode) {
    return (
      <div
        className={`shell-cx shell-cx--${placement}${dragging ? " is-dragging" : ""} is-image`}
        {...dropZone}
      >
        {compactImage ? (
          <>
            <ImageComposerHeader
              draft={image}
              onChange={setImage}
              target={editTarget}
              declined={declined}
              onDecline={() => setDeclinedTarget(editTarget?.fileId ?? null)}
              onRestore={() => setDeclinedTarget(null)}
              onExit={forcedImage ? undefined : () => setMode("agent")}
              disabled={busy}
            />
            <ReferenceStrip
              references={image.references}
              onChange={(references) => setImage({ references })}
              disabled={busy}
            />
            <textarea
              id={inputId}
              ref={inputRef}
              className="shell-cx-input"
              rows={2}
              value={text}
              aria-label={t("shell.cx.aria.messageAgent")}
              placeholder={placeholder}
              onChange={(event) => handleInput(event.target.value, event.target.selectionStart ?? 0)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={onInputKeyDown}
            />
          </>
        ) : (
          <div className="shell-ig-prompt-row">
            <ReferenceList
              references={image.references}
              onChange={(references) => setImage({ references })}
              disabled={busy && placement !== "home"}
            />
            <textarea
              id={inputId}
              ref={inputRef}
              className="shell-cx-input"
              rows={2}
              value={text}
              aria-label={placement === "home" ? t("shell.cx.aria.newTask") : t("shell.cx.aria.messageAgent")}
              placeholder={placeholder}
              onChange={(event) => handleInput(event.target.value, event.target.selectionStart ?? 0)}
              onCompositionStart={onCompositionStart}
              onCompositionEnd={onCompositionEnd}
              onKeyDown={onInputKeyDown}
            />
          </div>
        )}

        <ImageSummary draft={image} onChange={setImage} disabled={busy && placement !== "home"} />

        <div className="shell-cx-toolbar">
          <div className="shell-cx-left">
            <ImageTools
              draft={image}
              onChange={setImage}
              onExit={forcedImage ? undefined : () => setMode("agent")}
              onMention={startMention}
              onQuoteText={quoteSelection}
              disabled={busy && placement !== "home"}
              compact={compactImage}
            />
          </div>
          <div className="shell-cx-right">{sendButton}</div>
        </div>

        {dragging ? <div className="shell-cx-drop">{t("shell.cx.drop")}</div> : null}

        <MentionMenu
          open={mentionQuery !== null}
          query={mentionQuery ?? ""}
          folders={folders}
          files={files}
          inputId={inputId}
          onPick={pickMention}
          onClose={() => setMentionQuery(null)}
        />
        {hiddenInputs}
      </div>
    );
  }

  const kind = placement === "home" ? "home" : placement === "floating" ? "dex" : "chat";

  /*
   * What "this" refers to: the passage selected in the document, with its
   * source and its actual words — never a bare "Selected content" (§17). In a
   * conversation it sits inside the composer, above the text; over a Local
   * document the Dex panel shows it above the composer, so it is drawn outside
   * the box there.
   */
  const quote = reference ? (
    <div
      className={kind === "dex" ? "dx-dex-reference" : "dx-chat-reference"}
      role="group"
      aria-label={t("dx.composer.referenceAria")}
    >
      <header>
        {kind === "chat" && activeFile ? <FileIcon ext={extensionOf(activeFile)} size={16} /> : null}
        <span className="dx-ellipsis" title={reference.label}>
          {reference.label}
        </span>
        <button
          type="button"
          className="dx-ib"
          aria-label={t("dx.composer.removeReference")}
          title={t("dx.composer.removeReference")}
          data-act="remove-selection-reference"
          onClick={() => {
            clearSelection();
            inputRef.current?.focus({ preventScroll: true });
          }}
        >
          <Icon name="X" />
        </button>
      </header>
      {reference.text ? <p>{reference.text}</p> : null}
    </div>
  ) : null;

  return (
    <>
      {kind === "dex" ? quote : null}
      <div className="dx-composer" data-composer={kind} data-dragging={dragging ? "true" : undefined} {...dropZone}>
        {/* The panel is a picture's conversation; the message is about the document. */}
        {placement !== "home" && imageAside ? <ImageAsideNotice aside={imageAside} /> : null}

        {kind === "dex" ? null : quote}

        {mentions.map((mention) => {
          const file = mention.kind === "file" ? files.find((entry) => entry.id === mention.id) : undefined;
          return (
            <span key={`${mention.kind}:${mention.id}`} className="dx-reference-chip">
              <FileIcon ext={file ? extensionOf(file) : mention.kind === "folder" ? "folder" : "file"} size={16} />
              <span className="dx-reference-label dx-ellipsis" title={mention.label}>
                {mention.label}
              </span>
              <button
                type="button"
                className="dx-ib"
                aria-label={t("shell.cx.chip.remove", { name: mention.label })}
                title={t("shell.cx.chip.remove", { name: mention.label })}
                data-act="remove-ref"
                onClick={() => removeMention(mention)}
              >
                <Icon name="X" />
              </button>
            </span>
          );
        })}

        {attachments.map((attachment) => (
          <span key={attachment.id} className="dx-reference-chip">
            <FileIcon ext={attachment.fileCount ? "folder" : attachment.name} size={16} />
            <span className="dx-reference-label dx-ellipsis" title={attachment.name}>
              {attachment.name}
              {attachment.fileCount ? t("shell.cx.chip.fileCount", { count: attachment.fileCount }) : ""}
            </span>
            <button
              type="button"
              className="dx-ib"
              aria-label={t("shell.cx.chip.remove", { name: attachment.name })}
              title={t("shell.cx.chip.remove", { name: attachment.name })}
              data-act="remove-ref"
              onClick={() => setAttachments((current) => current.filter((entry) => entry !== attachment))}
            >
              <Icon name="X" />
            </button>
          </span>
        ))}

        {output !== "auto" ? (
          <span className="dx-reference-chip" data-output={output}>
            <FileIcon ext={DOCUMENT_TYPES[output]} size={16} />
            <span className="dx-reference-label dx-ellipsis">
              {t("dx.composer.createsNew", {
                type: t(OUTPUTS.find((entry) => entry.value === output)?.label ?? "shell.cx.output.newFile"),
              })}
            </span>
            <button
              type="button"
              className="dx-ib"
              aria-label={t("dx.composer.clearOutput")}
              title={t("dx.composer.clearOutput")}
              onClick={() => setOutput("auto")}
            >
              <Icon name="X" />
            </button>
          </span>
        ) : null}

        <textarea
          id={inputId}
          ref={inputRef}
          rows={2}
          value={text}
          data-draft={kind}
          aria-label={t(
            kind === "home"
              ? "dx.composer.ariaHome"
              : kind === "dex"
                ? "dx.composer.ariaDex"
                : "dx.composer.ariaChat",
          )}
          placeholder={t("dx.composer.placeholder")}
          onChange={(event) => handleInput(event.target.value, event.target.selectionStart ?? 0)}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={onInputKeyDown}
        />

        <div className="dx-composer-tools">
          <div className="dx-composer-tools-start">
            <button
              type="button"
              className="dx-context-button"
              data-act="context"
              aria-label={t("dx.composer.context")}
              title={t("dx.composer.context")}
              onClick={chooseContext}
            >
              <Icon name="Plus" />
            </button>
          </div>
          <div className="dx-composer-tools-end">
            <button
              type="button"
              className="dx-model-button"
              data-act="model-picker"
              aria-label={t("dx.composer.model")}
              title={t("dx.composer.chooseModel")}
              onClick={(event) => chooseModel(event.currentTarget)}
            >
              <span className="dx-ellipsis">{t("dx.composer.model")}</span>
              <Icon name="ChevronDown" />
            </button>
            <button
              type="button"
              className="dx-ib"
              data-act="voice"
              aria-label={listening ? t("shell.cx.dictateStop") : t("dx.composer.voice")}
              aria-pressed={listening}
              title={listening ? t("shell.cx.dictateListening") : t("dx.composer.voice")}
              onClick={dictate}
            >
              <Icon name="Mic" />
            </button>
            {sendButton}
          </div>
        </div>

        <MentionMenu
          open={mentionQuery !== null}
          query={mentionQuery ?? ""}
          folders={folders}
          files={files}
          inputId={inputId}
          onPick={pickMention}
          onClose={() => setMentionQuery(null)}
        />
        {hiddenInputs}
      </div>
    </>
  );
}

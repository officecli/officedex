import { useCallback, useEffect, useRef, useState } from "react";

import { usePort } from "../port/PortContext";
import { translate } from "../../renderer/i18n";
import type { AgentMessage, AgentOutlinePage, AgentTask } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { useCanvas } from "../canvas/CanvasContext";
import type { ComposerSubmission } from "../composer/Composer";
import type { CanvasAdapter } from "../editor/canvasContract";
import { logShellEvent } from "../port/shellLog";
import { useComposerSettings } from "../composer/useComposerSettings";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { startDocumentEditRun, type DocumentEditRunHandle } from "./documentEditRun";
import { toast } from "../../renderer/ui";

/**
 * The task for the folder currently in scope, kept live off the port's event
 * stream. One subscription serves every placement of the presence, because
 * there is only one conversation.
 *
 * Every callback here reports its own failures. Several of these controls have
 * no implementation behind them yet — Pause on anything but a presentation —
 * and the rule is that the button stays where the UI layer put it and says so
 * when pressed, rather than being hidden or quietly doing nothing.
 *
 * ## Two places a message can go
 *
 * Most instructions go to the port, which starts a run in the generation
 * runtime. An instruction aimed at a Word document that is *already open* goes
 * to the editor instead, as exact replacements inside it (`documentEditRun`).
 *
 * The split is not a preference, it is what the two things can do. The runtime
 * regenerates a document from a prompt and hands back a new file; asked to
 * shorten one paragraph it rewrites several thousand words and overwrites the
 * copy the user has open — including whatever they had typed into it. The
 * editor path changes the paragraph.
 *
 * Which one runs is decided by `canvas.canEditDocument()`, so it follows the
 * document on screen rather than a guess made from file metadata: a Word file
 * whose editor failed to mount cannot be edited in place, and says so by
 * answering false, and the message goes the long way round instead.
 */
/**
 * Which in-place editor, if any, this instruction belongs to.
 *
 * A file the agent can change where it stands gets the in-place path; anything
 * else goes to the generation runtime. Two things have to be true at once — the
 * file is the kind that has an in-place editor, and one is mounted for it — and
 * the adapter answers the second because only it knows what is on screen.
 *
 * This used to ask about documents alone (`target?.type === "doc"`), so an
 * instruction about an open deck fell through to the generation runtime:
 * "change slide 3's title" re-authored the whole deck from the prompt, which
 * filled the canvas with a deck being drawn and left the title unchanged. Both
 * editors have had an in-place runner the whole time — Word's
 * `office.docx.edit.v1` and the deck's `office.pptx.plan_js` (`pptxEditRun`) —
 * and neither was reachable for a deck.
 *
 * Pure, so the decision can be tested without rendering the shell.
 */
export function inPlaceEditorFor(
  file: { readonly type?: string } | null,
  canvas: Pick<CanvasAdapter, "canEditDocument" | "editDocument" | "onDraftAction" | "showDraft"> | null,
): "docx" | "pptx" | null {
  if (!file || !canvas?.canEditDocument?.()) return null;
  if (file.type === "doc") return "docx";
  if (file.type === "slides") return "pptx";
  return null;
}

export function useAgentTask() {
  const port = usePort();
  const canvas = useCanvas();
  const { scopeFolderId, reload, files } = useShell();
  const settings = useComposerSettings();
  const [task, setTask] = useState<AgentTask | null>(null);

  /**
   * The in-place edit currently on screen, when the last thing that happened
   * was one.
   *
   * Held as state *and* a ref: the state is what the panel renders, the ref is
   * what Stop and Undo reach for. They are pressed from callbacks that were
   * created before the run existed.
   */
  const [localTask, setLocalTask] = useState<AgentTask | null>(null);
  const localRun = useRef<DocumentEditRunHandle | null>(null);
  /** The newest snapshot of the local edit, for handing to the conversation when it ends. */
  const localSnapshot = useRef<AgentTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await port.agent.current(scopeFolderId);
        if (!cancelled) setTask(current);
      } catch (reason) {
        if (!cancelled) reportPortFailure(reason);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port, scopeFolderId]);

  // A local edit belongs to the folder it was run in. Changing scope is the
  // user looking somewhere else, and the conversation they find there should be
  // that folder's, not the last document edit wherever it happened.
  useEffect(() => {
    localRun.current = null;
    setLocalTask(null);
  }, [scopeFolderId]);

  useEffect(
    () =>
      port.agent.subscribe((event) => {
        // A run that failed, and a limitation the run ran into, are both things
        // the user has to be told. This used to drop each on the floor.
        if (event.kind === "error") {
          toast.error({ content: translate("shell.agentRun.stopped"), description: event.message });
          return;
        }
        if (event.kind === "notice") {
          toast.warning({ content: translate("shell.port.notBuilt"), description: event.message });
          return;
        }
        if (event.kind === "cleared") {
          if (event.folderId !== scopeFolderId) return;
          setTask(null);
          // A finished in-place edit belongs to the conversation just left.
          // One still running keeps its place until it is done.
          if (!isLive(localSnapshot.current)) {
            localRun.current = null;
            setLocalTask(null);
          }
          return;
        }
        if (event.task.folderId !== scopeFolderId) return;
        // Another conversation in this folder, or an older run of this one:
        // the list and the library want it, the panel does not.
        if (event.focused === false) return;
        setTask(event.task);
      }),
    [port, scopeFolderId],
  );

  /*
   * The local edit wins while it is the newest thing in this folder.
   *
   * It is cleared the moment a message goes to the port, so the two can never
   * both be "the current conversation" — what this ordering decides is only
   * what happens to a runtime task that was already finished when the user
   * started editing by hand. That task is history; the edit is now.
   */
  const shown: AgentTask | null = localTask
    ? { ...localTask, messages: mergeMessages(task?.messages ?? [], localTask.messages) }
    : task;
  const busy =
    shown?.status === "working" || shown?.status === "reading" || shown?.status === "writing";

  const send = useCallback(
    async (submission: ComposerSubmission & { newConversation?: boolean }) => {
      const target = submission.activeFileId
        ? (files.find((file) => file.id === submission.activeFileId) ?? null)
        : null;

      const editableAs = inPlaceEditorFor(target, canvas);
      /*
       * Which way this instruction went, and why.
       *
       * Whether a message edits the open file or starts a run is a decision
       * made from two inputs the user cannot see — what is on the canvas right
       * now, and whether the composer was aimed at a file — and getting it
       * wrong is invisible from the outside: the wrong path still succeeds, it
       * just rewrites the deck instead of changing slide 2. A packaged build
       * offers no console, so this is the only record that would let the next
       * report be diagnosed from a file rather than from a screenshot.
       */
      logShellEvent("agent.routing", {
        targetFileId: target?.id ?? null,
        targetType: target?.type ?? null,
        inPlace: editableAs,
        // `null` here with a file in mind means the canvas had something else
        // mounted — a run's stage, or an editor that is still coming up.
        canvasCanEditInPlace: Boolean(canvas?.canEditDocument?.()),
      });
      if (!submission.imageGeneration && !submission.newConversation && editableAs && target && canvas) {
        // One at a time. A second instruction into the same document while the
        // first is mid-`apply` would capture a scope the first one is holding,
        // and the editor would reject whichever arrived second.
        localRun.current?.abort();
        const folderId = submission.folderId || scopeFolderId;
        const run = startDocumentEditRun(
          {
            canvas,
            onTask: (next) => {
              localSnapshot.current = next;
              setLocalTask(next);
            },
          },
          {
            instruction: submission.text,
            folderId: submission.folderId || scopeFolderId,
            fileId: target.id,
            fileName: target.name,
            documentType: editableAs,
            ...(submission.reference ? { reference: submission.reference } : {}),
          },
        );
        localRun.current = run;
        await run.done;
        /*
         * The edit is part of the conversation. Handed to the port once it is
         * over, so the thread still has it after the next message goes to the
         * runtime — and the runtime is told it happened.
         */
        const finished = localSnapshot.current;
        if (finished?.messages.length) {
          await attempt(() => port.agent.recordExchange({ folderId, messages: finished.messages }));
        }
        // The document changed under the library's feet: the editor wrote it,
        // so nothing else knows its size or its modified time has moved.
        await reload();
        return;
      }

      localRun.current?.abort();
      localRun.current = null;
      setLocalTask(null);
      await attempt(() =>
        port.agent.send({
          ...submission,
          modelId: settings.value.selectedModelId,
          permission: settings.value.permission,
        }),
      );
    },
    [
      port,
      canvas,
      files,
      reload,
      scopeFolderId,
      settings.value.selectedModelId,
      settings.value.permission,
    ],
  );

  const applySuggestion = useCallback(
    async (id: string) => {
      /*
       * An in-place edit has nothing to apply — it was applied when it ran.
       *
       * The card withdraws itself after an undo so this should be unreachable,
       * but "should be unreachable" is how the port ends up being asked for an
       * artifact that was never written, and answering with
       * `NotImplementedError("agent.applySuggestion")` would blame the wrong
       * thing entirely.
       */
      if (localRun.current?.suggestionId === id) return;
      // Applying marks the target file dirty, so the tab dot and status bar
      // have to be re-read from the port rather than guessed at. Only worth
      // doing if the call actually went through.
      if (await attempt(() => port.agent.applySuggestion(id))) await reload();
    },
    [port, reload],
  );

  const undoSuggestion = useCallback(
    async (id: string) => {
      // An in-place edit owns its own undo — the editor made the change, and
      // only the editor can put it back. Routing this to the port would look
      // for an artifact that was never written.
      if (localRun.current?.suggestionId === id) {
        if (await attempt(() => localRun.current!.undo())) await reload();
        return;
      }
      if (await attempt(() => port.agent.undoSuggestion(id))) await reload();
    },
    [port, reload],
  );

  /**
   * Resolves to whether the run was actually stopped. The composer hands the
   * message back for editing on `true`, and a Stop the port refused must not
   * do that: the run is still going, and a full input turns Stop into Send.
   */
  const stop = useCallback(async (): Promise<boolean> => {
    if (localRun.current) {
      localRun.current.abort();
      return true;
    }
    return attempt(() => port.agent.finish());
  }, [port]);

  return {
    task: shown,
    busy,
    send,
    /** Empties the panel; the next message starts a new conversation. */
    newConversation: useCallback(async () => {
      // The panel disables the button while anything runs; this is the same
      // rule for a caller that did not.
      if (isLive(localSnapshot.current)) return;
      await attempt(() => port.agent.startConversation(scopeFolderId));
    }, [port, scopeFolderId]),
    answer: useCallback(
      async (input: { optionId?: string; text?: string; outline?: readonly AgentOutlinePage[] }) => {
        /*
         * A question from an in-place edit is answered here, not by the port.
         *
         * The run is local — it never reached the runtime — so `agent.answer`
         * would be answering a run that does not exist, and the edit would stay
         * blocked on a question the user had already pressed a button for.
         */
        const local = localRun.current;
        if (local) {
          local.answer(input);
          return;
        }
        await attempt(() => port.agent.answer(input));
      },
      [port],
    ),
    applySuggestion,
    undoSuggestion,
    pause: useCallback(async () => void (await attempt(() => port.agent.pause())), [port]),
    resume: useCallback(async () => void (await attempt(() => port.agent.resume())), [port]),
    resumeFailed: useCallback(
      async (taskId: string) => void (await attempt(() => port.agent.resumeFailed(taskId))),
      [port],
    ),
    finish: useCallback(async () => {
      // Finishing a local edit is dismissing it: there is no run left to stop,
      // and the change is already in the document.
      if (localRun.current) {
        localRun.current.abort();
        localRun.current = null;
        setLocalTask(null);
        return;
      }
      await attempt(() => port.agent.finish());
    }, [port]),
    stop,
  };
}

/**
 * The conversation's messages with the in-place edit on screen added.
 *
 * The port also carries a finished edit once it has been recorded, so the two
 * overlap for as long as the edit stays on screen; the id is what they share.
 */
export function mergeMessages(conversation: readonly AgentMessage[], local: readonly AgentMessage[]): AgentMessage[] {
  const seen = new Set(conversation.map((message) => message.id));
  return [...conversation, ...local.filter((message) => !seen.has(message.id))];
}

function isLive(task: AgentTask | null): boolean {
  return task?.status === "working" || task?.status === "reading" || task?.status === "writing";
}

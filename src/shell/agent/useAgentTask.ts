import { useCallback, useEffect, useRef, useState } from "react";

import { usePort } from "../port/PortContext";
import { requestsNewFile, inferHomeTaskRoute } from "../../renderer/homeIntake";
import { translate } from "../../renderer/i18n";
import type { AgentMessage, AgentOutlinePage, AgentTask } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { newConversationId } from "../state/libraryMeta";
import { useCanvas } from "../canvas/CanvasContext";
import type { ComposerSubmission } from "../composer/Composer";
import type { CanvasAdapter } from "../editor/canvasContract";
import { logShellEvent } from "../port/shellLog";
import { useComposerSettings } from "../composer/useComposerSettings";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { startDocumentEditRun, type DocumentEditRunHandle } from "./documentEditRun";
import { toast } from "../../renderer/ui";

/**
 * The task for the conversation currently in scope, kept live off the port's
 * event stream. One subscription serves every placement of the presence,
 * because there is only one conversation on screen at a time.
 *
 * Which conversation that is comes from `ShellContext.scope`, not from the
 * folder: a project's chat is addressed by its id, a Local document by the
 * conversation it owns, and a Local document that owns none shows nothing
 * until its first message starts one. Asking the port for "the folder's
 * current conversation" is reserved for a chat that has no id yet — the
 * runtime names those after their first run.
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

export function hasExplicitFileTargets(submission: Pick<ComposerSubmission, "attachments" | "mentions" | "reference" | "activeFileId">): boolean {
  return submission.attachments.length > 0 || submission.mentions.filter(mention => mention.kind === "file").length > 1 || Boolean(submission.reference && submission.reference.fileId !== submission.activeFileId);
}

export function useAgentTask() {
  const port = usePort();
  const canvas = useCanvas();
  const { scopeFolderId, scope, reload, files, setChatMeta } = useShell();
  const kind = scope.kind;
  // A project holds many conversations; the panel shows the addressed one.
  const conversationId = scope.kind === "conversation" ? scope.conversationId : null;
  const fileId = scope.kind === "file" ? scope.fileId : null;
  /** Changes exactly when the conversation on screen does. */
  const scopeKey = `${kind}:${scopeFolderId}:${conversationId ?? fileId ?? ""}`;
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
  const lastLocalSubmission = useRef<ComposerSubmission | null>(null);
  const localAttempt = useRef(1);
  const [localQueue, setLocalQueue] = useState<Array<{ id: string; input: ComposerSubmission }>>([]);
  const queueRef = useRef(localQueue);
  queueRef.current = localQueue;
  const sendRef = useRef<(input: ComposerSubmission) => Promise<void>>(async () => {});
  const visibleScope = useRef(scopeKey);
  visibleScope.current = scopeKey;
  const localSessions = useRef(new Map<string, { task: AgentTask | null; run: DocumentEditRunHandle | null; queue: typeof localQueue; submission: ComposerSubmission | null; attempt: number }>());
  const rememberQueue = (queue: typeof localQueue) => {
    const session = localSessions.current.get(visibleScope.current);
    if (session) session.queue = queue;
  };
  const takeLocalQueued = () => {
    const [next, ...rest] = queueRef.current;
    queueRef.current = rest;
    setLocalQueue(rest);
    rememberQueue(rest);
    return next;
  };

  useEffect(() => {
    let cancelled = false;
    // A Local document with no conversation of its own has nothing to show.
    // Asking the folder instead is how it came to show the previous file's.
    if (kind === "file") {
      setTask(null);
      return;
    }
    void (async () => {
      try {
        // The port shows one conversation per folder and keeps its own idea of
        // which. A restored selection, or a move between two conversations of
        // one project, has to tell it — otherwise the panel shows the folder's
        // last conversation under the selected one's name.
        const current = conversationId
          ? await port.agent.openConversation(scopeFolderId, conversationId)
          : await port.agent.current(scopeFolderId);
        if (cancelled) return;
        // A conversation the port has no run for yet answers null. Its first
        // run's event may have landed while this was in flight; that is the
        // conversation, not something to clear.
        setTask((previous) =>
          current ?? (conversationId && previous && conversationKey(previous) === conversationId ? previous : null),
        );
      } catch (reason) {
        if (!cancelled) reportPortFailure(reason);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [port, kind, scopeFolderId, conversationId]);

  // A local edit belongs to the conversation it was run in. Changing scope is
  // the user looking somewhere else — another project, or another Local
  // document in the same folder — and what they find there should be that
  // conversation's, not the last document edit wherever it happened.
  useEffect(() => {
    const session = localSessions.current.get(scopeKey);
    localRun.current = session?.run ?? null;
    localSnapshot.current = session?.task ?? null;
    lastLocalSubmission.current = session?.submission ?? null;
    localAttempt.current = session?.attempt ?? 1;
    queueRef.current = session?.queue ?? [];
    setLocalQueue(queueRef.current);
    setLocalTask(session?.task ?? null);
  }, [scopeKey]);

  useEffect(
    () =>
      port.agent.subscribe((event) => {
        // A run that failed, and a limitation the run ran into, are both things
        // the user has to be told. This used to drop each on the floor.
        /*
         * One toast per thing said.
         *
         * This hook is mounted more than once (the agent context, and the
         * image edit target twice), so every error and notice reaches three
         * subscribers and used to be shown three times. The port also reports
         * a failure once per task now, but the module-level guard is what
         * makes the toast count independent of how many surfaces listen.
         */
        if (event.kind === "error") {
          if (!recentToasts.note(`error:${event.message}`)) return;
          toast.error({ content: translate("shell.agentRun.stopped"), description: event.message });
          return;
        }
        if (event.kind === "notice") {
          if (!recentToasts.note(`notice:${event.message}`)) return;
          toast.warning({ content: translate("shell.agentRun.notice"), description: event.message });
          return;
        }
        if (event.kind === "cleared") {
          if (event.folderId !== scopeFolderId) return;
          // The folder's panel was emptied. An addressed conversation is not
          // that panel, and a document without one shows nothing anyway.
          if (kind !== "folder") return;
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
        // A document that owns no conversation has no run to show, whatever
        // else is happening in its folder — Home's run included.
        if (kind === "file") return;
        // Another conversation in this folder: the list and the library want
        // it, the panel does not. Addressed by id when the scope has one, by
        // the port's own focus when it does not.
        if (conversationId && conversationKey(event.task) !== conversationId) return;
        // An older run of this conversation: its projection is out of date.
        if (event.focused === false) return;
        setTask(event.task);
      }),
    [port, kind, scopeFolderId, conversationId],
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
    ? { ...localTask, history: task ? [...(task.history ?? []), { ...task, history: undefined }] : [], messages: mergeMessages(task?.messages ?? [], localTask.messages), queued: localQueue.map((entry) => ({ id: entry.id, text: entry.input.text })) }
    : task;
  const busy =
    shown?.status === "working" || shown?.status === "reading" || shown?.status === "writing";

  const send = useCallback(
    async (submission: ComposerSubmission & { newConversation?: boolean }) => {
      if (localRun.current && localSnapshot.current?.question?.allowFreeform) {
        localRun.current.answer({ text: submission.text });
        return;
      }
      if (isLive(localSnapshot.current)) {
        const next = [...queueRef.current, { id: `local-queued:${Date.now()}:${queueRef.current.length}`, input: submission }];
        queueRef.current = next; setLocalQueue(next); rememberQueue(next);
        return;
      }
      const explicitTargets = hasExplicitFileTargets(submission);
      const target = !explicitTargets && submission.activeFileId
        ? (files.find((file) => file.id === submission.activeFileId) ?? null)
        : null;

      /*
       * Which conversation this message joins.
       *
       * An addressed one is named outright. A Local document without one gets
       * its own here, before anything is sent, and the id is recorded against
       * the file so the next open of that document finds the same thread.
       * Home's composer and New → AI Chat leave the id to the runtime.
       */
      let addressed: string | undefined = conversationId ?? undefined;
      if (kind === "file" && fileId) {
        addressed = newConversationId();
        setChatMeta(addressed, { folderId: scopeFolderId, fileId, createdAt: Date.now() });
      }
      const addressing = addressed ? { conversationId: addressed } : {};
      const addressedScope = addressed ? `conversation:${scopeFolderId}:${addressed}` : scopeKey;
      const isVisible = () => visibleScope.current === scopeKey || visibleScope.current === addressedScope;

      const route = inferHomeTaskRoute({ prompt: submission.text });
      const newFile = Boolean(submission.documentType) || requestsNewFile(submission.text) || route.kind === "unsupported_format";
      const editableAs = newFile ? null : inPlaceEditorFor(target, canvas);
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
      if (!submission.imageGeneration && !submission.newConversation && submission.mentions.filter((mention) => mention.kind === "file").length < 2 && editableAs && target && canvas) {
        // One at a time. A second instruction into the same document while the
        // first is mid-`apply` would capture a scope the first one is holding,
        // and the editor would reject whichever arrived second.
        localRun.current?.abort();
        if (lastLocalSubmission.current !== submission) localAttempt.current = 1;
        lastLocalSubmission.current = submission;
        const folderId = submission.folderId || scopeFolderId;
        let finishedLocal: AgentTask | null = null;
        const localSession = { task: null as AgentTask | null, run: null as DocumentEditRunHandle | null, queue: queueRef.current, submission, attempt: localAttempt.current };
        localSessions.current.set(scopeKey, localSession);
        localSessions.current.set(addressedScope, localSession);
        const run = startDocumentEditRun(
          {
            canvas,
            onTask: (next) => {
              next.attempt = localSession.attempt;
              finishedLocal = next;
              localSession.task = next;
              if (isVisible()) {
                localSnapshot.current = next;
                setLocalTask(next);
              }
            },
          },
          {
            instruction: submission.text,
            requireReview: settings.value.permission !== "full" || /先审阅|先审核|先确认|review.*first|before.*apply|approval/i.test(submission.text),
            folderId: submission.folderId || scopeFolderId,
            fileId: target.id,
            fileName: target.name,
            documentType: editableAs,
            ...(submission.reference ? { reference: submission.reference } : {}),
          },
        );
        localSession.run = run;
        localRun.current = run;
        await run.done;
        /*
         * The edit is part of the conversation. Handed to the port once it is
         * over, so the thread still has it after the next message goes to the
         * runtime — and the runtime is told it happened.
         */
        const finished = finishedLocal as AgentTask | null;
        if (finished?.messages.length) {
          await attempt(() => port.agent.recordExchange({ folderId, ...addressing, messages: finished.messages }));
        }
        // The document changed under the library's feet: the editor wrote it,
        // so nothing else knows its size or its modified time has moved.
        await reload();
        if (isVisible() && finished?.outcome !== "stopped") {
          const next = takeLocalQueued();
          if (next) void sendRef.current(next.input);
        }
        return;
      }

      localRun.current?.abort();
      localRun.current = null;
      localSnapshot.current = null;
      localSessions.current.delete(scopeKey);
      localSessions.current.delete(addressedScope);
      setLocalTask(null);
      await attempt(() =>
        port.agent.send({
          ...submission,
          ...(explicitTargets ? { activeFileId: null } : {}),
          ...addressing,
          modelId: settings.value.selectedModelId,
          permission: settings.value.permission,
        }),
      );
      while (queueRef.current.length) {
        const next = takeLocalQueued();
        if (next) await attempt(() => port.agent.send({ ...next.input, ...addressing,
          modelId: settings.value.selectedModelId, permission: settings.value.permission }));
      }
    },
    [
      port,
      canvas,
      files,
      reload,
      kind,
      fileId,
      conversationId,
      scopeFolderId,
      scopeKey,
      setChatMeta,
      settings.value.selectedModelId,
      settings.value.permission,
    ],
  );

  sendRef.current = send;

  const rejectSuggestion = useCallback(async (id: string) => {
    if (await attempt(async () => {
      if (!port.agent.rejectSuggestion) throw new Error("Reject is unavailable in this runtime.");
      await port.agent.rejectSuggestion(id);
    })) await reload();
  }, [port, reload]);
  const suggestionChanges = useCallback(async (id: string) => {
    if (!port.agent.suggestionChanges) throw new Error("Review is unavailable in this runtime.");
    return port.agent.suggestionChanges(id);
  }, [port]);

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
  const stop = useCallback(async (taskId?: string): Promise<boolean> => {
    if (localRun.current) {
      localRun.current.abort();
      return true;
    }
    // The card passes its run's id; the composer's Stop has none and ends
    // whatever the port holds live.
    return attempt(() => port.agent.finish(taskId));
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
    rejectSuggestion,
    suggestionChanges,
    applySuggestion,
    undoSuggestion,
    pause: useCallback(async () => void (await attempt(() => port.agent.pause())), [port]),
    resume: useCallback(async () => void (await attempt(() => port.agent.resume())), [port]),
    retryBatch: useCallback(async (taskId: string) => void (await attempt(async () => { await port.agent.retryBatch?.(taskId); })), [port]),
    retry: useCallback(async (taskId: string) => {
      if (localSnapshot.current?.id === taskId && lastLocalSubmission.current) {
        localAttempt.current += 1;
        await sendRef.current(lastLocalSubmission.current);
      } else await attempt(async () => { await port.agent.retry?.(taskId); });
    }, [port]),
    sendQueued: useCallback(async (taskId: string) => {
      if (localSnapshot.current?.id === taskId) { const next = takeLocalQueued(); if (next) await sendRef.current(next.input); }
      else await attempt(async () => { await port.agent.sendQueued?.(taskId); });
    }, [port]),
    removeQueued: useCallback(async (taskId: string, messageId: string) => {
      if (localSnapshot.current?.id === taskId) {
        queueRef.current = queueRef.current.filter((entry) => entry.id !== messageId); setLocalQueue(queueRef.current); rememberQueue(queueRef.current);
      } else await attempt(async () => { await port.agent.removeQueued?.(taskId, messageId); });
    }, [port]),
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
        localSnapshot.current = null;
        for (const [key, session] of localSessions.current) {
          if (session.task?.id === localTask?.id) localSessions.current.delete(key);
        }
        setLocalTask(null);
        return;
      }
      await attempt(() => port.agent.finish());
    }, [port, localTask]),
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

/**
 * The error and notice messages toasted in the last few seconds.
 *
 * Module-level on purpose: the toast is one per message for the window,
 * however many instances of this hook are mounted (see the subscriber).
 */
export const recentToasts = {
  seen: new Map<string, number>(),
  window: 5000,
  /** Records the message; false when it was already shown inside the window. */
  note(message: string): boolean {
    const now = Date.now();
    for (const [key, at] of this.seen) if (now - at > this.window) this.seen.delete(key);
    if (this.seen.has(message)) return false;
    this.seen.set(message, now);
    return true;
  },
};

function isLive(task: AgentTask | null): boolean {
  return task?.status === "working" || task?.status === "reading" || task?.status === "writing" || Boolean(task?.question);
}

/** The conversation a task belongs to; a run that names none is its own. */
function conversationKey(task: AgentTask): string {
  return task.conversationId ?? task.id;
}

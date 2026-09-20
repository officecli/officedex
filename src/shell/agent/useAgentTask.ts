import { useCallback, useEffect, useRef, useState } from "react";

import { usePort } from "../port/PortContext";
import type { AgentTask } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { useCanvas } from "../canvas/CanvasContext";
import type { ComposerSubmission } from "../composer/Composer";
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
          toast.error({ content: "The run stopped", description: event.message });
          return;
        }
        if (event.kind === "notice") {
          toast.warning({ content: "Not built yet", description: event.message });
          return;
        }
        if (event.task.folderId !== scopeFolderId) return;
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
  const shown = localTask ?? task;
  const busy =
    shown?.status === "working" || shown?.status === "reading" || shown?.status === "writing";

  const send = useCallback(
    async (submission: ComposerSubmission) => {
      const target = submission.activeFileId
        ? (files.find((file) => file.id === submission.activeFileId) ?? null)
        : null;

      if (target?.type === "doc" && canvas?.canEditDocument?.()) {
        // One at a time. A second instruction into the same document while the
        // first is mid-`apply` would capture a scope the first one is holding,
        // and the editor would reject whichever arrived second.
        localRun.current?.abort();
        const run = startDocumentEditRun(
          { canvas, onTask: setLocalTask },
          {
            instruction: submission.text,
            folderId: submission.folderId || scopeFolderId,
            fileId: target.id,
            fileName: target.name,
            ...(submission.reference ? { reference: submission.reference } : {}),
          },
        );
        localRun.current = run;
        await run.done;
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

  const stop = useCallback(async () => {
    if (localRun.current) {
      localRun.current.abort();
      return;
    }
    await attempt(() => port.agent.finish());
  }, [port]);

  return {
    task: shown,
    busy,
    send,
    answer: useCallback(
      async (input: { optionId?: string; text?: string }) =>
        void (await attempt(() => port.agent.answer(input))),
      [port],
    ),
    applySuggestion,
    undoSuggestion,
    pause: useCallback(async () => void (await attempt(() => port.agent.pause())), [port]),
    resume: useCallback(async () => void (await attempt(() => port.agent.resume())), [port]),
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

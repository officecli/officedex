import { useCallback, useEffect, useState } from "react";

import { usePort } from "../port/PortContext";
import type { AgentTask } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import type { ComposerSubmission } from "../composer/Composer";
import { useComposerSettings } from "../composer/useComposerSettings";
import { attempt, reportPortFailure } from "../port/reportPortFailure";
import { toast } from "../../renderer/ui";

/**
 * The task for the folder currently in scope, kept live off the port's event
 * stream. One subscription serves every placement of the presence, because
 * there is only one conversation.
 *
 * Every callback here reports its own failures. Several of these controls have
 * no implementation behind them yet — Apply, Undo, and Pause on anything but a
 * presentation — and the rule is that the button stays where the UI layer put
 * it and says so when pressed, rather than being hidden or quietly doing
 * nothing.
 */
export function useAgentTask() {
  const port = usePort();
  const { scopeFolderId, reload } = useShell();
  const settings = useComposerSettings();
  const [task, setTask] = useState<AgentTask | null>(null);

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

  const busy = task?.status === "working" || task?.status === "reading" || task?.status === "writing";

  const send = useCallback(
    async (submission: ComposerSubmission) => {
      await attempt(() =>
        port.agent.send({
          ...submission,
          modelId: settings.value.selectedModelId,
          permission: settings.value.permission,
        }),
      );
    },
    [port, settings.value.selectedModelId, settings.value.permission],
  );

  const applySuggestion = useCallback(
    async (id: string) => {
      // Applying marks the target file dirty, so the tab dot and status bar
      // have to be re-read from the port rather than guessed at. Only worth
      // doing if the call actually went through.
      if (await attempt(() => port.agent.applySuggestion(id))) await reload();
    },
    [port, reload],
  );

  const undoSuggestion = useCallback(
    async (id: string) => {
      if (await attempt(() => port.agent.undoSuggestion(id))) await reload();
    },
    [port, reload],
  );

  return {
    task,
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
    finish: useCallback(async () => void (await attempt(() => port.agent.finish())), [port]),
    stop: useCallback(async () => void (await attempt(() => port.agent.finish())), [port]),
  };
}

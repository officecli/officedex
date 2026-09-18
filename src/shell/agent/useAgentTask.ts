import { useCallback, useEffect, useState } from "react";

import { usePort } from "../port/PortContext";
import type { AgentTask } from "../port/types";
import { useShell } from "../state/ShellContext";
import type { ComposerSubmission } from "../composer/Composer";
import { useComposerSettings } from "../composer/useComposerSettings";

/**
 * The task for the folder currently in scope, kept live off the port's event
 * stream. One subscription serves every placement of the presence, because
 * there is only one conversation.
 */
export function useAgentTask() {
  const port = usePort();
  const { scopeFolderId, reload } = useShell();
  const settings = useComposerSettings();
  const [task, setTask] = useState<AgentTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const current = await port.agent.current(scopeFolderId);
      if (!cancelled) setTask(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [port, scopeFolderId]);

  useEffect(
    () =>
      port.agent.subscribe((event) => {
        if (event.kind !== "task") return;
        if (event.task.folderId !== scopeFolderId) return;
        setTask(event.task);
      }),
    [port, scopeFolderId],
  );

  const busy = task?.status === "working" || task?.status === "reading" || task?.status === "writing";

  const send = useCallback(
    async (submission: ComposerSubmission) => {
      await port.agent.send({
        ...submission,
        modelId: settings.value.selectedModelId,
        permission: settings.value.permission,
      });
    },
    [port, settings.value.selectedModelId, settings.value.permission],
  );

  const applySuggestion = useCallback(
    async (id: string) => {
      await port.agent.applySuggestion(id);
      // Applying marks the target file dirty, so the tab dot and status bar
      // have to be re-read from the port rather than guessed at.
      await reload();
    },
    [port, reload],
  );

  const undoSuggestion = useCallback(
    async (id: string) => {
      await port.agent.undoSuggestion(id);
      await reload();
    },
    [port, reload],
  );

  return {
    task,
    busy,
    send,
    applySuggestion,
    undoSuggestion,
    pause: useCallback(() => port.agent.pause(), [port]),
    resume: useCallback(() => port.agent.resume(), [port]),
    finish: useCallback(() => port.agent.finish(), [port]),
    stop: useCallback(() => port.agent.finish(), [port]),
  };
}

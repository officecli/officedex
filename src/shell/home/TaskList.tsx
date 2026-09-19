import { ArrowRight } from "lucide-react";

import { statusLabel } from "../agent/PresenceFace";
import { useAgentTask } from "../agent/useAgentTask";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";

/**
 * "Continue working": the way back into work already under way.
 *
 * Today this is one card for the folder in scope, which is all `AgentPort`
 * could answer. `AgentPort.list` now exists for the real thing — every
 * folder's recent runs, newest first — because a run started somewhere else is
 * still what the user was doing, and scoping this to the folder chip hides it
 * the moment they switch folders.
 */
export function TaskList() {
  const { folders, files } = useShell();
  const actions = useLibraryActions();
  const agent = useAgentTask();

  if (!agent.task) return null;

  return (
    <section className="shell-hero-resume" aria-label="Continue working">
      <h2>Continue working</h2>
      <button
        type="button"
        className="shell-resume-card"
        onClick={() => {
          const target = files.find((file) => file.folderId === agent.task?.folderId);
          if (target) void actions.openFile(target.id);
        }}
      >
        <span className="shell-resume-title">
          <strong>{agent.task.title}</strong>
          <small>
            {folders.find((folder) => folder.id === agent.task?.folderId)?.name} ·{" "}
            {statusLabel(agent.task.status)}
          </small>
        </span>
        <ArrowRight size={16} strokeWidth={1.7} aria-hidden="true" />
      </button>
    </section>
  );
}

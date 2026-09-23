import { ChevronRight, Folder, Image as ImageIcon } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { statusLabel } from "../agent/PresenceFace";
import { useAgentTasks } from "../agent/useAgentTasks";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";
import type { AgentStatus, AgentTaskSummary, FileMeta } from "../../shared/uiPort";
import { fileBaseName } from "../image/imageFormat";
import { useImageBlobUrl } from "../image/useImageBlobUrl";
import "./taskList.css";

/**
 * "Continue working": the way back into work already under way.
 *
 * A list, not a card. This used to read `AgentPort.current(scopeFolderId)` and
 * draw the single task belonging to the folder chip, which meant a run started
 * anywhere else disappeared from Home the moment the user changed folders —
 * the one screen whose entire job is to say what they were doing. `list` is
 * not scoped to anything for exactly that reason.
 *
 * Finished runs stay in the list. "What was I doing" is mostly a question
 * about work that already stopped, and a band that empties itself as runs
 * complete would be at its least useful right after the user got up from the
 * desk.
 */
export function TaskList() {
  const t = useT();
  const { folders, files, dispatch } = useShell();
  const actions = useLibraryActions();
  const { tasks } = useAgentTasks();

  // Nothing to continue is not an empty state worth drawing: a heading over a
  // blank strip reads as a load that failed. The band is simply absent until
  // there has been a run.
  if (tasks.length === 0) return null;

  /**
   * Where a row goes.
   *
   * A summary names the folder a run belongs to and no file — the contract
   * leaves the artifact out so that listing ten rows does not mean fetching
   * ten transcripts. So the destination is the folder's most recently opened
   * file, which is the closest thing available to "the document that run was
   * about", and opening it reveals and selects the folder on the way.
   *
   * A folder with no files still goes somewhere. Revealing and selecting it
   * leaves the user where the run is rather than leaving the click to vanish,
   * which is the one outcome this shell does not allow.
   */
  const openTask = (task: AgentTaskSummary) => {
    const target = files
      .filter((file) => file.folderId === task.folderId)
      .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))[0];
    if (target) {
      void actions.openFile(target.id);
      return;
    }
    dispatch({ type: "reveal-folder", folderId: task.folderId });
    dispatch({ type: "select-folder", folderId: task.folderId });
  };

  return (
    <section
      className="shell-hero-resume shell-task-list"
      aria-label={t("shell.taskList.continueWorking")}
    >
      <header className="shell-task-list-head">
        <h2>{t("shell.taskList.continueWorking")}</h2>
        {/* Says what the list is ordered by, which the rows themselves cannot.
            Not a control: there is nothing else it could be sorted by. */}
        <span className="shell-task-list-hint">{t("shell.taskList.hint")}</span>
      </header>
      <ul className="shell-task-rows">
        {tasks.map((task) => {
          const folder = folders.find((entry) => entry.id === task.folderId);
          if (task.image) {
            return (
              <li key={task.id}>
                <ImageTaskRow
                  task={task}
                  files={files}
                  onOpen={(fileId) => {
                    if (fileId) {
                      void actions.openFile(fileId);
                      return;
                    }
                    // Nothing has landed yet: the picture is still being made,
                    // and the place that shows that is the workspace beside the
                    // folder's task.
                    dispatch({ type: "reveal-folder", folderId: task.folderId });
                    dispatch({ type: "select-folder", folderId: task.folderId });
                    dispatch({ type: "enter-workspace" });
                  }}
                />
              </li>
            );
          }
          return (
            <li key={task.id}>
              <button
                type="button"
                className="shell-resume-card shell-task-row"
                onClick={() => openTask(task)}
              >
                <Folder
                  className="shell-task-row-icon"
                  size={16}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <span className="shell-resume-title">
                  <strong>{task.title}</strong>
                  {/* Where the run lives and what it is doing, in that order:
                      the folder is what tells two similarly-named runs apart,
                      and the phase is the part that keeps changing. A folder
                      the port no longer lists is skipped rather than printed
                      as a raw id. */}
                  <small>{[folder?.name, task.phase].filter(Boolean).join(" · ")}</small>
                </span>
                <span className="shell-task-row-status" data-state={dotState(task.status)}>
                  <span className="shell-task-row-dot" aria-hidden="true" />
                  {statusLabel(task.status)}
                </span>
                <ChevronRight
                  className="shell-task-row-chevron"
                  size={16}
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A picture's row: the latest version as the thumbnail, the picture's name,
 * how many versions it has, and "Ready" once nothing is still being drawn.
 *
 * Named after the picture rather than the task. The task's title is the last
 * instruction — "Make the light warmer" — which says what was asked, not what
 * there is to come back to; the file name is what the picture is called
 * everywhere else, in the sidebar and on its tab.
 */
function ImageTaskRow({
  task,
  files,
  onOpen,
}: {
  task: AgentTaskSummary;
  files: FileMeta[];
  onOpen: (fileId: string | null) => void;
}) {
  const runs = task.image?.runs ?? [];
  const versions = runs
    .filter((run) => run.status === "done")
    .map((run) => files.find((file) => file.artifactTaskId === run.taskId))
    .filter((file): file is FileMeta => Boolean(file));
  const latest = versions.at(-1) ?? null;
  const thumbnail = useImageBlobUrl(latest?.id ?? null);
  const busy = runs.some((run) => run.status === "running");
  const name = versions[0] ? fileBaseName(versions[0].name) : task.title;
  const count = versions.length;
  const detail = busy
    ? "Image · Creating image"
    : count > 0
      ? `Image · ${count} version${count === 1 ? "" : "s"}`
      : `Image · ${task.phase || "No picture yet"}`;

  return (
    <button
      type="button"
      className="shell-resume-card shell-task-row shell-task-row--image"
      onClick={() => onOpen(latest?.id ?? null)}
    >
      <span className="shell-task-row-thumb" aria-hidden="true">
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <ImageIcon size={16} strokeWidth={1.7} />}
      </span>
      <span className="shell-resume-title">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      {busy || count === 0 ? (
        <span className="shell-task-row-status" data-state={dotState(task.status)}>
          <span className="shell-task-row-dot" aria-hidden="true" />
          {statusLabel(task.status)}
        </span>
      ) : (
        <span className="shell-task-row-ready">Ready</span>
      )}
      <ChevronRight className="shell-task-row-chevron" size={16} strokeWidth={1.7} aria-hidden="true" />
    </button>
  );
}

/**
 * The three things the dot has to say.
 *
 * Seven statuses, three marks. The label beside the dot already names the
 * state exactly ("Agent waiting for review"), so the dot only has to carry the
 * part a reader takes in without reading — whether this row is still moving,
 * waiting on them, or done. Giving each status its own colour would invent a
 * status palette the rest of this shell does not have, and would make the
 * difference between "reading" and "writing" louder on Home than it is inside
 * the task panel.
 */
function dotState(status: AgentStatus): "live" | "waiting" | "still" {
  if (status === "working" || status === "reading" || status === "writing") return "live";
  if (status === "awaiting-review" || status === "paused") return "waiting";
  return "still";
}

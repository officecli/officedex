import { ArrowRight, ChevronDown, Folder as FolderIcon } from "lucide-react";

import { Composer } from "../composer/Composer";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { useAgentTask } from "../agent/useAgentTask";
import { statusLabel } from "../agent/PresenceFace";
import { FileTree } from "../nav/FileTree";
import { useFolderDrop } from "../nav/useFolderDrop";
import { useLibraryActions } from "../nav/useLibraryActions";
import type { FileType } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { Menu } from "../chrome/Menu";
import "./home.css";

const PROMPTS: Array<{ type: FileType; label: string; prompt: string }> = [
  { type: "doc", label: "Write a document", prompt: "Draft a product launch plan from the files in this folder." },
  { type: "sheet", label: "Analyse a workbook", prompt: "Check the sales forecast: revenue, cost and gross profit." },
  { type: "slides", label: "Build a presentation", prompt: "Prepare a launch presentation from the plan and the forecast." },
];

/**
 * Agent mode's Home: state a goal, then pick what to work on.
 *
 * The hero carries the same `Composer` as the docked column and the floating
 * panel — including the scope chip that replaced the prototype's separate
 * folder dropdown (decision 2).
 */
export function AgentHome() {
  const { state, dispatch, folders, files, scopeFolderId } = useShell();
  const actions = useLibraryActions();
  const agent = useAgentTask();
  const { overFolderId, dropHandlers } = useFolderDrop(actions.moveFile);
  const scope = folders.find((folder) => folder.id === scopeFolderId);

  return (
    <div className="shell-home shell-region shell-home--agent">
      <div className="shell-hero">
        <h1>What would you like to get done?</h1>
        <p className="shell-hero-lede">
          Bring your files and a goal. Jump in and edit at any time.
        </p>

        <div className="shell-hero-composer">
          <Menu
            label="Task folder"
            width={260}
            items={folders.map((folder) => ({
              id: folder.id,
              label: folder.name,
              description: folder.path,
              checked: folder.id === scopeFolderId,
              onSelect: () => dispatch({ type: "select-folder", folderId: folder.id }),
            }))}
          >
            {(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className="shell-home-scope"
                title={`Task folder: ${scope?.name ?? "none"}`}
              >
                <FolderIcon size={15} strokeWidth={1.7} aria-hidden="true" />
                <span>{scope?.name ?? "Choose a folder"}</span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </Menu>
          <Composer
            placement="home"
            busy={agent.busy}
            onSend={async (submission) => {
              await agent.send(submission);
              // A new task means work, and work happens in the workspace: leave
              // Home for the file the task is about, or — when it is making
              // something that does not exist yet — for the canvas the run
              // itself fills. Staying on Home after asking for something leaves
              // the user watching a list while the thing they asked for is
              // being drawn behind it.
              const target =
                files.find((file) => file.id === submission.activeFileId) ??
                files.find((file) => file.folderId === submission.folderId);
              if (target) await actions.openFile(target.id);
              else dispatch({ type: "enter-workspace" });
            }}
            onStop={agent.stop}
          />
        </div>

        <div className="shell-hero-prompts">
          {PROMPTS.map((entry) => (
            <button
              key={entry.type}
              type="button"
              className="shell-hero-prompt"
              onClick={async () => {
                await agent.send({
                  text: entry.prompt,
                  folderId: scopeFolderId,
                  mentions: [],
                  attachments: [],
                  activeFileId: state.activeFileId,
                });
                const target =
                  files.find((file) => file.type === entry.type && file.folderId === scopeFolderId) ??
                  files.find((file) => file.folderId === scopeFolderId);
                if (target) await actions.openFile(target.id);
                else dispatch({ type: "enter-workspace" });
              }}
            >
              <FileTypeIcon type={entry.type} size={15} />
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {agent.task ? (
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
      ) : null}

      <section className="shell-home-list" aria-label="Files" {...dropHandlers}>
        <h2 className="shell-home-subhead">
          {scope ? `Files in ${scope.name}` : "Your files"}
        </h2>
        <FileTree
          density="comfortable"
          grouping="folder"
          folders={folders}
          files={files}
          activeFileId={state.activeFileId}
          selectedFolderId={state.selectedFolderId}
          expandedFolderIds={state.expandedFolderIds}
          revealedFolderIds={state.revealedFolderIds}
          dropFolderId={overFolderId}
          onOpenFile={(fileId) => void actions.openFile(fileId)}
          onToggleFolder={(folderId) => dispatch({ type: "toggle-folder", folderId })}
          onToggleOverflow={(folderId) => dispatch({ type: "toggle-folder-overflow", folderId })}
          onSelectFolder={(folderId) => dispatch({ type: "select-folder", folderId })}
          onCreateFile={(folderId, type) => void actions.createFile(folderId, type)}
          onMoveFile={(fileId, folderId) => void actions.moveFile(fileId, folderId)}
          onTogglePinned={(fileId, pinned) => void actions.setPinned(fileId, pinned)}
        />
      </section>
    </div>
  );
}

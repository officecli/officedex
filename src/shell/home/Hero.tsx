import { useCallback, useRef } from "react";
import { ChevronDown, Folder as FolderIcon } from "lucide-react";

import { Composer } from "../composer/Composer";
import { Menu } from "../chrome/Menu";
import { QuickPrompts } from "./QuickPrompts";
import { useAgentTask } from "../agent/useAgentTask";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";

/**
 * Agent Home's top half: the question, the composer, the starting points.
 *
 * The hero carries the same `Composer` as the docked column and the floating
 * panel — including the scope chip that replaced the prototype's separate
 * folder dropdown (decision 2).
 */
export function Hero() {
  const { dispatch, folders, files, scopeFolderId } = useShell();
  const actions = useLibraryActions();
  const agent = useAgentTask();
  const scope = folders.find((folder) => folder.id === scopeFolderId);

  // Handed to us by the composer on mount; the quick prompts type through it.
  const fill = useRef<((text: string) => void) | null>(null);
  const registerFill = useCallback((next: (text: string) => void) => {
    fill.current = next;
  }, []);

  return (
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
          onRegisterFill={registerFill}
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

      <QuickPrompts onPick={(prompt) => fill.current?.(prompt)} />
    </div>
  );
}

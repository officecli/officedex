import { useCallback } from "react";

import { useT } from "../../renderer/i18n";
import { openConfirmDialog, openNameDialog } from "../kit/dialogs";
import { notice, openMenu, openModal } from "../kit/layers";
import { usePort } from "../port/PortContext";
import { attempt } from "../port/reportPortFailure";
import { activeProject, useShell, type Chat, type Project } from "../state/ShellContext";
import type { AgentStatus } from "../../shared/uiPort";
import { useChatEntry } from "./useChatEntry";

/**
 * The project and conversation menus, and the dialogs behind them.
 *
 * Short verbs, because the row already says what they act on (§18 r7): New
 * Chat / Rename / Archive / Delete for a project, Rename / Move / Pin /
 * Archive / Delete for a conversation. The confirmation keeps the object and
 * the consequence in full — a short menu label is not a licence to make the
 * dialog vague.
 *
 * Archive and Delete are both recoverable, from Projects & conversations.
 * Neither touches a file.
 */
/** What Delete stops: a run under way, or one held paused. Review waits on the user and stays. */
const STOPPABLE = new Set<AgentStatus>(["reading", "writing", "working", "paused"]);

export function useWorkspaceMenus() {
  const t = useT();
  const port = usePort();
  const { state, dispatch, chats, projects, defaultFolderId, reload, setChatMeta, setProjectMeta } = useShell();

  const entry = useChatEntry();

  /*
   * A project needs only its name (1.0.12 §一). Once it exists, Home's composer
   * is focused with the project chosen — no empty three columns, no Assets.
   */
  const newProject = useCallback(() => {
    openNameDialog({
      title: t("dx.project.new"),
      label: t("dx.project.nameLabel"),
      action: t("dx.action.create"),
      form: "new-project",
      onSubmit: async (name) => {
        if (projects.some((project) => project.name === name && !project.deleted)) {
          return t("dx.project.nameTaken");
        }
        const folder = await port.folders.create(name);
        await reload();
        entry.startChat(folder.id);
      },
    });
  }, [t, port, projects, reload, entry]);

  /*
   * A chat is not named up front any more (1.0.12 §一, §四): New chat puts
   * Home's composer on a draft chat in the project, and the first accepted
   * message names it. The draft has an id from the start and a row in the
   * tree, so it survives Home, another project and a relaunch, and its first
   * message is sent under the same id. Rename stays in the chat's menu.
   */
  const newChat = useCallback((folderId: string) => entry.startChat(folderId), [entry]);

  const leaveChatIfOpen = useCallback(
    (matches: (chat: { folderId: string; conversationId: string | null }) => boolean) => {
      if (state.chat && matches(state.chat)) dispatch({ type: "go", page: "projects" });
    },
    [state.chat, dispatch],
  );

  /*
   * Deleting stops what is running, waiting or paused in the conversations it
   * takes away (1.0.12 §五); archiving only hides them and leaves runs going.
   * Restoring brings the rows back and never starts anything again.
   */
  const stopRuns = useCallback(
    async (affected: readonly Chat[]) => {
      for (const chat of affected) {
        if (STOPPABLE.has(chat.summary.status)) await attempt(() => port.agent.finish(chat.summary.id));
      }
    },
    [port],
  );

  const renameProject = useCallback(
    (project: Project) =>
      openNameDialog({
        title: t("dx.menu.rename"),
        label: t("dx.project.nameLabel"),
        initial: project.name,
        action: t("dx.menu.rename"),
        form: "rename-project",
        onSubmit: async (name) => {
          if (projects.some((other) => other.id !== project.id && other.name === name && !other.deleted)) {
            return t("dx.project.nameTaken");
          }
          await port.folders.rename(project.id, name);
          await reload();
        },
      }),
    [t, port, projects, reload],
  );

  const restoreProject = useCallback(
    (project: Project) => {
      setProjectMeta(project.id, { archived: false, deleted: false, deletedAt: undefined });
      dispatch({ type: "reveal-folder", folderId: project.id });
      notice(t("dx.project.restored"));
    },
    [t, setProjectMeta, dispatch],
  );

  const deleteProject = useCallback(
    (project: Project) => {
      const affected = chats.filter((chat) => chat.folderId === project.id && !chat.deleted);
      const running = affected.filter((chat) => STOPPABLE.has(chat.summary.status)).length;
      openConfirmDialog({
        title: t("dx.project.deleteTitle"),
        body: (
          <>
            <p>{t("dx.project.deleteBody", { name: project.name, count: affected.length })}</p>
            <p>{t(running ? "dx.delete.stopsTasks" : "dx.delete.keepsFiles", { count: running })}</p>
          </>
        ),
        action: t("dx.menu.delete"),
        onConfirm: async () => {
          await stopRuns(affected);
          setProjectMeta(project.id, { deleted: true, deletedAt: Date.now() });
          leaveChatIfOpen((chat) => chat.folderId === project.id);
          notice(t("dx.project.deleted"));
        },
      });
    },
    [t, chats, stopRuns, setProjectMeta, leaveChatIfOpen],
  );

  const projectMenu = useCallback(
    (project: Project, anchor: HTMLElement) => {
      if (project.deleted) {
        openMenu(anchor, [{ label: t("dx.menu.restore"), onSelect: () => restoreProject(project) }]);
        return;
      }
      openMenu(anchor, [
        ...(project.archived
          ? [{ label: t("dx.menu.restore"), onSelect: () => restoreProject(project) }]
          : [{ label: t("dx.menu.newChat"), onSelect: () => newChat(project.id) }]),
        { label: t("dx.menu.rename"), onSelect: () => renameProject(project) },
        "-",
        ...(project.archived
          ? []
          : [
              {
                label: t("dx.menu.archive"),
                onSelect: () => {
                  setProjectMeta(project.id, { archived: true });
                  leaveChatIfOpen((chat) => chat.folderId === project.id);
                  notice(t("dx.project.archived"));
                },
              },
            ]),
        { label: t("dx.menu.delete"), onSelect: () => deleteProject(project) },
      ]);
    },
    [t, newChat, renameProject, restoreProject, deleteProject, setProjectMeta, leaveChatIfOpen],
  );

  const restoreChat = useCallback(
    (chat: Chat) => {
      const project = projects.find((entry) => entry.id === chat.folderId);
      if (project && !activeProject(project)) {
        notice(t("dx.chat.restoreProjectFirst"));
        return;
      }
      setChatMeta(chat.id, { archived: false, deleted: false, deletedAt: undefined });
      if (project) dispatch({ type: "reveal-folder", folderId: project.id });
      notice(t("dx.chat.restored"));
    },
    [t, projects, setChatMeta, dispatch],
  );

  const chatMenu = useCallback(
    (chat: Chat, anchor: HTMLElement) => {
      const isOpen = (ref: { conversationId: string | null }) => ref.conversationId === chat.id;
      const rename = {
        label: t("dx.menu.rename"),
        onSelect: () =>
          openNameDialog({
            title: t("dx.menu.rename"),
            label: t("dx.chat.nameLabel"),
            initial: chat.name,
            action: t("dx.menu.rename"),
            onSubmit: (name) => setChatMeta(chat.id, { name }),
          }),
      };
      const remove = {
        label: t("dx.menu.delete"),
        onSelect: () => {
          const running = STOPPABLE.has(chat.summary.status) ? 1 : 0;
          openConfirmDialog({
            title: t("dx.chat.deleteTitle"),
            body: (
              <>
                <p>{t("dx.chat.deleteBody", { name: chat.name })}</p>
                <p>{t(running ? "dx.delete.stopsTasks" : "dx.delete.keepsFiles", { count: running })}</p>
              </>
            ),
            action: t("dx.menu.delete"),
            onConfirm: async () => {
              await stopRuns([chat]);
              setChatMeta(chat.id, { deleted: true, deletedAt: Date.now() });
              leaveChatIfOpen(isOpen);
              notice(t("dx.chat.deleted"));
            },
          });
        },
      };
      if (chat.deleted) {
        openMenu(anchor, [{ label: t("dx.menu.restore"), onSelect: () => restoreChat(chat) }]);
        return;
      }
      if (chat.archived) {
        openMenu(anchor, [{ label: t("dx.menu.restore"), onSelect: () => restoreChat(chat) }, rename, "-", remove]);
        return;
      }
      openMenu(anchor, [
        rename,
        {
          label: t("dx.menu.move"),
          onSelect: () => openModal({ title: t("dx.menu.move"), render: (close) => <div className="dx-actions">
            {[{ id: defaultFolderId, name: t("dx.file.noProject") }, ...projects.filter(activeProject)].filter((project) => project.id !== chat.folderId).map((project) => <button key={project.id} type="button" className="dx-btn" onClick={() => void attempt(async () => {
              if (!port.agent.moveConversation) throw new Error("Moving chats requires the desktop app.");
              await port.agent.moveConversation(chat.id, project.id);
              setChatMeta(chat.id, { folderId: project.id });
              await reload(); close();
              dispatch({ type: "open-chat", chat: { folderId: project.id, conversationId: chat.id } });
            })}>{project.name}</button>)}
          </div> }),
        },
        {
          label: t(chat.pinned ? "dx.menu.unpin" : "dx.menu.pin"),
          onSelect: () => setChatMeta(chat.id, { pinned: !chat.pinned }),
        },
        "-",
        {
          label: t("dx.menu.archive"),
          onSelect: () => {
            setChatMeta(chat.id, { archived: true });
            leaveChatIfOpen(isOpen);
            notice(t("dx.chat.archived"));
          },
        },
        remove,
      ]);
    },
    [t, setChatMeta, leaveChatIfOpen, stopRuns, restoreChat, dispatch, defaultFolderId, projects, port, reload],
  );

  return { newProject, newChat, projectMenu, chatMenu, restoreProject, restoreChat, chats };
}

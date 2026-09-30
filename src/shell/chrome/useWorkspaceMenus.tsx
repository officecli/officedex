import { useCallback } from "react";

import { useT } from "../../renderer/i18n";
import { openConfirmDialog, openNameDialog } from "../kit/dialogs";
import { openMenu } from "../kit/layers";
import { usePort } from "../port/PortContext";
import { notBuiltYet } from "../port/reportPortFailure";
import { useShell, type Chat, type Project } from "../state/ShellContext";

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
export function useWorkspaceMenus() {
  const t = useT();
  const port = usePort();
  const { state, dispatch, chats, projects, reload, setChatMeta, setProjectMeta } = useShell();

  const newProject = useCallback(() => {
    openNameDialog({
      title: t("dx.project.new"),
      label: t("dx.project.nameLabel"),
      action: t("dx.action.create"),
      onSubmit: async (name) => {
        if (projects.some((project) => project.name === name && !project.archived)) {
          return t("dx.project.nameTaken");
        }
        const folder = await port.folders.create(name);
        await reload();
        dispatch({ type: "reveal-folder", folderId: folder.id });
      },
    });
  }, [t, port, projects, reload, dispatch]);

  const newChat = useCallback(
    (folderId: string) => {
      openNameDialog({
        title: t("dx.chat.new"),
        label: t("dx.chat.nameLabel"),
        action: t("dx.action.create"),
        onSubmit: async (name) => {
          await port.agent.startConversation(folderId);
          dispatch({ type: "open-chat", chat: { folderId, conversationId: null }, name });
        },
      });
    },
    [t, port, dispatch],
  );

  const leaveChatIfOpen = useCallback(
    (matches: (chat: { folderId: string; conversationId: string | null }) => boolean) => {
      if (state.chat && matches(state.chat)) dispatch({ type: "go", page: "projects" });
    },
    [state.chat, dispatch],
  );

  const projectMenu = useCallback(
    (project: Project, anchor: HTMLElement) => {
      openMenu(anchor, [
        { label: t("dx.menu.newChat"), onSelect: () => newChat(project.id) },
        {
          label: t("dx.menu.rename"),
          onSelect: () =>
            openNameDialog({
              title: t("dx.menu.rename"),
              label: t("dx.project.nameLabel"),
              initial: project.name,
              action: t("dx.menu.rename"),
              onSubmit: async (name) => {
                await port.folders.rename(project.id, name);
                await reload();
              },
            }),
        },
        project.archived
          ? { label: t("dx.menu.restore"), onSelect: () => setProjectMeta(project.id, { archived: false }) }
          : {
              label: t("dx.menu.archive"),
              onSelect: () => {
                setProjectMeta(project.id, { archived: true });
                leaveChatIfOpen((chat) => chat.folderId === project.id);
                dispatch({ type: "go", page: "projects" });
              },
            },
        {
          label: t("dx.menu.delete"),
          onSelect: () =>
            openConfirmDialog({
              title: t("dx.project.deleteTitle"),
              body: <p>{t("dx.project.deleteBody")}</p>,
              action: t("dx.menu.delete"),
              onConfirm: () => {
                setProjectMeta(project.id, { archived: true });
                leaveChatIfOpen((chat) => chat.folderId === project.id);
              },
            }),
        },
      ]);
    },
    [t, port, reload, newChat, setProjectMeta, leaveChatIfOpen, dispatch],
  );

  const chatMenu = useCallback(
    (chat: Chat, anchor: HTMLElement) => {
      const isOpen = (ref: { conversationId: string | null }) => ref.conversationId === chat.id;
      openMenu(anchor, [
        {
          label: t("dx.menu.rename"),
          onSelect: () =>
            openNameDialog({
              title: t("dx.menu.rename"),
              label: t("dx.chat.nameLabel"),
              initial: chat.name,
              action: t("dx.menu.rename"),
              onSubmit: (name) => setChatMeta(chat.id, { name }),
            }),
        },
        {
          label: t("dx.menu.move"),
          onSelect: () => notBuiltYet("chat.move", t("dx.chat.moveNotBuilt")),
        },
        {
          label: t(chat.pinned ? "dx.menu.unpin" : "dx.menu.pin"),
          onSelect: () => setChatMeta(chat.id, { pinned: !chat.pinned }),
        },
        {
          label: t("dx.menu.archive"),
          onSelect: () => {
            setChatMeta(chat.id, { archived: true });
            leaveChatIfOpen(isOpen);
            dispatch({ type: "go", page: "projects" });
          },
        },
        {
          label: t("dx.menu.delete"),
          onSelect: () =>
            openConfirmDialog({
              title: t("dx.chat.deleteTitle"),
              body: <p>{t("dx.chat.deleteBody")}</p>,
              action: t("dx.menu.delete"),
              onConfirm: () => {
                setChatMeta(chat.id, { archived: true });
                if (state.chat && isOpen(state.chat)) dispatch({ type: "go", page: "projects" });
              },
            }),
        },
      ]);
    },
    [t, setChatMeta, leaveChatIfOpen, dispatch, state.chat],
  );

  /** A blank conversation that belongs to no project, from New → AI Chat. */
  const startUnfiledChat = useCallback(
    async (defaultFolderId: string) => {
      await port.agent.startConversation(defaultFolderId);
      dispatch({ type: "open-chat", chat: { folderId: defaultFolderId, conversationId: null } });
    },
    [port, dispatch],
  );

  return { newProject, newChat, projectMenu, chatMenu, startUnfiledChat, chats };
}

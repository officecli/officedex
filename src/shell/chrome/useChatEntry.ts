import { useCallback } from "react";

import type { AgentTask, FileMeta } from "../../shared/uiPort";
import { hasComposerDraft } from "../composer/Composer";
import { usePort } from "../port/PortContext";
import { attempt } from "../port/reportPortFailure";
import { translate } from "../../renderer/i18n";
import { notice } from "../kit/layers";
import { activeProject, usableChat, useShell, type Chat } from "../state/ShellContext";
import { newConversationId } from "../state/libraryMeta";

/** Home's composer, once Home is on screen. */
export function focusHomeComposer(): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(".dx-home-composer [data-draft]")?.focus({ preventScroll: true }),
  );
}

/**
 * The three entry rules of the 1.0.12 handoff (§一), in one place so the
 * sidebar, the project menu, the Projects page and Home's project picker agree.
 *
 *  - **Start a chat** (`startChat`): a project's New chat, a new project, the
 *    picker. Home's composer, bound to that project; nothing opens beside it.
 *    An untouched draft chat in the same project is reused, so pressing New
 *    chat twice does not stack empty chats — but one the user has typed into,
 *    added a reference to or named is never taken over. `null` is the global
 *    New chat: Home's own draft, in no project.
 *  - **Open a chat** (`openChat`): one that has not been started goes back to
 *    Home with its words and references; one with history opens its
 *    conversation beside the file it last showed — or its newest usable result,
 *    or an empty editor region. Never Assets by default, never another chat's
 *    or Local's file, and nothing is re-run.
 *  - **Resume a project's draft** (`resumeProjectDraft`): the picker switching
 *    projects picks up that project's unsent draft rather than carrying the
 *    current message across.
 */
export function useChatEntry() {
  const port = usePort();
  const { dispatch, chats, chatMeta, files, projects, defaultFolderId, setChatMeta } = useShell();

  const draftsIn = useCallback(
    (folderId: string) =>
      chats.filter((chat) => chat.folderId === folderId && !chat.started && chat.draft && !chat.archived && !chat.deleted),
    [chats],
  );

  const bind = useCallback(
    (folderId: string, conversationId: string) => {
      dispatch({ type: "open-home-draft", chat: { folderId, conversationId } });
      focusHomeComposer();
    },
    [dispatch],
  );

  const startChat = useCallback(
    (folderId: string | null) => {
      if (folderId === null || folderId === defaultFolderId) {
        dispatch({ type: "open-home-draft", chat: null });
        focusHomeComposer();
        return;
      }
      // A project just created is not in this render's list yet; only a known
      // archived or deleted one is refused.
      const project = projects.find((entry) => entry.id === folderId);
      if (project && !activeProject(project)) {
        notice(translate("dx.chat.restoreProjectFirst"));
        return;
      }
      const untouched = draftsIn(folderId).find(
        (chat) => !chatMeta[chat.id]?.name && !hasComposerDraft("home", chat.id),
      );
      if (untouched) {
        bind(folderId, untouched.id);
        return;
      }
      const conversationId = newConversationId();
      setChatMeta(conversationId, { folderId, createdAt: Date.now(), draft: true });
      bind(folderId, conversationId);
    },
    [defaultFolderId, projects, draftsIn, chatMeta, setChatMeta, bind, dispatch],
  );

  const resumeProjectDraft = useCallback(
    (folderId: string | null) => {
      if (folderId === null || folderId === defaultFolderId) {
        startChat(null);
        return;
      }
      const latest = draftsIn(folderId)[0];
      if (latest) bind(folderId, latest.id);
      else startChat(folderId);
    },
    [defaultFolderId, draftsIn, bind, startChat],
  );

  const openChat = useCallback(
    async (chat: Chat) => {
      // Archived or deleted, or in a project that is: restore it first (§五).
      if (!usableChat(chat, projects, defaultFolderId)) {
        notice(translate("dx.chat.openRestoreFirst"));
        return;
      }
      if (!chat.started) {
        bind(chat.folderId, chat.id);
        return;
      }
      let task: AgentTask | null = null;
      // The port shows one conversation per folder; say which before showing it.
      const ok = await attempt(async () => {
        task = await port.agent.openConversation(chat.folderId, chat.id);
      });
      if (!ok) return;
      const fileId = resumeFileFor(chat.id, chatMeta[chat.id]?.workspace?.fileId, task, files);
      dispatch({ type: "resume-chat", chat: { folderId: chat.folderId, conversationId: chat.id }, fileId });
    },
    [port, chatMeta, files, projects, defaultFolderId, bind, dispatch],
  );

  return { startChat, resumeProjectDraft, openChat };
}

/**
 * The file a conversation comes back to: the one it last showed, if it can
 * still be opened; otherwise the newest file this conversation's own runs made
 * or worked on, or that came from it; otherwise none. Never a file from another
 * conversation or from Local.
 */
export function resumeFileFor(
  conversationId: string,
  remembered: string | undefined,
  task: AgentTask | null,
  files: readonly FileMeta[],
): string | null {
  const usable = (id: string | undefined) => {
    const file = id ? files.find((entry) => entry.id === id) : undefined;
    return file && !file.failure ? file.id : null;
  };
  const first = usable(remembered);
  if (first) return first;
  const runs = task ? [task, ...[...(task.history ?? [])].reverse()] : [];
  for (const run of runs) {
    const made = files.find((file) => file.artifactTaskId === run.id && !file.failure);
    if (made) return made.id;
    const worked = usable(run.suggestion?.targetFileId) ?? usable(run.inputFile?.fileId);
    if (worked) return worked;
  }
  const fromHere = files
    .filter((file) => file.originConversationId === conversationId && !file.failure)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return fromHere?.id ?? null;
}

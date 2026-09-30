import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { usePort } from "../port/PortContext";
import { logShellEvent } from "../port/shellLog";
import type { AgentTaskSummary, FileMeta, Folder } from "../../shared/uiPort";
import { bootPersisted, writePersisted, type PersistedShellState } from "./persist";
import {
  patchChatMeta,
  patchProjectMeta,
  readLibraryMeta,
  writeLibraryMeta,
  type ChatMeta,
  type LibraryMeta,
  type ProjectMeta,
} from "./libraryMeta";
import {
  hydrateShellState,
  sameChat,
  shellReducer,
  toPersisted,
  type ChatRef,
  type ShellAction,
  type ShellState,
} from "./shellReducer";

/**
 * A conversation, as the sidebar and the chat header show it.
 *
 * Built from the port's per-conversation summary with the user's own naming,
 * pinning and archiving laid over it — see `libraryMeta.ts`.
 */
export interface Chat {
  /** The conversation id. Stable as runs are added. */
  id: string;
  folderId: string;
  name: string;
  pinned: boolean;
  archived: boolean;
  /** A run in this conversation is under way. */
  running: boolean;
  summary: AgentTaskSummary;
}

/** A project is a folder that is not the default one (WORKSPACE-STANDARD §01). */
export interface Project {
  id: string;
  name: string;
  archived: boolean;
  folder: Folder;
}

interface ShellContextValue {
  state: ShellState;
  dispatch: (action: ShellAction) => void;
  folders: Folder[];
  files: FileMeta[];
  /** Every project, archived ones included; the sidebar filters. */
  projects: Project[];
  /** Every conversation the port knows of, pinned first, then most recent. */
  chats: Chat[];
  /** The conversation in the second column, when it has been spoken in. */
  currentChat: Chat | null;
  /** The file the canvas is showing, or null when the page is not a document. */
  activeFile: FileMeta | null;
  /** Where unfiled conversations and Local files live. */
  defaultFolderId: string;
  /** The folder a message or a new file lands in. Never empty once loaded. */
  scopeFolderId: string;
  loaded: boolean;
  reload: () => Promise<void>;
  reloadChats: () => Promise<void>;
  setChatMeta: (id: string, patch: ChatMeta) => void;
  setProjectMeta: (id: string, patch: ProjectMeta) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

const RUNNING = new Set<AgentTaskSummary["status"]>(["working", "reading", "writing"]);
/** Enough rows that a project's tree is its conversations, not its latest eight. */
const CHAT_LIMIT = 200;

/**
 * `stateOverride` is merged over the persisted view state at boot. Only the dev
 * fixture passes it (see `dev/fixture.ts`), so a URL can put the shell straight
 * into one of the combinations the audit walks.
 */
export function ShellProvider({
  children,
  stateOverride,
  persist = true,
}: {
  children: ReactNode;
  stateOverride?: Partial<PersistedShellState>;
  /**
   * Off under the dev fixture. Every audit run must start from its URL, not
   * from what the previous run left in localStorage — and a fixture's file ids
   * have no meaning in the real workspace.
   */
  persist?: boolean;
}) {
  const port = usePort();
  const [state, dispatch] = useReducer(shellReducer, undefined, () =>
    hydrateShellState(bootPersisted(stateOverride)),
  );
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [summaries, setSummaries] = useState<AgentTaskSummary[]>([]);
  const [meta, setMeta] = useState<LibraryMeta>(() => (persist ? readLibraryMeta() : { chats: {}, projects: {} }));
  const [loaded, setLoaded] = useState(false);
  /** Read inside the agent subscription, which must not resubscribe on every navigation. */
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    const [nextFolders, nextFiles] = await Promise.all([port.folders.list(), port.files.list()]);
    setFolders(nextFolders);
    setFiles(nextFiles);
    dispatch({ type: "prune-files", files: nextFiles });
    return { folders: nextFolders, files: nextFiles };
  }, [port]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const reloadChats = useCallback(async () => {
    try {
      setSummaries(await port.agent.list({ limit: CHAT_LIMIT }));
    } catch {
      // The tree keeps what it had; a failed refresh is not an empty workspace.
    }
  }, [port]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([reload(), reloadChats()]);
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, reloadChats]);

  useEffect(() => {
    let cancelled = false;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = port.agent.subscribe((event) => {
      if (event.kind !== "task") return;
      const { task } = event;

      // The tree's rows are per conversation; any run moving changes one of them.
      clearTimeout(refresh);
      refresh = setTimeout(() => void reloadChats(), 120);

      // A chat that had not been spoken in now has a name to go by.
      if (task.conversationId && event.focused !== false) {
        const { chat, pendingChatName } = stateRef.current;
        if (chat && chat.conversationId === null && chat.folderId === task.folderId && pendingChatName) {
          const id = task.conversationId;
          setMeta((current) => patchChatMeta(current, id, { name: pendingChatName }));
        }
        dispatch({ type: "adopt-conversation", folderId: task.folderId, conversationId: task.conversationId });
      }

      // Apply writes the source file on disk. Reopen that source in the real
      // editor so its in-memory session cannot keep showing the pre-Apply bytes.
      if (task.suggestion?.applied) {
        const sourceId = task.suggestion.targetFileId;
        void (async () => {
          try {
            const opened = await port.files.open(sourceId);
            if (cancelled) return;
            dispatch({ type: "open-file", fileId: opened.id });
            await reload();
          } catch {
            // The Apply call already reported its failure.
          }
        })();
        return;
      }
      if (task.status !== "done") return;
      const taskId = task.id;
      const origin: ChatRef | null = task.conversationId
        ? { folderId: task.folderId, conversationId: task.conversationId }
        : null;

      // The event is emitted before the writer finishes recording the artifact.
      // Retry briefly instead of leaving a finished result invisible.
      const delays = [0, 120, 400];
      void (async () => {
        for (const delay of delays) {
          if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (cancelled) return;
          const next = await load();
          const artifact = next.files.find((file) => file.artifactTaskId === taskId);
          if (!artifact) continue;
          /*
           * A finished run does not take the screen (§10): its result becomes a
           * tab with the unread dot, and the user opens it when they choose to.
           *
           * The one exception is a user who is already watching it being made —
           * the run's stage is what the content region shows. The stage goes
           * away when the run ends, and what replaces it is the document the
           * stage was drawing, not a blank region with a dot somewhere else.
           */
          const current = stateRef.current;
          const watching = current.page === "editor" && current.stage && sameChat(current.chat, origin);
          try {
            if (watching) {
              const opened = await port.files.open(artifact.id);
              if (cancelled) return;
              dispatch({ type: "open-file", fileId: opened.id });
              await reload();
            } else {
              dispatch({ type: "add-tab", fileId: artifact.id, chat: origin, unread: true });
            }
          } catch {
            // A transient open failure must not turn a successful generation
            // into a shell error; the result stays in the refreshed library.
          }
          return;
        }
        logShellEvent("agent.artifact-not-found", { taskId, files: (await load()).files.length });
      })();
    });
    return () => {
      cancelled = true;
      clearTimeout(refresh);
      unsubscribe();
    };
  }, [load, reload, reloadChats, port]);

  useEffect(() => {
    // Only persist once the workspace is known, so a slow first load cannot
    // write an empty tab list over a good one.
    if (persist && loaded) writePersisted(toPersisted(state));
  }, [state, loaded, persist]);

  useEffect(() => {
    if (persist) writeLibraryMeta(meta);
  }, [meta, persist]);

  const setChatMeta = useCallback((id: string, patch: ChatMeta) => {
    setMeta((current) => patchChatMeta(current, id, patch));
  }, []);
  const setProjectMeta = useCallback((id: string, patch: ProjectMeta) => {
    setMeta((current) => patchProjectMeta(current, id, patch));
  }, []);

  const defaultFolderId = useMemo(
    () => folders.find((folder) => folder.isDefault)?.id ?? folders[0]?.id ?? "",
    [folders],
  );

  const projects = useMemo<Project[]>(
    () =>
      folders
        .filter((folder) => !folder.isDefault)
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          archived: meta.projects[folder.id]?.archived === true,
          folder,
        })),
    [folders, meta.projects],
  );

  const chats = useMemo<Chat[]>(() => {
    const rows = summaries.map((summary): Chat => {
      const id = summary.conversationId ?? summary.id;
      const own = meta.chats[id];
      return {
        id,
        folderId: summary.folderId,
        name: own?.name?.trim() || summary.title,
        pinned: own?.pinned === true,
        archived: own?.archived === true,
        running: RUNNING.has(summary.status),
        summary,
      };
    });
    // Stable: the port's order is most recent first, and pinning only lifts.
    return [...rows.filter((chat) => chat.pinned), ...rows.filter((chat) => !chat.pinned)];
  }, [summaries, meta.chats]);

  const currentChat = useMemo(
    () => (state.chat?.conversationId ? (chats.find((chat) => chat.id === state.chat!.conversationId) ?? null) : null),
    [chats, state.chat],
  );

  const activeFile = useMemo(
    () => (state.page === "editor" ? (files.find((file) => file.id === state.activeFileId) ?? null) : null),
    [files, state.activeFileId, state.page],
  );

  const scopeFolderId = useMemo(() => {
    if (state.chat && folders.some((folder) => folder.id === state.chat!.folderId)) return state.chat.folderId;
    // Falling back to the open file's folder keeps "what the agent will touch"
    // aligned with "what you are looking at".
    if (activeFile) return activeFile.folderId;
    return defaultFolderId;
  }, [folders, state.chat, activeFile, defaultFolderId]);

  const value = useMemo<ShellContextValue>(
    () => ({
      state,
      dispatch,
      folders,
      files,
      projects,
      chats,
      currentChat,
      activeFile,
      defaultFolderId,
      scopeFolderId,
      loaded,
      reload,
      reloadChats,
      setChatMeta,
      setProjectMeta,
    }),
    [
      state,
      folders,
      files,
      projects,
      chats,
      currentChat,
      activeFile,
      defaultFolderId,
      scopeFolderId,
      loaded,
      reload,
      reloadChats,
      setChatMeta,
      setProjectMeta,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside <ShellProvider>");
  return value;
}

/**
 * The shell's view state as a pure reducer — OD-UI-1.2 (r10).
 *
 * The workspace is three columns: the sidebar (244px or hidden), the
 * conversation (320–520px, docked left or right, or floating) and the content
 * region, which shows Home, Local, a project's Assets, Settings or an open
 * document. There is no Agent/Editor mode: the standard retired it (§10,
 * "不恢复 Agent / Editor 模式切换"), and what used to be a mode is now simply
 * whether a conversation is open beside the content.
 *
 * Three rules live here and nowhere else, so they can be asserted without
 * mounting React:
 *
 *  - **A tab remembers how it was opened.** `tabContexts` records, per open
 *    file, the conversation it was opened from — or null for Local. Activating
 *    a tab restores that context; it never converts a Local tab into a Chat tab
 *    because a conversation happens to be on screen (§18).
 *  - **Opening a conversation opens nothing else.** It shows the chat and the
 *    project's Assets list, resets no sidebar preference and activates no file
 *    (§16, WORKSPACE-STANDARD §01).
 *  - **The sidebar only moves when the user moves it.** No navigation action
 *    touches `navCollapsed` (§16, "首栏默认常驻").
 */

import type { FileMeta } from "../../shared/uiPort";
import type { PersistedShellState } from "./persist";

export type Page = "home" | "local" | "projects" | "assets" | "editor" | "settings" | "image";
export type ChatPanel = "chat" | "assets";
export type ChatPosition = "left" | "right";

export const NAV_WIDTH = 244;
export const CHAT_DEFAULT_WIDTH = 360;
export const CHAT_MIN_WIDTH = 320;
export const CHAT_MAX_WIDTH = 520;
/** Arrow-key step on the splitter (§03). */
export const CHAT_KEYBOARD_STEP = 16;

/**
 * Which conversation the second column shows.
 *
 * `conversationId` is null for a chat that has been started but not yet spoken
 * in: the runtime names a conversation after its first run, so until a message
 * is sent there is nothing to call it. `folderId` is the project — or the
 * default folder for a chat that belongs to none ("Unfiled").
 */
export interface ChatRef {
  folderId: string;
  conversationId: string | null;
}

export const sameChat = (left: ChatRef | null, right: ChatRef | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.folderId === right.folderId &&
    left.conversationId === right.conversationId);

export type SettingsSectionId =
  | "general"
  | "files"
  | "models"
  | "permissions"
  | "notifications"
  | "account"
  | "license"
  | "about";

export const SETTINGS_SECTIONS: readonly SettingsSectionId[] = [
  "general",
  "files",
  "models",
  "permissions",
  "notifications",
  "account",
  "license",
  "about",
];

/** The six static Dex avatars, by the state each was drawn from (WORKSPACE-STANDARD §05). */
export type AvatarId = "ready" | "hover" | "done" | "think" | "write" | "celebrate";
export const AVATAR_IDS: readonly AvatarId[] = ["ready", "hover", "done", "think", "write", "celebrate"];

export interface ShellState {
  page: Page;
  chat: ChatRef | null;
  /**
   * The name the user gave a chat that has not been spoken in yet. It becomes
   * the conversation's name when its first run gives it an id.
   */
  pendingChatName: string | null;
  /** What the second column shows: the conversation, or the compact Assets list. */
  panel: ChatPanel;
  /** Whether the content region is showing beside an open conversation. */
  workspaceOpen: boolean;
  chatFloating: boolean;
  chatPosition: ChatPosition;
  chatWidth: number;
  /** The sidebar is fully hidden (0px). Hover shows it temporarily; that is not state. */
  navCollapsed: boolean;
  /** Projects open in the sidebar tree. */
  expandedFolderIds: string[];
  openFileIds: string[];
  activeFileId: string | null;
  tabContexts: Record<string, ChatRef | null>;
  /** Most recently closed first, for Reopen. */
  closedFileIds: string[];
  /**
   * Files an agent finished with that the user has not looked at since (§10).
   * Opening or re-focusing the file clears it; seeing the tab, or opening some
   * other file, does not.
   */
  unreadFileIds: string[];
  /** The Dex panel over a Local document. */
  dexOpen: boolean;
  settingsSection: SettingsSectionId;
  avatar: AvatarId;
  theme: "light" | "dark";
  /** Hot and fresh features: shown on Home, and whether its gift button exists yet (§21). */
  featuresVisible: boolean;
  featuresDocked: boolean;
  /**
   * The canvas is showing the bundled recording, not a file. See `enter-stage`.
   */
  demo: boolean;
  /** When the recording was last asked for, ISO; it loses the canvas to anything newer. */
  demoStartedAt: string | null;
  /**
   * The content region is showing a run's live stage rather than a library
   * file — a document being generated has no file until it finishes.
   */
  stage: boolean;
}

export type ShellAction =
  /** Home, Local, Settings or the image creator: leaves any conversation. */
  | { type: "go"; page: "home" | "local" | "projects" | "settings" | "image"; section?: SettingsSectionId }
  | { type: "open-chat"; chat: ChatRef; name?: string }
  /** A chat that had no conversation id has just been given one by its first run. */
  | { type: "adopt-conversation"; folderId: string; conversationId: string }
  | { type: "set-panel"; panel: ChatPanel }
  | { type: "toggle-workspace" }
  | { type: "toggle-chat-display" }
  | { type: "swap-chat" }
  | { type: "set-chat-width"; width: number }
  | { type: "toggle-nav" }
  | { type: "toggle-folder"; folderId: string }
  | { type: "reveal-folder"; folderId: string }
  /** Opens a file in the context on screen: the open conversation, or Local. */
  | { type: "open-file"; fileId: string }
  /** Opens a file as Local, leaving any conversation. */
  | { type: "open-local-file"; fileId: string }
  /** Activates an open tab, restoring the context it was opened in. */
  | { type: "activate-file"; fileId: string }
  /** Adds a tab without activating it — a finished run's result (§10). */
  | { type: "add-tab"; fileId: string; chat: ChatRef | null; unread?: boolean }
  | { type: "mark-unread"; fileId: string }
  | { type: "close-file"; fileId: string }
  | { type: "move-tab"; fileId: string; toIndex: number }
  | { type: "reopen-tab" }
  | { type: "set-dex-open"; open: boolean }
  | { type: "set-settings-section"; section: SettingsSectionId }
  | { type: "set-avatar"; avatar: AvatarId }
  | { type: "set-theme"; theme: "light" | "dark" }
  /** Settings → Reset: appearance and layout go back; what is open stays open. */
  | { type: "reset-preferences" }
  | { type: "set-features"; visible: boolean }
  /**
   * Puts the canvas on screen without a file: a run's live stage, or (`demo`)
   * the bundled recording. Asking for the recording again replays it.
   */
  | { type: "enter-stage"; demo?: boolean }
  | { type: "leave-demo" }
  | { type: "prune-files"; files: FileMeta[] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Persisted view state is untrusted input: `??` lets NaN through. */
const finite = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const initialShellState: ShellState = {
  page: "home",
  chat: null,
  pendingChatName: null,
  panel: "chat",
  workspaceOpen: false,
  chatFloating: false,
  chatPosition: "left",
  chatWidth: CHAT_DEFAULT_WIDTH,
  navCollapsed: false,
  expandedFolderIds: [],
  openFileIds: [],
  activeFileId: null,
  tabContexts: {},
  closedFileIds: [],
  unreadFileIds: [],
  dexOpen: false,
  settingsSection: "general",
  avatar: "ready",
  theme: "light",
  featuresVisible: true,
  featuresDocked: false,
  demo: false,
  demoStartedAt: null,
  stage: false,
};

/** A stamp that is always newer than the last one, never just different. */
function nextDemoStamp(previous: string | null): string {
  const now = Date.now();
  const last = previous === null ? Number.NaN : Date.parse(previous);
  return new Date(Number.isNaN(last) ? now : Math.max(now, last + 1)).toISOString();
}

const toggleIn = (list: string[], value: string) =>
  list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

/* ---------------------------------------------------------------- selectors */

/** The second column is on screen at all. */
export const hasChat = (state: ShellState): boolean => state.chat !== null;

/** Home, Local and Settings show no document strip (they keep a blank 40px band). */
export const showsTabStrip = (state: ShellState): boolean =>
  state.page !== "home" && state.page !== "local" && state.page !== "settings";

/** An open document, or a run's stage, is what the content region shows. */
export const showsEditor = (state: ShellState): boolean =>
  state.page === "editor" && (state.activeFileId !== null || state.stage || state.demo);

/** The conversation fills the window because the content region is closed. */
export const workspaceClosed = (state: ShellState): boolean => state.chat !== null && !state.workspaceOpen;

/** Whether an open file's tab belongs to a conversation (draws the Dex watermark). */
export const tabIsChat = (state: ShellState, fileId: string): boolean =>
  Boolean(state.tabContexts[fileId]);

/* ------------------------------------------------------------------ reducer */

/** Leaving a conversation drops everything that only means something inside one. */
function withoutChat(state: ShellState): ShellState {
  return { ...state, chat: null, pendingChatName: null, panel: "chat", workspaceOpen: false, chatFloating: false };
}

function withContext(state: ShellState, context: ChatRef | null): ShellState {
  if (sameChat(state.chat, context)) {
    return { ...state, workspaceOpen: context !== null };
  }
  return {
    ...state,
    chat: context,
    pendingChatName: null,
    panel: "chat",
    chatFloating: false,
    workspaceOpen: context !== null,
  };
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case "go": {
      const next = withoutChat(state);
      return {
        ...next,
        page: action.page,
        activeFileId: null,
        stage: false,
        demo: false,
        demoStartedAt: null,
        dexOpen: false,
        settingsSection:
          action.page === "settings" ? (action.section ?? state.settingsSection) : state.settingsSection,
      };
    }

    case "open-chat":
      return {
        ...state,
        chat: action.chat,
        pendingChatName: action.chat.conversationId === null ? (action.name?.trim() || null) : null,
        page: "assets",
        panel: "chat",
        chatFloating: false,
        workspaceOpen: true,
        activeFileId: null,
        stage: false,
        demo: false,
        demoStartedAt: null,
        dexOpen: false,
        expandedFolderIds: state.expandedFolderIds.includes(action.chat.folderId)
          ? state.expandedFolderIds
          : [...state.expandedFolderIds, action.chat.folderId],
      };

    case "adopt-conversation": {
      if (
        !state.chat ||
        state.chat.folderId !== action.folderId ||
        state.chat.conversationId !== null
      ) {
        return state;
      }
      const chat: ChatRef = { folderId: action.folderId, conversationId: action.conversationId };
      const tabContexts = Object.fromEntries(
        Object.entries(state.tabContexts).map(([fileId, context]) => [
          fileId,
          context && context.folderId === action.folderId && context.conversationId === null ? chat : context,
        ]),
      );
      return { ...state, chat, pendingChatName: null, tabContexts };
    }

    case "set-panel":
      return state.chat ? { ...state, panel: action.panel } : state;

    case "toggle-workspace": {
      if (!state.chat) return state;
      const open = !state.workspaceOpen;
      return {
        ...state,
        workspaceOpen: open,
        // Closing the content region re-docks a floating chat: there is nothing
        // left for it to float over.
        chatFloating: open ? state.chatFloating : false,
        page: open && !showsEditorTarget(state) ? "assets" : state.page,
      };
    }

    case "toggle-chat-display": {
      if (!state.chat) return state;
      const floating = !state.chatFloating;
      if (!floating) return { ...state, chatFloating: false };
      return {
        ...state,
        chatFloating: true,
        workspaceOpen: true,
        page: showsEditorTarget(state) ? state.page : "assets",
      };
    }

    case "swap-chat":
      return { ...state, chatPosition: state.chatPosition === "left" ? "right" : "left" };

    case "set-chat-width":
      return { ...state, chatWidth: clamp(Math.round(action.width), CHAT_MIN_WIDTH, CHAT_MAX_WIDTH) };

    case "toggle-nav":
      return { ...state, navCollapsed: !state.navCollapsed };

    case "toggle-folder":
      return { ...state, expandedFolderIds: toggleIn(state.expandedFolderIds, action.folderId) };

    case "reveal-folder":
      return state.expandedFolderIds.includes(action.folderId)
        ? state
        : { ...state, expandedFolderIds: [...state.expandedFolderIds, action.folderId] };

    case "open-file": {
      const openFileIds = state.openFileIds.includes(action.fileId)
        ? state.openFileIds
        : [...state.openFileIds, action.fileId];
      return {
        ...state,
        page: "editor",
        openFileIds,
        activeFileId: action.fileId,
        // Opening from another entry deliberately updates the tab's context.
        tabContexts: { ...state.tabContexts, [action.fileId]: state.chat },
        unreadFileIds: state.unreadFileIds.filter((id) => id !== action.fileId),
        workspaceOpen: state.chat !== null,
        dexOpen: false,
        stage: false,
        demo: false,
        demoStartedAt: null,
      };
    }

    case "open-local-file":
      return shellReducer(withoutChat(state), { type: "open-file", fileId: action.fileId });

    case "activate-file": {
      if (!state.openFileIds.includes(action.fileId)) return state;
      const context = state.tabContexts[action.fileId] ?? null;
      return {
        ...withContext(state, context),
        page: "editor",
        activeFileId: action.fileId,
        unreadFileIds: state.unreadFileIds.filter((id) => id !== action.fileId),
        dexOpen: false,
        stage: false,
        demo: false,
        demoStartedAt: null,
      };
    }

    case "add-tab": {
      const unreadFileIds =
        action.unread && state.activeFileId !== action.fileId && !state.unreadFileIds.includes(action.fileId)
          ? [...state.unreadFileIds, action.fileId]
          : state.unreadFileIds;
      if (state.openFileIds.includes(action.fileId)) {
        return unreadFileIds === state.unreadFileIds ? state : { ...state, unreadFileIds };
      }
      return {
        ...state,
        openFileIds: [...state.openFileIds, action.fileId],
        tabContexts: { ...state.tabContexts, [action.fileId]: action.chat },
        unreadFileIds,
      };
    }

    case "mark-unread":
      // The file on screen is being looked at; it cannot also be unseen.
      if (state.unreadFileIds.includes(action.fileId)) return state;
      if (state.page === "editor" && state.activeFileId === action.fileId) return state;
      return { ...state, unreadFileIds: [...state.unreadFileIds, action.fileId] };

    case "close-file": {
      if (!state.openFileIds.includes(action.fileId)) return state;
      const openFileIds = state.openFileIds.filter((id) => id !== action.fileId);
      const { [action.fileId]: _closed, ...tabContexts } = state.tabContexts;
      const closedFileIds = [action.fileId, ...state.closedFileIds.filter((id) => id !== action.fileId)].slice(0, 20);
      const base = { ...state, openFileIds, tabContexts, closedFileIds };
      if (state.activeFileId !== action.fileId) return base;
      const next = openFileIds.at(-1) ?? null;
      if (next !== null) {
        return {
          ...withContext(base, tabContexts[next] ?? null),
          page: "editor",
          activeFileId: next,
          dexOpen: false,
        };
      }
      return {
        ...base,
        activeFileId: null,
        dexOpen: false,
        page: state.chat ? "assets" : "home",
      };
    }

    case "move-tab": {
      const from = state.openFileIds.indexOf(action.fileId);
      if (from < 0) return state;
      const openFileIds = state.openFileIds.filter((id) => id !== action.fileId);
      openFileIds.splice(clamp(action.toIndex, 0, openFileIds.length), 0, action.fileId);
      return { ...state, openFileIds };
    }

    case "reopen-tab": {
      const [fileId, ...closedFileIds] = state.closedFileIds;
      if (!fileId) return state;
      return shellReducer({ ...state, closedFileIds }, { type: "open-file", fileId });
    }

    case "set-dex-open":
      return state.dexOpen === action.open ? state : { ...state, dexOpen: action.open };

    case "set-settings-section":
      return { ...state, settingsSection: action.section };

    case "set-avatar":
      return { ...state, avatar: action.avatar };

    case "set-theme":
      return { ...state, theme: action.theme };

    case "reset-preferences":
      return {
        ...state,
        theme: initialShellState.theme,
        avatar: initialShellState.avatar,
        navCollapsed: initialShellState.navCollapsed,
        chatWidth: initialShellState.chatWidth,
        chatPosition: initialShellState.chatPosition,
        chatFloating: initialShellState.chatFloating,
        featuresVisible: initialShellState.featuresVisible,
      };

    case "set-features":
      // Closing it once is what creates the gift button; it never goes away again.
      return { ...state, featuresVisible: action.visible, featuresDocked: state.featuresDocked || !action.visible };

    case "enter-stage": {
      const demo = action.demo === true;
      return {
        ...state,
        page: "editor",
        /*
         * Nothing is open — including whatever was open before this. Everything
         * drawn around the canvas reads `activeFileId`: the selected tab and the
         * composer's target, which is a routing decision and not a hint. A
         * follow-up typed while a workbook was being written would otherwise be
         * sent as an edit of the document that was open underneath it.
         */
        activeFileId: null,
        workspaceOpen: state.chat !== null,
        dexOpen: false,
        stage: !demo,
        demo,
        demoStartedAt: demo ? nextDemoStamp(state.demoStartedAt) : state.demoStartedAt,
      };
    }

    case "leave-demo":
      if (!state.demo && state.demoStartedAt === null) return state;
      return { ...state, demo: false, demoStartedAt: null };

    case "prune-files": {
      // Files can disappear underneath the shell. Tabs that point at nothing
      // are dropped rather than rendered as ghosts.
      const live = new Set(action.files.map((file) => file.id));
      const openFileIds = state.openFileIds.filter((id) => live.has(id));
      if (openFileIds.length === state.openFileIds.length) return state;
      const tabContexts = Object.fromEntries(
        Object.entries(state.tabContexts).filter(([fileId]) => live.has(fileId)),
      );
      const activeFileId =
        state.activeFileId && live.has(state.activeFileId) ? state.activeFileId : (openFileIds.at(-1) ?? null);
      const orphaned = state.page === "editor" && activeFileId === null && !state.stage && !state.demo;
      return {
        ...state,
        openFileIds,
        tabContexts,
        activeFileId,
        closedFileIds: state.closedFileIds.filter((id) => live.has(id)),
        unreadFileIds: state.unreadFileIds.filter((id) => live.has(id)),
        page: orphaned ? (state.chat ? "assets" : "home") : state.page,
      };
    }

    default:
      return state;
  }
}

/** Whether the content region has a document (or a stage) to keep showing. */
function showsEditorTarget(state: ShellState): boolean {
  return state.page === "editor" && (state.activeFileId !== null || state.stage || state.demo);
}

/* -------------------------------------------------------------- persistence */

const chatRefOf = (value: unknown): ChatRef | null => {
  if (!value || typeof value !== "object") return null;
  const { folderId, conversationId } = value as Partial<ChatRef>;
  if (typeof folderId !== "string" || !folderId) return null;
  return { folderId, conversationId: typeof conversationId === "string" ? conversationId : null };
};

export function hydrateShellState(persisted: Partial<PersistedShellState>): ShellState {
  const openFileIds = Array.isArray(persisted.openFileIds) ? persisted.openFileIds.filter((id) => typeof id === "string") : [];
  const tabContexts: Record<string, ChatRef | null> = {};
  for (const fileId of openFileIds) tabContexts[fileId] = chatRefOf(persisted.tabContexts?.[fileId]);
  const pages: readonly Page[] = ["home", "local", "projects", "assets", "editor", "settings", "image"];
  const page = pages.includes(persisted.page as Page) ? (persisted.page as Page) : initialShellState.page;
  const chat = chatRefOf(persisted.chat);
  const activeFileId =
    typeof persisted.activeFileId === "string" && openFileIds.includes(persisted.activeFileId)
      ? persisted.activeFileId
      : null;
  const demo = persisted.demo === true;
  const stage = persisted.stage === true;
  return {
    ...initialShellState,
    // A page that needs something the session did not bring back falls to Home.
    page:
      (page === "assets" && !chat) || (page === "editor" && !activeFileId && !demo && !stage) ? "home" : page,
    chat,
    panel: persisted.panel === "assets" && chat ? "assets" : "chat",
    workspaceOpen: chat ? persisted.workspaceOpen !== false : false,
    chatFloating: Boolean(chat) && persisted.chatFloating === true,
    chatPosition: persisted.chatPosition === "right" ? "right" : "left",
    chatWidth: clamp(finite(persisted.chatWidth, CHAT_DEFAULT_WIDTH), CHAT_MIN_WIDTH, CHAT_MAX_WIDTH),
    navCollapsed: persisted.navCollapsed === true,
    expandedFolderIds: Array.isArray(persisted.expandedFolderIds) ? persisted.expandedFolderIds : [],
    openFileIds,
    activeFileId,
    tabContexts,
    settingsSection: SETTINGS_SECTIONS.includes(persisted.settingsSection as SettingsSectionId)
      ? (persisted.settingsSection as SettingsSectionId)
      : "general",
    avatar: AVATAR_IDS.includes(persisted.avatar as AvatarId) ? (persisted.avatar as AvatarId) : "ready",
    theme: persisted.theme === "dark" ? "dark" : "light",
    featuresVisible: persisted.featuresVisible !== false,
    featuresDocked: persisted.featuresDocked === true,
    demo,
    demoStartedAt: persisted.demoStartedAt ?? null,
    stage,
  };
}

export function toPersisted(state: ShellState): PersistedShellState {
  return {
    page: state.page,
    chat: state.chat,
    panel: state.panel,
    workspaceOpen: state.workspaceOpen,
    chatFloating: state.chatFloating,
    chatPosition: state.chatPosition,
    chatWidth: state.chatWidth,
    navCollapsed: state.navCollapsed,
    expandedFolderIds: state.expandedFolderIds,
    openFileIds: state.openFileIds,
    activeFileId: state.activeFileId,
    tabContexts: state.tabContexts,
    settingsSection: state.settingsSection,
    avatar: state.avatar,
    theme: state.theme,
    featuresVisible: state.featuresVisible,
    featuresDocked: state.featuresDocked,
    demo: state.demo,
    demoStartedAt: state.demoStartedAt,
    stage: state.stage,
  };
}

/**
 * Development-only fixtures, driven from the query string.
 *
 * Why this exists: in an ordinary browser the shell's port is the bridge's
 * preview implementation — an explicit *empty* workspace with no folders, files,
 * models or runtime (see `port/createShellPort.ts`). That is the right default,
 * because a standalone prototype must never be able to masquerade as user data.
 * It also means most of this UI is unreachable outside the desktop app: no
 * sidebar tree, no tabs, no task list, no menus hanging off any of them. A UI
 * audit that cannot reach those screens is an audit of the home page.
 *
 * So: one opt-in switch, off unless asked for, and gone entirely from a
 * production build.
 *
 *   ?shellFixture=1                  the in-memory fake port, audit dataset
 *   ?seed=prototype                  …with the approved prototype's own sample
 *                                    workspace instead, for side-by-side review
 *   ?workspace=empty                 …with no folders or files at all
 *   ?shell=C7                        a named shell combination (see below)
 *   ?page=home|local|projects|assets|editor|settings|image
 *                                    individual overrides, applied after ?shell
 *   ?nav=collapsed|expanded
 *   ?chat=<conversation id>          open a conversation (its project's Assets
 *                                    beside it, unless ?page says otherwise)
 *   ?panel=chat|assets
 *   ?side=left|right                 which side the conversation docks on
 *   ?float=1                         float the conversation
 *   ?workspace=closed                close the content region
 *   ?file=<file id>                  open a file, in the context on screen
 *   ?tabs=<file id>,<file id>        open several; ?file picks the one in front
 *   ?run=<state>                     put the open conversation's run in one of
 *                                    the standard's states (seed=prototype):
 *                                    planning reading working checking input
 *                                    review complete stopped failed partial
 *                                    offline
 *   ?offline=1                       hold the workspace offline (?run=offline
 *                                    implies it)
 *   ?section=<settings section>
 *   ?theme=dark
 *   ?forceUpdate=<phase>             render the mandatory-update page instead
 *   ?canvasChrome=sheet|slides|doc   report an editor's own chrome, as if one
 *                                    were mounted (there is none in a browser)
 *   ?slidesGenerating=research|outline|writing|drawing|polish
 *                                    paint the PPT generating canvas on the
 *                                    host skeleton (browser has no editor)
 *
 * **The guard is load-bearing.** `enabled` defaults to `import.meta.env.DEV`,
 * which Vite replaces with a literal `false` when it builds, so in a packaged
 * app the first line returns and nothing below it can run whatever the URL says.
 * It is a parameter rather than a bare `if` inside the body so the test can
 * actually exercise the production branch — a guard nobody can test is a guard
 * nobody knows the state of.
 */

import type { AgentTask, UiPort } from "../../shared/uiPort";
import type { UpdatePhase } from "../../renderer/useAppUpdate";
import type { AppUpdateRelease } from "../../shared/types";
import type { PersistedShellState } from "../state/persist";
import { createFakePort } from "../port/fake/createFakePort";
import { deckDemoEnabled } from "./deckDemo";
import { slidesGeneratingPreview } from "../editor/slidesGenerating/slidesGeneratingPreview";
import { DOC_CHROME, SHEET_CHROME, SLIDES_CHROME } from "../../canvas/editorChrome";
import type { EditorChrome } from "../editor/canvasSurface";
import {
  AUDIT_ACTIVE_FILE_ID,
  AUDIT_FOLDER_IDS,
  AUDIT_OPEN_FILE_IDS,
  auditFiles,
  auditFolders,
  auditTasks,
} from "../port/fake/auditSeed";
import {
  PROTOTYPE_FOLDER_IDS,
  prototypeFiles,
  prototypeFolders,
  prototypeRun,
  prototypeTasks,
} from "../port/fake/prototypeSeed";
import { SETTINGS_SECTIONS, type ChatRef, type Page, type SettingsSectionId } from "../state/shellReducer";

/** The audit dataset's working conversation, which the combinations open. */
const AUDIT_CHAT: ChatRef = { folderId: AUDIT_FOLDER_IDS.launch, conversationId: "task-working" };

/**
 * The ten shell combinations, by name.
 *
 * The axes are OD-UI-1.2's: which page the content region shows, whether a
 * conversation is beside it and on which side, whether that conversation is
 * docked, floating or has the window to itself, and whether the sidebar is
 * showing. Sessions refer to these by number; spelling the flags out each time
 * is how a screenshot ends up filed under the wrong combination.
 *
 * The combinations that are missing are the ones that do not exist: Home,
 * Local and Settings never have a conversation beside them, and a floating
 * conversation always has a content region to float over.
 */
export const SHELL_COMBINATIONS = {
  C1: { page: "home", navCollapsed: false },
  C2: { page: "home", navCollapsed: true },
  C3: { page: "local", navCollapsed: false },
  C4: { page: "assets", chat: AUDIT_CHAT, workspaceOpen: true, navCollapsed: false },
  C5: { page: "editor", chat: AUDIT_CHAT, workspaceOpen: true, navCollapsed: false },
  C6: { page: "editor", chat: AUDIT_CHAT, workspaceOpen: true, chatPosition: "right", navCollapsed: true },
  C7: { page: "editor", chat: AUDIT_CHAT, workspaceOpen: true, chatFloating: true, navCollapsed: true },
  C8: { page: "assets", chat: AUDIT_CHAT, workspaceOpen: false, navCollapsed: false },
  C9: { page: "editor", chat: null, navCollapsed: true },
  C10: { page: "settings", navCollapsed: false },
} as const satisfies Record<string, Partial<PersistedShellState>>;

export type ShellCombination = keyof typeof SHELL_COMBINATIONS;

export interface DevFixture {
  /** The fake port, or null to leave the real one in place. */
  port: UiPort | null;
  /** Merged over the persisted view state, so a URL beats what localStorage kept. */
  stateOverride: Partial<PersistedShellState>;
  /** Non-null renders the mandatory-update page in place of the whole shell. */
  forceUpdate: { phase: UpdatePhase; release: AppUpdateRelease } | null;
  /**
   * An editor's self-reported chrome, published as if one were mounted.
   *
   * Without this the canvas channel (`editor/canvasSurface.ts`) is unreachable
   * from a browser: `createShellCanvas()` returns null with no backend, no
   * editor mounts, nothing publishes, and the two behaviours the channel drives
   * — the presence keeping clear of the editor's bottom strip, the shell
   * yielding its status bar — can only be seen on `dev-real`. That is the same
   * arrangement that made `e2e/ui-audit-s4.spec.ts` thirty conditional skips.
   *
   * The values are the production constants, imported rather than restated, so
   * a fixture run cannot agree with a number the real editors have stopped
   * reporting.
   */
  canvasChrome: EditorChrome | null;
  /** Hold the workspace offline, so the state can be reviewed with a connection. */
  offline: boolean;
}

const UPDATE_PHASES: readonly UpdatePhase[] = [
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
];

/** Stand-in release notes for the update page. Never reaches a real updater. */
function previewRelease(): AppUpdateRelease {
  return {
    version: "1.4.0",
    notes: "Audit preview build. This release does not exist and nothing here downloads anything.",
    minSupportedVersion: "1.4.0",
    mandatory: true,
    /*
     * Two assets rather than none.
     *
     * The error state's manual-download fallback reads `release.assets` — with
     * an empty map that whole branch is unreachable, so the one escape route
     * from a page the user cannot leave could not be exercised at all. The URLs
     * resolve to nothing on purpose: this fixture must never hand anyone a real
     * installer, and the page is being reviewed, not driven.
     */
    assets: {
      "darwin-arm64": {
        url: "https://example.invalid/officedex-1.4.0-arm64.dmg",
        sha256: "0".repeat(64),
        size: 118_489_088,
      },
      "windows-amd64": {
        url: "https://example.invalid/officedex-1.4.0-amd64.exe",
        sha256: "1".repeat(64),
        size: 131_072_000,
      },
    },
  };
}

function combinationOverride(name: string): Partial<PersistedShellState> {
  const combination = SHELL_COMBINATIONS[name.toUpperCase() as ShellCombination];
  return combination ? { ...combination } : {};
}

const PAGES: readonly Page[] = ["home", "local", "projects", "assets", "editor", "settings", "image"];

export function readDevFixture(
  search: string,
  enabled: boolean = import.meta.env.DEV,
): DevFixture | null {
  if (!enabled) return null;

  const params = new URLSearchParams(search);
  const wantsFixture = params.get("shellFixture") === "1";
  const prototype = params.get("seed") === "prototype";
  const combination = params.get("shell");
  const updatePhase = params.get("forceUpdate");
  const deckRun = params.get("deckRun") === "1";
  // The gate is a state of the same run, so asking for it implies asking for it.
  const gate = params.get("gate") === "1";
  const run = params.get("run");
  // A run that lost its connection is looked at without one, as the prototype shows it.
  const offline = params.get("offline") === "1" || run === "offline";

  const stateOverride: Partial<PersistedShellState> = combination
    ? combinationOverride(combination)
    : {};

  // Individual flags win over the named combination, so a session can take C7
  // and vary one axis without spelling the others out again.
  const chat = params.get("chat");
  if (chat) {
    stateOverride.chat = {
      folderId: prototype ? PROTOTYPE_FOLDER_IDS.launch : AUDIT_FOLDER_IDS.launch,
      conversationId: chat,
    };
    stateOverride.page = "assets";
    stateOverride.workspaceOpen = true;
  }

  const file = params.get("file");
  if (file) {
    stateOverride.openFileIds = [file];
    stateOverride.activeFileId = file;
    stateOverride.tabContexts = { [file]: stateOverride.chat ?? null };
    stateOverride.page = "editor";
  }

  // `?tabs=doc,sheet` opens several files in the context on screen; `?file`
  // says which is in front, the first otherwise.
  const tabs = params.get("tabs")?.split(",").filter(Boolean) ?? [];
  if (tabs.length > 0) {
    stateOverride.openFileIds = tabs;
    stateOverride.activeFileId = file && tabs.includes(file) ? file : tabs[0];
    stateOverride.tabContexts = Object.fromEntries(tabs.map((id) => [id, stateOverride.chat ?? null]));
    stateOverride.page = "editor";
  }

  const page = params.get("page");
  if (page && (PAGES as readonly string[]).includes(page)) stateOverride.page = page as Page;

  const panel = params.get("panel");
  if (panel === "chat" || panel === "assets") stateOverride.panel = panel;

  const side = params.get("side");
  if (side === "left" || side === "right") stateOverride.chatPosition = side;

  if (params.get("float") === "1") stateOverride.chatFloating = true;
  if (params.get("workspace") === "closed") stateOverride.workspaceOpen = false;
  if (params.get("theme") === "dark") stateOverride.theme = "dark";

  const section = params.get("section");
  if (section && (SETTINGS_SECTIONS as readonly string[]).includes(section)) {
    stateOverride.settingsSection = section as SettingsSectionId;
    stateOverride.page = "settings";
  }

  /*
   * `?deckDemo=1` is the shortcut to the bundled recording. The recording is
   * drawn in the canvas, which is hidden while any other page is up, so the
   * flag has to put the editor region on screen as well.
   */
  if (deckDemoEnabled(search)) {
    stateOverride.demo = true;
    if (!page) stateOverride.page = "editor";
  }

  if (slidesGeneratingPreview(search) && !page) {
    stateOverride.page = "editor";
    stateOverride.stage = true;
  }

  const nav = params.get("nav");
  if (nav === "collapsed" || nav === "expanded") stateOverride.navCollapsed = nav === "collapsed";

  const forceUpdate =
    updatePhase && (UPDATE_PHASES as readonly string[]).includes(updatePhase)
      ? { phase: updatePhase as UpdatePhase, release: previewRelease() }
      : null;

  const canvasChrome = CHROME_BY_NAME[params.get("canvasChrome") ?? ""] ?? null;

  if (!wantsFixture && !forceUpdate && Object.keys(stateOverride).length === 0) return null;

  // `?workspace=empty`: the fake port with nothing in it.
  const emptyWorkspace = params.get("workspace") === "empty";
  const port = !wantsFixture
    ? null
    : emptyWorkspace
      ? createFakePort({ folders: [], files: [] })
      : prototype
        ? prototypePort(run)
        : auditPort(deckRun || gate, gate);

  // Tabs come from the fixture, not from whatever the last session left in
  // localStorage — otherwise the first run against a browser profile that has
  // used the shell before opens on stale file ids the fake has never heard of.
  const seeded: Partial<PersistedShellState> = !wantsFixture || emptyWorkspace
    ? {}
    : prototype
      ? { expandedFolderIds: [PROTOTYPE_FOLDER_IDS.launch] }
      : {
          openFileIds: AUDIT_OPEN_FILE_IDS,
          activeFileId: AUDIT_ACTIVE_FILE_ID,
          tabContexts: Object.fromEntries(
            AUDIT_OPEN_FILE_IDS.map((id, index) => [id, index % 2 === 0 ? AUDIT_CHAT : null]),
          ),
          expandedFolderIds: [AUDIT_FOLDER_IDS.launch, AUDIT_FOLDER_IDS.bulk, AUDIT_FOLDER_IDS.empty],
        };

  return {
    port,
    stateOverride: { ...seeded, ...stateOverride },
    forceUpdate,
    canvasChrome,
    offline,
  };
}

function prototypePort(run: string | null): UiPort {
  const now = Date.now();
  const staged = run ? prototypeRun(run, now) : null;
  // The fake lists its conversations newest first, which is last seeded first.
  const tasks = prototypeTasks().reverse();
  return createFakePort({
    folders: prototypeFolders(),
    files: prototypeFiles(now),
    // In place: a run does not move its conversation in the list.
    tasks: staged ? tasks.map((task) => (task.conversationId === staged.conversationId ? staged : task)) : tasks,
  });
}

/** `?canvasChrome=sheet|slides|doc`. Anything else reports nothing. */
const CHROME_BY_NAME: Record<string, EditorChrome | undefined> = {
  sheet: SHEET_CHROME,
  slides: SLIDES_CHROME,
  doc: DOC_CHROME,
};

function auditPort(deckRun: boolean, gate = false): UiPort {
  const now = Date.now();
  const tasks = auditTasks(now);
  return createFakePort({
    folders: auditFolders(),
    files: auditFiles(now),
    // The deck run takes the working conversation's place, so the combinations
    // that open that conversation open the deck run.
    tasks: deckRun
      ? [
          { ...deckRunTask(gate), conversationId: "task-working" },
          ...tasks.filter((task) => task.id !== "task-working"),
        ]
      : tasks,
  });
}

/**
 * A deck mid-draw, for looking at the state that has no other way to be seen.
 *
 * The generation panel is the one surface that only exists while a run is going,
 * so the only way to look at it used to be to start a real generation and watch
 * — three minutes, real credits, and a layout that has already moved on by the
 * time anything is noticed. The audit seed's five task states are all generic;
 * none of them carries an outline, which is most of what this panel draws.
 *
 * Opt-in (`?deckRun=1`) rather than a sixth seeded task: the audit's C1-C10
 * captures are a baseline someone else is working against, and adding a row to
 * every one of them would be a diff nobody asked for.
 *
 * Every page mark at once, which is the point — queued, generating, repairing,
 * ready and failed are five different glyphs in a 320px column, and whether they
 * read as a set is not something the code can answer.
 */
function deckRunTask(gate: boolean): AgentTask {
  if (gate) return outlineGateTask();
  return {
    id: "task-deck-run",
    title: "Prepare a three-slide product launch brief",
    folderId: AUDIT_FOLDER_IDS.launch,
    documentType: "pptx",
    status: "working",
    phase: "Generating document content",
    steps: [
      { id: "analyze", label: "Analyzing request", state: "done" },
      { id: "research", label: "Researching", state: "done" },
      { id: "outline", label: "Drafting outline", state: "done" },
      { id: "design", label: "Choosing a design", state: "done" },
      { id: "generate-content", label: "Generating document content", state: "active" },
      { id: "export", label: "Formatting & export", state: "pending" },
    ],
    outline: [
      { slide: 1, title: "Positioning: who this is for and why now", state: "ready" },
      { slide: 2, title: "Launch timeline", state: "generating" },
      { slide: 3, title: "Next steps and owners", state: "repairing" },
      { slide: 4, title: "Risks we are carrying into the quarter", state: "queued" },
      { slide: 5, title: "Appendix: pricing detail", state: "failed" },
    ],
    messages: [
      {
        id: "deck-msg-1",
        role: "user",
        text: "Prepare a three-slide product launch brief covering positioning, timeline and next steps.",
        createdAt: Date.now() - 90_000,
      },
    ],
    suggestion: null,
    question: null,
  };
}

/**
 * The outline gate, which no interface can currently reach.
 *
 * This is the pipeline's one blocking stop: generation pauses once the outline
 * is fixed, because that is the last point where changing your mind costs
 * nothing — every stage after it rewrites whole pages.
 *
 * It exists on both sides and has never been seen. The runtime wires it only
 * for an interactive best-mode run, which the bridge produces only for
 * `generationMode: "plan"`, and nothing in `src/shell` sets that field — so
 * every real run is `fast` and the card never appears. The panel's half of it
 * (`toQuestion` synthesising a question from a `plan_review` that carries a
 * plan and no question of its own, `answer` routing back through
 * `respondToPlanReview`) has unit tests and no other evidence.
 *
 * Turning it on is a product decision with a real cost — a mandatory pause in
 * front of every deck — and that decision was being asked for in the abstract.
 * This renders the card from the same shape `toQuestion` produces, so it can be
 * looked at first: `?shellFixture=1&gate=1`.
 */
function outlineGateTask(): AgentTask {
  return {
    id: "task-outline-gate",
    title: "Prepare a three-slide product launch brief",
    folderId: AUDIT_FOLDER_IDS.launch,
    documentType: "pptx",
    status: "awaiting-review",
    phase: "Waiting for your review",
    steps: [
      { id: "analyze", label: "Analyzing request", state: "done" },
      { id: "research", label: "Researching", state: "done" },
      { id: "outline", label: "Drafting outline", state: "done" },
      { id: "design", label: "Choosing a design", state: "pending" },
      { id: "generate-content", label: "Generating document content", state: "pending" },
      { id: "export", label: "Formatting & export", state: "pending" },
    ],
    // Nothing has been drawn yet: the gate is in front of all of it, which is
    // the point of stopping here rather than later.
    outline: [
      { slide: 1, title: "Positioning: who this is for and why now", state: "queued" },
      { slide: 2, title: "Launch timeline", state: "queued" },
      { slide: 3, title: "Next steps and owners", state: "queued" },
    ],
    messages: [
      {
        id: "gate-msg-1",
        role: "user",
        text: "Prepare a three-slide product launch brief covering positioning, timeline and next steps.",
        createdAt: Date.now() - 40_000,
      },
    ],
    suggestion: null,
    /*
     * The shape `toQuestion` synthesises, copied rather than paraphrased: the
     * plan's id is the question's id, one recommended option, no freeform —
     * because the runtime accepts an approval, not a sentence.
     */
    question: {
      id: "plan-outline-gate",
      text: "The outline is ready.",
      options: [{ id: "approve", label: "Start drawing", recommended: true }],
      allowFreeform: false,
    },
  };
}

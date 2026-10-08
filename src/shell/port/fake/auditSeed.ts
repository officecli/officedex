/**
 * The fixture the UI audit runs against.
 *
 * Deliberately separate from `seed.ts`. That one is the prototype's "MO product
 * launch" workspace, kept so screens can be compared against the design side by
 * side, and a dozen tests assert against its exact contents. This one exists to
 * be *awkward*: an empty folder, a folder big enough to trigger the sidebar's
 * pagination, names long enough to overflow in both scripts, enough open tabs to
 * overflow the tab strip, and a task in every status the contract has.
 *
 * Every entry here is answering a question some audit session has to look at.
 * If you add one, say which — a fixture nobody is reading is just slower tests.
 */

import type { AgentTask, FileMeta, Folder } from "../../../shared/uiPort";

const DAY = 86_400_000;

/**
 * Long enough to overflow every row this shell has, in both scripts.
 *
 * Two of them because they break differently: CJK has no spaces, so it wraps
 * anywhere and `text-overflow: ellipsis` is the only thing holding it; the Latin
 * one is a single unbroken token, which `word-break: normal` cannot break at
 * all. A row that survives one can still be destroyed by the other.
 */
const LONG_CN = "二〇二六年第三季度产品发布会全流程执行方案与风险预案汇总（含渠道投放、媒体沟通、现场执行三个分册）";
const LONG_EN =
  "Q3-2026-product-launch-programme-execution-plan-and-contingency-register-including-channel-media-and-onsite-workstreams";

export const AUDIT_FOLDER_IDS = {
  launch: "folder-launch",
  /** 45 files: crosses the sidebar's page size, so "Show N more" appears. */
  bulk: "folder-bulk",
  /** Zero files. The state the reported "+ button escapes its row" was seen in. */
  empty: "folder-empty",
  /** A folder name that overflows the rail, the tree row and the scope chip. */
  long: "folder-long",
  inbox: "folder-inbox",
} as const;

export function auditFolders(): Folder[] {
  return [
    { id: AUDIT_FOLDER_IDS.launch, name: "MO product launch", path: "~/Documents/MO product launch" },
    { id: AUDIT_FOLDER_IDS.bulk, name: "Archive 2026", path: "~/Documents/Archive 2026" },
    { id: AUDIT_FOLDER_IDS.empty, name: "yirentk", path: "~/Documents/yirentk" },
    { id: AUDIT_FOLDER_IDS.long, name: LONG_CN, path: `~/Documents/${LONG_CN}` },
    { id: AUDIT_FOLDER_IDS.inbox, name: "Documents", path: "~/Documents", isDefault: true },
  ];
}

/** 45 rows in `bulk`, so the sidebar pages and the Home list groups by time. */
const BULK_COUNT = 45;

export function auditFiles(now = Date.now()): FileMeta[] {
  const file = (
    id: string,
    name: string,
    type: FileMeta["type"],
    folderId: string,
    openedDaysAgo: number,
    extra: Partial<FileMeta> = {},
  ): FileMeta => ({
    id,
    name,
    type,
    folderId,
    createdAt: now - (openedDaysAgo + 3) * DAY,
    updatedAt: now - openedDaysAgo * DAY,
    lastOpenedAt: now - openedDaysAgo * DAY,
    dirty: false,
    pinned: false,
    ...extra,
  });

  // Spread across the Home list's Today / Previous 7 days / Previous 30 days
  // buckets so every group header renders, and across all three types so the
  // per-type accent and the three canvas skeletons are all reachable.
  const bulk = Array.from({ length: BULK_COUNT }, (_, index) =>
    file(
      `file-bulk-${index + 1}`,
      `Archive note ${String(index + 1).padStart(2, "0")}.${["docx", "xlsx", "pptx"][index % 3]}`,
      (["doc", "sheet", "slides"] as const)[index % 3],
      AUDIT_FOLDER_IDS.bulk,
      index % 29,
    ),
  );

  return [
    // Tabs open on these; see AUDIT_OPEN_FILE_IDS.
    file("file-plan", "MO launch plan.docx", "doc", AUDIT_FOLDER_IDS.launch, 0, { pinned: true }),
    file("file-forecast", "MO sales forecast.xlsx", "sheet", AUDIT_FOLDER_IDS.launch, 0, { dirty: true }),
    file("file-deck", "MO launch deck.pptx", "slides", AUDIT_FOLDER_IDS.launch, 0),
    file("file-brief", "Positioning brief.docx", "doc", AUDIT_FOLDER_IDS.launch, 2, { pinned: true }),
    // The two overflow cases, one per script. Both opened as tabs as well, so
    // the tab strip has to survive them too.
    file("file-long-cn", `${LONG_CN}.docx`, "doc", AUDIT_FOLDER_IDS.long, 1),
    file("file-long-en", `${LONG_EN}.pptx`, "slides", AUDIT_FOLDER_IDS.long, 4),
    // Never opened: lastOpenedAt null is its own row state.
    file("file-unopened", "Untitled document.docx", "doc", AUDIT_FOLDER_IDS.inbox, 0, {
      lastOpenedAt: null,
    }),
    file("file-scratch", "Scratch notes.docx", "doc", AUDIT_FOLDER_IDS.inbox, 21),
    ...bulk,
  ];
}

/**
 * Seven tabs. The strip overflows at any window width the shell supports, which
 * is the only way to see what it does about it.
 */
export const AUDIT_OPEN_FILE_IDS = [
  "file-plan",
  "file-forecast",
  "file-deck",
  "file-brief",
  "file-long-cn",
  "file-long-en",
  "file-scratch",
];

export const AUDIT_ACTIVE_FILE_ID = "file-plan";

/**
 * One task per folder, because the fake keys tasks by folder — and between them
 * they cover every `AgentStatus` the contract has.
 *
 * Note for S3/S6: there is no "failed" status. `AgentStatus` is
 * idle | reading | writing | working | paused | awaiting-review | done, and
 * failure is reported out-of-band as an `AgentEvent` of kind "error" (which
 * surfaces as a toast), not as a task row. A plan asking for a "failed task
 * row" is asking for something the contract cannot express.
 */
export function auditTasks(now = Date.now()): AgentTask[] {
  const message = (id: string, role: "user" | "agent", text: string, minutesAgo: number) => ({
    id,
    role,
    text,
    createdAt: now - minutesAgo * 60_000,
  });

  return [
    {
      id: "task-working",
      title: "Draft the launch checklist and fold it into the plan",
      folderId: AUDIT_FOLDER_IDS.launch,
      status: "working",
      phase: "Reading your instructions and the current file",
      steps: [
        { id: "step-1", label: "Read MO launch plan.docx", state: "done" },
        { id: "step-2", label: "Draft the checklist", state: "active" },
        { id: "step-3", label: "Apply to the document", state: "pending" },
      ],
      messages: [message("msg-1", "user", "Add a launch checklist to the plan.", 4)],
      suggestion: null,
      question: null,
    },
    {
      id: "task-review",
      title: "Refresh the Q3 forecast totals",
      folderId: AUDIT_FOLDER_IDS.bulk,
      status: "awaiting-review",
      phase: "Ready for your review",
      steps: [
        { id: "step-4", label: "Read Archive note 01.xlsx", state: "done" },
        { id: "step-5", label: "Recompute the totals", state: "done" },
      ],
      messages: [message("msg-2", "user", "Recompute the totals.", 40)],
      suggestion: {
        id: "suggestion-1",
        targetFileId: "file-forecast",
        summary: "Update the forecast rows in MO sales forecast.xlsx and refresh the linked totals.",
        applied: false,
        undoable: false,
      },
      question: null,
    },
    {
      id: "task-paused",
      title: "Summarise the interview notes",
      folderId: AUDIT_FOLDER_IDS.inbox,
      status: "paused",
      phase: "Paused",
      steps: [{ id: "step-6", label: "Read Scratch notes.docx", state: "active" }],
      messages: [message("msg-3", "user", "Summarise these.", 90)],
      suggestion: null,
      question: null,
    },
    {
      /*
       * A title with no natural break, in the script that has none either. The
       * task rows on Home and the panel header both have to clip this; it is the
       * single most likely place for a row to be destroyed by its own content.
       */
      id: "task-done",
      title: LONG_CN,
      folderId: AUDIT_FOLDER_IDS.long,
      status: "done",
      phase: "Finished",
      steps: [{ id: "step-7", label: "Wrote the summary", state: "done" }],
      messages: [message("msg-4", "agent", "Done — the summary is in the document.", 60 * 26)],
      suggestion: null,
      question: null,
    },
    {
      id: "task-idle",
      title: "Untitled task",
      folderId: AUDIT_FOLDER_IDS.empty,
      status: "idle",
      phase: "",
      steps: [],
      messages: [],
      suggestion: null,
      question: null,
    },
  ];
}

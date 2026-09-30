/**
 * The approved prototype's own sample workspace, for the in-memory port.
 *
 * Two projects, three conversations in the first, and the files those
 * conversations refer to — the same names, sources and ages the prototype
 * seeds (`v11/data.js`). It exists so a screen in the shell can be put next to
 * the same screen in the prototype and compared without first explaining away
 * a difference in content.
 *
 * Dev fixture only. Nothing here is a document: the files have names and
 * metadata and no bytes.
 */
import type { AgentTask, FileMeta, Folder } from "../../../shared/uiPort";

export const PROTOTYPE_FOLDER_IDS = {
  launch: "launch",
  quarter: "quarter",
  local: "local",
} as const;

export const PROTOTYPE_CHAT_IDS = { plan: "plan", sales: "sales", deck: "deck" } as const;

export function prototypeFolders(): Folder[] {
  return [
    { id: PROTOTYPE_FOLDER_IDS.launch, name: "MO product launch", path: "OfficeDex / Workspace / MO product launch" },
    { id: PROTOTYPE_FOLDER_IDS.quarter, name: "Quarterly review", path: "OfficeDex / Workspace / Quarterly review" },
    { id: PROTOTYPE_FOLDER_IDS.local, name: "Documents", path: "Documents", isDefault: true },
  ];
}

const MINUTE = 60_000;

export function prototypeFiles(now = Date.now()): FileMeta[] {
  const file = (
    id: string,
    name: string,
    type: FileMeta["type"],
    folderId: string,
    minutes: number,
    from?: string,
    origin?: string,
  ): FileMeta => ({
    id,
    name,
    type,
    folderId,
    createdAt: now - minutes * MINUTE - 3_600_000,
    updatedAt: now - minutes * MINUTE,
    lastOpenedAt: now - minutes * MINUTE,
    dirty: false,
    pinned: false,
    ...(from ? { artifactTaskId: from } : {}),
    ...(from || origin ? { originConversationId: from ?? origin } : {}),
  });
  const { launch, local } = PROTOTYPE_FOLDER_IDS;
  return [
    file("doc", "MO launch plan.docx", "doc", launch, 10, PROTOTYPE_CHAT_IDS.plan),
    file("sheet", "MO sales forecast.xlsx", "sheet", launch, 30, PROTOTYPE_CHAT_IDS.sales),
    file("slides", "MO launch deck.pptx", "slides", launch, 40, PROTOTYPE_CHAT_IDS.deck),
    file("brief", "Project brief.docx", "doc", local, 55),
    file("budget", "Launch budget.xlsx", "sheet", launch, 70, undefined, PROTOTYPE_CHAT_IDS.sales),
    file("legacydoc", "Archive proposal.doc", "doc", local, 80),
    file("legacysheet", "Archive budget.xls", "sheet", local, 90),
    file("legacyppt", "Archive presentation.ppt", "slides", local, 100),
    file("text", "Launch checklist.txt", "doc", launch, 110, undefined, PROTOTYPE_CHAT_IDS.plan),
    file("readme", "Project readme.md", "doc", launch, 120, PROTOTYPE_CHAT_IDS.plan),
    file("rich", "Formatted notes.rtf", "doc", local, 130),
    file("web", "Launch overview.html", "doc", local, 140),
    file("pdf", "Project handout.pdf", "doc", launch, 150, undefined, PROTOTYPE_CHAT_IDS.deck),
  ];
}

const idle = (id: string, title: string, folderId: string): AgentTask => ({
  id,
  conversationId: id,
  title,
  folderId,
  status: "idle",
  phase: "",
  steps: [],
  messages: [],
  suggestion: null,
  question: null,
});

/** The three conversations of "MO product launch", none spoken in yet. */
export function prototypeTasks(): AgentTask[] {
  const { launch } = PROTOTYPE_FOLDER_IDS;
  return [
    idle(PROTOTYPE_CHAT_IDS.plan, "Launch plan & copy", launch),
    idle(PROTOTYPE_CHAT_IDS.sales, "Sales forecast review", launch),
    idle(PROTOTYPE_CHAT_IDS.deck, "Launch presentation", launch),
  ];
}

const REQUEST = "Review the launch plan and clarify the next steps.";

/**
 * One run, in each of the states the standard describes — the prototype's
 * `?scenario=agent-<key>` review pages, as tasks (AGENT-STATE-STANDARD §03).
 */
export function prototypeRun(key: string, now = Date.now()): AgentTask | null {
  const phases = ["plan", "read", "edit", "check"] as const;
  const labels = ["Review the request", "Read the selected files", "Prepare changes", "Check the result"];
  const steps = (active: number | "all" | "none") =>
    phases.map((id, index) => ({
      id,
      label: labels[index],
      state:
        active === "all"
          ? ("done" as const)
          : active === "none"
            ? ("pending" as const)
            : index < active
              ? ("done" as const)
              : index === active
                ? ("active" as const)
                : ("pending" as const),
    }));
  const base: AgentTask = {
    id: "agent-demo",
    conversationId: PROTOTYPE_CHAT_IDS.plan,
    title: "Launch plan & copy",
    folderId: PROTOTYPE_FOLDER_IDS.launch,
    documentType: "docx",
    status: "working",
    phase: "",
    steps: steps(0),
    messages: [
      {
        id: "agent-demo:instruction",
        role: "user",
        text: REQUEST,
        reference: { fileId: "readme", label: "Project readme.md", text: "" },
        createdAt: now - 12_000,
      },
    ],
    suggestion: null,
    question: null,
    startedAt: now - 12_000,
    attempt: 1,
  };
  const suggestion = {
    id: "agent-demo",
    targetFileId: "readme",
    summary: "Clarify the next step and owner.",
    applied: false,
    undoable: false,
  };
  switch (key) {
    // Not a run: a conversation that has been spoken in, as the editor review pages show it.
    case "talk":
      return {
        ...idle(PROTOTYPE_CHAT_IDS.plan, base.title, base.folderId),
        messages: [
          {
            id: "talk:1",
            role: "user",
            text: "Summarize the launch priorities and check that every milestone has an owner.",
            createdAt: now - 60_000,
          },
          {
            id: "talk:2",
            role: "agent",
            text: "I’ve organized the priorities and highlighted the decisions that still need an owner.",
            createdAt: now - 50_000,
          },
        ],
      };
    case "planning":
      return base;
    case "reading":
      return { ...base, status: "reading", steps: steps(1) };
    case "working":
      return { ...base, status: "writing", steps: steps(2) };
    case "checking":
      return { ...base, status: "writing", steps: steps(3) };
    case "input":
      return {
        ...base,
        status: "awaiting-review",
        steps: steps("none"),
        question: {
          id: "agent-demo-question",
          text: "Who is this document for?",
          options: [
            { id: "team", label: "Project team" },
            { id: "leadership", label: "Leadership" },
            { id: "customers", label: "Customers" },
          ],
          allowFreeform: true,
        },
      };
    case "review":
      return { ...base, status: "awaiting-review", steps: steps("all"), suggestion, finishedAt: now };
    case "complete":
      return { ...base, id: PROTOTYPE_CHAT_IDS.plan, status: "done", outcome: "completed", steps: steps("all"), finishedAt: now };
    case "stopped":
      return {
        ...base,
        status: "done",
        outcome: "stopped",
        steps: steps("none"),
        error: "Stopped. Completed steps and your files are kept.",
        finishedAt: now,
      };
    case "failed":
      return {
        ...base,
        status: "done",
        outcome: "failed",
        // A timeout is not a configuration problem, so it offers no "Models".
        failureKind: "other",
        steps: steps("none"),
        error: "The model did not respond in time. Your files are unchanged.",
        finishedAt: now,
      };
    case "partial":
      return {
        ...base,
        status: "done",
        outcome: "partial",
        steps: steps("all"),
        suggestion,
        error: "One file needs another attempt. The available changes are ready to review.",
        finishedAt: now,
      };
    case "offline":
      return {
        ...base,
        status: "done",
        outcome: "interrupted",
        failureKind: "network",
        steps: steps("none"),
        error: "Connection lost. Your files and completed results are kept.",
        finishedAt: now,
      };
    default:
      return null;
  }
}

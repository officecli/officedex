import type { Artifact, DesktopTask, DocumentType } from "../shared/types";
import { DOCUMENT_TYPES, getCapability } from "../shared/types";

export type NavKey = "dialogue" | "tasks" | "artifacts" | "templates" | "settings" | "login";

export const documentTypeOptions: Array<{ value: DocumentType; label: string; icon: string }> = DOCUMENT_TYPES.map((type) => {
  const capability = getCapability(type);
  return { value: capability.type, label: capability.label, icon: capability.icon };
});

export const recentTasks = [
  { id: "Task-ID-0921", title: "2024 Q3 Financial Analysis Report", type: "Financial Report Template", status: "Completed", runtime: "Production", updatedAt: "2024-10-24 14:30", artifacts: 2 },
  { id: "Task-ID-0922", title: "User Survey Generation - Group A", type: "Survey Template", status: "Running", runtime: "Local Test", updatedAt: "2024-10-24 15:45", artifacts: 0 },
  { id: "Task-ID-0920", title: "Competitive Analysis Data Summary", type: "Data Chart", status: "Failed", runtime: "Production", updatedAt: "2024-10-23 09:12", artifacts: 1 },
];

export const templateCards = [
  { icon: "drive_presentation", title: "Business Review PPT", desc: "For quarterly business reviews, summaries, and management reporting.", category: "Reports" },
  { icon: "summarize", title: "Weekly Report", desc: "Auto-organize progress, risks, blockers, and next week's plan.", category: "Reports" },
  { icon: "article", title: "Product Requirements Doc (PRD)", desc: "Covers background, goals, flows, tracking, and acceptance criteria.", category: "Dev & PM" },
  { icon: "campaign", title: "Marketing Campaign Plan", desc: "From target audience and channel strategy to conversion path, generated in one click.", category: "Plans" },
  { icon: "query_stats", title: "Industry Research Outline", desc: "Generate structured research frameworks, competitor dimensions, and data standards.", category: "Plans" },
  { icon: "record_voice_over", title: "Meeting Minutes Summary", desc: "Extract decisions, owners, action items, and timelines.", category: "Reports" },
];

export const mockArtifacts: Artifact[] = [
  {
    taskId: "task-demo-1",
    filePath: "/Users/luyang/Documents/OfficeDex/2024_Q3_Marketing_Strategy_Report_v2.docx",
    fileName: "2024_Q3_Marketing_Strategy_Report_v2.docx",
    documentType: "docx",
    previewUrl: "https://platform.officecli.io/files/demo-q3",
    syncedAt: "Today 14:30",
  },
  {
    taskId: "task-demo-2",
    filePath: "/Users/luyang/Documents/OfficeDex/auth_middleware_controller.ts",
    fileName: "auth_middleware_controller.ts",
    documentType: "code",
    syncedAt: "Yesterday 09:15",
  },
  {
    taskId: "task-demo-3",
    filePath: "/Users/luyang/Documents/OfficeDex/Homepage_Hero_Banner_Concept.png",
    fileName: "Homepage_Hero_Banner_Concept.png",
    documentType: "img",
    syncedAt: "Oct 24",
  },
  {
    taskId: "task-demo-4",
    filePath: "/Users/luyang/Documents/OfficeDex/User_Behavior_Analysis_Q3.csv",
    fileName: "User_Behavior_Analysis_Q3.csv",
    documentType: "xlsx",
    syncedAt: "Oct 22",
  },
];

export const demoCompletedTask: DesktopTask = {
  id: "task-demo-completed",
  status: "completed",
  topic: "2024 Q3 Marketing Strategy Analysis Report",
  documentType: "pptx",
  events: [
    { event_id: "demo-1", task_id: "task-demo-completed", type: "task.started", payload: { message: "Request received" } },
    { event_id: "demo-2", task_id: "task-demo-completed", type: "task.progress", payload: { message: "Content structure generated" } },
    { event_id: "demo-3", task_id: "task-demo-completed", type: "task.completed", payload: { message: "Generation complete" } },
  ],
  artifact: {
    taskId: "task-demo-completed",
    filePath: "/Users/luyang/Documents/OfficeDex/2024_Q3_Marketing_Strategy_Report.pdf",
    fileName: "2024_Q3_Marketing_Strategy_Report.pdf",
    documentType: "pdf",
    previewUrl: "https://platform.officecli.io/files/q3-marketing",
  },
};

export const executionSteps = [
  { title: "Parsing instructions", detail: "Key topics identified: cloud services market analysis, Q3, Asia-Pacific, competitors", status: "finish" },
  { title: "Searching knowledge base", detail: "Searching for 2024 Q3 market data reports (1.2s elapsed)", status: "finish" },
  { title: "Building report outline", detail: "Organizing chapter logic, allocating comparison dimensions...", status: "process" },
  { title: "Formatting output", detail: "Applying layout styles and generating final document", status: "wait" },
] as const;

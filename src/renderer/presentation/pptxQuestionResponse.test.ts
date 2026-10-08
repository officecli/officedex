import { describe, expect, it } from "vitest";
import type { DesktopTask, VibeTreeStage } from "../../shared/types";
import { responseForPptxQuestion } from "./pptxQuestionResponse";

function vibeTask(stage: VibeTreeStage, nodeKinds: string[]): DesktopTask {
  return {
    id: "task-1",
    conversationId: "task-1",
    documentType: "pptx",
    status: "question",
    events: [],
    question: { id: "question-1", question: "Continue?", options: [], allowFreeform: true },
    vibeTree: {
      stage,
      actions: [],
      tree: {
        id: "tree-1",
        rootId: "root-node",
        title: "Launch deck",
        nodes: nodeKinds.map((kind, index) => ({ id: index === 0 ? "root-node" : `node-${index}`, kind, title: kind })),
      },
    },
  };
}

describe("responseForPptxQuestion", () => {
  it("confirms the initial Vibe idea with the structured node payload", () => {
    expect(responseForPptxQuestion(vibeTask("story_ready", ["root"]))).toEqual({
      taskId: "task-1",
      questionId: "question-1",
      answer: JSON.stringify({ kind: "vibe_node_confirmed", nodeId: "root-node" }),
    });
  });

  it.each([
    ["story_ready", ["root", "branch"], "generate_chapters"],
    ["outline_ready", ["root", "branch", "slide_group"], "generate_outline"],
    ["refined_ready", ["root", "outline"], "generate_slides"],
    ["slides_ready", ["root", "slide"], "finish_deck"],
  ] as const)("maps %s to its typed action", (stage, nodeKinds, optionId) => {
    expect(responseForPptxQuestion(vibeTask(stage, [...nodeKinds]))).toEqual({
      taskId: "task-1",
      questionId: "question-1",
      optionId,
    });
  });

  it("keeps the legacy plain-question response when no Vibe gate is active", () => {
    const task: DesktopTask = { id: "task-1", conversationId: "task-1", status: "question", events: [] };
    expect(responseForPptxQuestion(task, "event-question")).toEqual({
      taskId: "task-1",
      questionId: "event-question",
      answer: "continue",
    });
  });
});

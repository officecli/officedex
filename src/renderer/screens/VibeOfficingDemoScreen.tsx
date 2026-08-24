import { Tag } from "antd";
import { Button } from "@vo-ui/backend";
import { Presentation, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { DesktopTask, VibeProjectTreeNode, VibeTreeSnapshot, VibeTreeStage } from "../../shared/types";
import { LivingTreeCockpit } from "./DialogueScreens";
import type { VibeCanvasNodeKind } from "./DialogueScreens";
import { ImeTextArea } from "../components/ImeInput";

const DEFAULT_IDEA = "I want to explain why we need to rebuild our internal knowledge base";

const DEMO_STAGES: Array<{
  stage: VibeTreeStage;
  label: string;
  description: string;
  actionLabel?: string;
  progressIndex: number;
  confirmableKinds: VibeCanvasNodeKind[];
  phase: "story" | "chapter" | "outline" | "slide" | "deck";
}> = [
  { stage: "story_ready", label: "Story Beat", description: "Confirm story branches, then generate Chapters.", actionLabel: "Generate Chapters", progressIndex: 1, confirmableKinds: ["branch"], phase: "story" },
  { stage: "outline_ready", label: "Chapter", description: "Confirm chapter groups, then generate per-page Outlines.", actionLabel: "Generate Outline", progressIndex: 2, confirmableKinds: ["slide_group"], phase: "chapter" },
  { stage: "refined_ready", label: "Outline", description: "Confirm page titles, outlines, and visual assets, then generate Slides.", actionLabel: "Generate Slides", progressIndex: 3, confirmableKinds: ["outline"], phase: "outline" },
  { stage: "rendering", label: "Slide", description: "Confirm generated Slides, then assemble Deck.", actionLabel: "Assemble Deck", progressIndex: 4, confirmableKinds: ["generated_slide"], phase: "slide" },
  { stage: "completed", label: "Deck", description: "Complete PPTX is ready for final review.", progressIndex: 5, confirmableKinds: ["deck"], phase: "deck" },
];

const storyBranches: Array<{
  id: string;
  title: string;
  summary: string;
  materials: string[];
  intent: string;
  slides: Array<{
    number: number;
    groupTitle: string;
    title: string;
    summary: string;
    outline: string[];
    visualAssets?: VibeProjectTreeNode["visualAssets"];
  }>;
}> = [
  {
    id: "current",
    title: "Current State: Scattered Knowledge Is Slowing Decisions",
    summary: "The team has plenty of documents and experience, but critical decisions still rely on manual inquiries and repeated sync-ups.",
    materials: ["Old knowledge base screenshots", "Project retrospective excerpts"],
    intent: "Show decision-makers the problem isn't lack of content — it's the high cost of knowledge circulation.",
    slides: [
      {
        number: 1,
        groupTitle: "Why We Must Rebuild Now",
        title: "Rebuilding the Knowledge Base Is Essential for Decision Efficiency",
        summary: "Illustrate the decision friction caused by scattered knowledge through a concrete work scenario.",
        outline: ["Knowledge reserves are sufficient, but critical decisions still depend on manual sync.", "Legacy workflows are amplifying time costs and judgment errors.", "Rebuilding the knowledge base must become a near-term priority."],
        visualAssets: [{ kind: "image", description: "Old knowledge base screenshots / team feedback screenshots showing scattered information entry points" }],
      },
      {
        number: 2,
        groupTitle: "Legacy Knowledge Workflows",
        title: "Legacy Knowledge Workflows Are Creating Alignment Costs",
        summary: "Show the disconnect between existing documents, meeting sync-ups, and manual inquiries.",
        outline: ["Materials are scattered across documents, meeting notes, and personal experience.", "Teams must repeatedly verify which version and context is usable.", "Collaboration shifts from advancing work to re-explaining information."],
        visualAssets: [{ kind: "chart", description: "Knowledge flow breakpoint diagram showing gaps between documents, meeting sync, and manual inquiries" }],
      },
    ],
  },
  {
    id: "problem",
    title: "Problem: Hidden Costs Are Underestimated",
    summary: "Repeated questions, version inconsistencies, and expert bottlenecks stall teams at critical junctures.",
    materials: ["Team interviews", "Meeting notes"],
    intent: "Turn abstract inconveniences into actionable risks.",
    slides: [
      {
        number: 3,
        groupTitle: "Repeated Questions Are Draining the Team",
        title: "Hidden Cost 1: Search and Repeated Questions Consume Attention",
        summary: "Use frequently asked questions from team interviews to show knowledge isn't being effectively reused.",
        outline: ["Every lookup requires searching across multiple systems.", "Similar questions keep circling back to the same experts.", "Redundant communication is consuming high-value attention."],
        visualAssets: [{ kind: "chart", description: "Bar chart comparing time spent searching for materials before vs. after" }],
      },
      {
        number: 4,
        groupTitle: "Version Inconsistency Causes Judgment Errors",
        title: "Hidden Cost 2: Version Inconsistency Makes Judgments Unreliable",
        summary: "Compare material versions across different entry points to show decision inputs are unstable.",
        outline: ["The same question yields different answers from different sources.", "Judgments are based on outdated or context-lacking materials.", "Version discrepancies ultimately become decision errors."],
        visualAssets: [{ kind: "chart", description: "Version discrepancy comparison table showing update timestamps and calibration gaps across sources" }],
      },
      {
        number: 5,
        groupTitle: "Expert Bottleneck Stalls Key Milestones",
        title: "Hidden Cost 3: Expert Bottleneck Stalls Critical Milestones",
        summary: "Convert the cost of a few people repeatedly explaining into project progression risk.",
        outline: ["A few experts shoulder excessive explanation work.", "Key milestones must wait for manual context to be filled in.", "Project cadence is dragged down by knowledge bottlenecks."],
      },
    ],
  },
  {
    id: "solution",
    title: "Solution: Rebuilding the Knowledge Base Is a Decision Efficiency Upgrade",
    summary: "Use a unified portal, structured capture, and AI-powered search to turn knowledge into reusable work assets.",
    materials: ["New proposal draft", "Competitor references"],
    intent: "Converge to a clear action: approve the rebuild and start with high-frequency scenarios.",
    slides: [
      {
        number: 6,
        groupTitle: "Core Principles of the New Knowledge Base",
        title: "The New Knowledge Base Must Upgrade from a Document Repository to a Decision System",
        summary: "Propose three design principles: unified portal, structured capture, and scenario-based search.",
        outline: ["A unified portal lowers search costs.", "Structured capture binds evidence to conclusions.", "Scenario-based search brings reuse closer to action."],
      },
      {
        number: 7,
        groupTitle: "Start with High-Frequency Scenarios",
        title: "Validate Benefits with Three High-Frequency Scenarios First",
        summary: "Explain Phase 1 selection of project retrospectives, requirement reviews, and proposal reuse.",
        outline: ["Project retrospectives capture reusable experience.", "Requirement reviews unify judgment criteria.", "Proposal reuse shortens the path from materials to delivery."],
        visualAssets: [{ kind: "chart", description: "Pilot roadmap showing high-frequency scenarios, owners, and milestone goals" }],
      },
      {
        number: 8,
        groupTitle: "How AI Turns Knowledge into Action",
        title: "AI Organizes Materials into Insights, Evidence, and Next Steps",
        summary: "Show the AI path from raw materials to distilled conclusions, evidence, and actionable recommendations.",
        outline: ["Distill insights from scattered materials.", "Link insights to evidence and sources.", "Output action-oriented next-step recommendations."],
        visualAssets: [{ kind: "image", description: "AI-assisted workflow diagram marking materials, insights, evidence, and action recommendations" }],
      },
      {
        number: 9,
        groupTitle: "Decisions and Resources Needed",
        title: "Decisions, Resources, and Pilot Cadence to Confirm Today",
        summary: "Converge to budget, owner, timeline, and pilot success metrics.",
        outline: ["Confirm rebuilding the knowledge base as a near-term priority.", "Define the owner, budget, and pilot scope.", "Use pilot metrics to determine next-phase investment."],
      },
    ],
  },
];

export function VibeOfficingDemoScreen() {
  const [idea, setIdea] = useState(DEFAULT_IDEA);
  const [submittedIdea, setSubmittedIdea] = useState(DEFAULT_IDEA);
  const [stageIndex, setStageIndex] = useState(-1);
  const snapshot = useMemo(() => {
    if (stageIndex < 0) return null;
    return buildDemoSnapshot(submittedIdea, DEMO_STAGES[stageIndex]);
  }, [stageIndex, submittedIdea]);
  const activeStage = stageIndex >= 0 ? DEMO_STAGES[stageIndex] : null;
  const task = useMemo<DesktopTask>(() => ({
    id: "vibe-demo-task",
    conversationId: "vibe-demo-task",
    status: snapshot?.stage === "completed" ? "completed" : "question",
    documentType: "pptx",
    topic: submittedIdea,
    events: [],
    question: {
      id: `demo-${snapshot?.stage ?? "idea"}`,
      question: "Demo",
      allowFreeform: true,
      options: [],
    },
    vibeTree: snapshot ?? undefined,
  }), [snapshot, submittedIdea]);

  function startDemo() {
    setSubmittedIdea(idea.trim() || DEFAULT_IDEA);
    setStageIndex(0);
  }

  return (
    <main className="vibe-demo-shell">
      <header className="vibe-demo-header">
        <div>
          <span>OfficeDex Vibe-Officing Demo</span>
          <h1>From a Single Idea to a Complete PPTX</h1>
        </div>
        <Tag color="purple">React Flow Cockpit</Tag>
      </header>

      {stageIndex < 0 ? (
        <section className="vibe-demo-start">
          <div className="vibe-demo-start-copy">
            <Sparkles size={18} />
            <strong>Start with a rough PPT idea.</strong>
            <p>OfficeDex won't generate a file directly — it first organizes your idea into a traceable project tree.</p>
          </div>
          <ImeTextArea
            value={idea}
            onValueChange={setIdea}
            autoSize={{ minRows: 3, maxRows: 5 }}
          />
          <Button type="primary" icon={<Presentation size={16} />} onClick={startDemo}>
            Generate Project Tree
          </Button>
        </section>
      ) : snapshot ? (
        <section className="vibe-demo-canvas-shell">
          <div className="vibe-demo-stagebar">
            <div>
              <span>{DEMO_STAGES[stageIndex].label}</span>
              <strong>{DEMO_STAGES[stageIndex].description}</strong>
            </div>
            <Tag color="purple">Confirm nodes to continue growing</Tag>
          </div>
          <LivingTreeCockpit
            task={task}
            snapshot={snapshot}
            progressIndex={activeStage?.progressIndex}
            confirmableKinds={activeStage?.confirmableKinds}
            stageActionLabel={activeStage?.actionLabel}
            onStageAction={activeStage?.actionLabel ? () => setStageIndex((value) => Math.min(DEMO_STAGES.length - 1, value + 1)) : undefined}
          />
        </section>
      ) : null}
    </main>
  );
}

function buildDemoSnapshot(idea: string, stageConfig: typeof DEMO_STAGES[number]): VibeTreeSnapshot {
  return {
    stage: stageConfig.stage,
    tree: {
      id: "demo-tree",
      rootId: "root",
      title: idea,
      direction: "Default lens: seeking approval / executive-facing version",
      nodes: buildDemoNodes(idea, stageConfig.phase),
    },
    actions: [],
  };
}

function buildDemoNodes(idea: string, phase: typeof DEMO_STAGES[number]["phase"]): VibeProjectTreeNode[] {
  const nodes: VibeProjectTreeNode[] = [
    {
      id: "root",
      kind: "root",
      title: idea,
      summary: "A raw, unstructured PPT request.",
      intent: "Organize a rough idea into a deliverable Office work product.",
    },
  ];
  if (phase === "story" || phase === "chapter" || phase === "outline" || phase === "slide" || phase === "deck") {
    for (const branch of storyBranches) {
      nodes.push({
        id: `branch-${branch.id}`,
        parentId: "root",
        kind: "branch",
        title: branch.title,
        summary: branch.summary,
        materials: branch.materials,
        intent: branch.intent,
      });
    }
  }
  if (phase === "chapter" || phase === "outline" || phase === "slide" || phase === "deck") {
    for (const branch of storyBranches) {
      const groupId = `group-${branch.id}`;
      nodes.push({
        id: groupId,
        parentId: `branch-${branch.id}`,
        kind: "slide_group",
        title: branch.id === "current" ? "Context Setting" : branch.id === "problem" ? "Problem Breakdown" : "Solution Convergence",
        summary: branch.summary,
        slideRange: `${branch.slides[0].number}-${branch.slides.at(-1)?.number}`,
        materials: branch.materials,
        intent: branch.intent,
      });
      if (phase === "chapter") continue;
      for (const slide of branch.slides) {
        nodes.push({
          id: `outline-${slide.number}`,
          parentId: groupId,
          kind: "slide",
          title: phase === "outline" ? slide.title : slide.title,
          summary: phase === "slide" || phase === "deck" ? `Page generated: ${slide.summary}` : slide.summary,
          slideNumber: slide.number,
          outline: phase === "outline" || phase === "slide" || phase === "deck" ? slide.outline : undefined,
          visualAssets: phase === "outline" || phase === "slide" || phase === "deck" ? slide.visualAssets : undefined,
          trace: ["root", `branch-${branch.id}`, groupId],
        });
      }
    }
  }
  return nodes;
}

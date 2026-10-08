import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Artifact, TimelineDeck, TimelineNode, VibeOp } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import { attachPartialWork } from "../taskState";
import { buildReplayFeed, hasPptxDrawingContent, liveDraftFor, registerLiveDraft, type LiveDraft, type VibeReplayFeed } from "../presentation/vibeReplay";
import { loadNexaEdgeOps, NEXAEDGE_DEMO_ID } from "../presentation/bundledPptxDemo";
import { pptxPartialWork } from "../presentation/pptxRuntimeActivity";
import { toast } from "../ui";
import { errorMessage } from "../utils/values";
import { classifyError, extractStderr, type FailureKind } from "../failureKind";
import type { DocumentSessionController } from "./useDocumentSession";

export interface PptxLiveDraftDeps {
  readonly session: DocumentSessionController;
  readonly recordError: (text: string, kind: FailureKind, details?: string) => void;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}

export interface PptxLiveDraftController {
  /** The live draft behind the deck on screen, if that deck is one. */
  readonly liveDraft: LiveDraft | undefined;
  /** Which recorded node is on screen; null means the newest deck. */
  readonly timelineNodeId: string | null;
  readonly setTimelineNodeId: (nodeId: string | null) => void;
  /** The task whose timeline is being shown, live draft first. */
  readonly timelineTaskId: string | undefined;
  readonly openTimelineNode: (deck: TimelineDeck, node: TimelineNode) => Promise<void>;
  readonly returnToLatestDeck: () => Promise<void>;
  /** The feed the editor draws from, or undefined when the deck is not live. */
  readonly replayFeed: VibeReplayFeed | undefined;
  readonly replayBundledDemo: () => Promise<void>;
  readonly replayPreviewDemo: () => void;
  readonly bundledDemoLoading: boolean;
}

/**
 * The live pptx canvas: the draft the runtime draws into, the replay feed that
 * animates it, and the timeline over what it produced.
 *
 * Three rules worth naming, because each of them was a bug first:
 *
 * - The outline arriving is not authorisation to draw. The user still has to
 *   review it, so the first actual drawing op is the planning/authoring
 *   boundary and the only automatic trigger for the canvas. Only a still-active
 *   task qualifies: history replay on page load restores finished tasks'
 *   primitives in the same batch, and redrawing a finished deck looks like a
 *   phantom generation (R-E-01).
 *
 * - The feed belongs to the document on screen, not to the app. Keying it off
 *   one app-wide task id meant every pptx opened after a generation inherited
 *   that task's whole op stream and replayed it onto a document that already
 *   contained those objects (R-E-06).
 *
 * - A live draft is always a performance, even when the editor finishes booting
 *   after the backend already emitted the complete stream. Treating that as
 *   historical catch-up makes the whole deck appear at once (R-E-07).
 */
export function usePptxLiveDraft({ session, recordError, t }: PptxLiveDraftDeps): PptxLiveDraftController {
  const api = useDesktopApi();
  const { state, update } = useTaskStore();
  const [timelineNodeId, setTimelineNodeId] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState(false);
  // An op stream handed straight to the replay with no task behind it — a
  // recovered recording, or one captured from a run that is long gone.
  const [replayOps, setReplayOps] = useState<VibeOp[] | undefined>();
  const [bundledDemoLoading, setBundledDemoLoading] = useState(false);

  const { grant, artifact, open, adopt } = session;
  const liveDraft = artifact?.filePath ? liveDraftFor(artifact.filePath) : undefined;
  const timelineTaskId = liveDraft?.taskId ?? artifact?.taskId ?? undefined;

  const openTimelineNode = useCallback(async (deck: TimelineDeck, node: TimelineNode) => {
    await open({
      taskId: timelineTaskId ?? "",
      filePath: deck.filePath,
      fileName: deck.fileName,
      documentType: "pptx",
    } as Artifact);
    setTimelineNodeId(node.id);
  }, [open, timelineTaskId]);

  const returnToLatestDeck = useCallback(async () => {
    const latest = timelineTaskId ? state.tasks[timelineTaskId]?.artifact : undefined;
    if (!latest?.filePath) return;
    await open(latest);
    setTimelineNodeId(null);
  }, [open, state.tasks, timelineTaskId]);

  // Read through refs inside the async draft creation below: the state and the
  // open-ness of the session both move while the RPCs are in flight.
  const stateRef = useRef(state);
  stateRef.current = state;
  const attemptsRef = useRef<Set<string>>(new Set());
  const sessionOpenRef = useRef(false);
  sessionOpenRef.current = Boolean(grant);

  const liveCandidateTaskId = useMemo(() => {
    for (const taskID of state.taskOrder) {
      const task = state.tasks[taskID];
      if (task && hasPptxDrawingContent(task.vibeOps) && ["starting", "running"].includes(task.status)) {
        return taskID;
      }
    }
    return null;
  }, [state]);

  useEffect(() => {
    if (!liveCandidateTaskId || attemptsRef.current.has(liveCandidateTaskId)) return;
    if (sessionOpenRef.current) return;
    attemptsRef.current.add(liveCandidateTaskId);
    void (async () => {
      try {
        const draft = await api.createLivePptxDraft(liveCandidateTaskId);
        registerLiveDraft(draft.filePath, liveCandidateTaskId);
        const nextArtifact = {
          taskId: liveCandidateTaskId,
          filePath: draft.filePath,
          fileName: draft.fileName,
          documentType: "pptx",
        } as Artifact;
        const issued = await api.issuePreviewToken(nextArtifact);
        // Re-check: the run may have finished, or something else may have taken
        // the session, while the two RPCs above were in flight.
        const latestTask = stateRef.current.tasks[liveCandidateTaskId];
        if (!latestTask || !["starting", "running"].includes(latestTask.status) || sessionOpenRef.current) return;
        adopt(issued, nextArtifact);
        setLiveTrace(false);
      } catch (error) {
        attemptsRef.current.delete(liveCandidateTaskId);
        const message = errorMessage(error);
        recordError(`Live PPTX drawing could not start: ${message}`, classifyError(message), extractStderr(message));
      }
    })();
  }, [adopt, api, liveCandidateTaskId, recordError]);

  // A run that stops mid-draw leaves a real file behind: the editor session
  // saved every page it had drawn before the failure fired. Commit it as the
  // partial artifact so the failed state can offer to open and to change it,
  // instead of pretending the run produced nothing (R-E-03).
  useEffect(() => {
    if (!artifact?.filePath || !artifact.taskId) return;
    const task = state.tasks[artifact.taskId];
    if (!task || !["failed", "cancelled"].includes(task.status)) return;
    if (task.partialArtifact?.filePath === artifact.filePath) return;
    update((current) => attachPartialWork(current, artifact.taskId!, {
      partialArtifact: artifact,
      partial: pptxPartialWork(task),
    }));
  }, [artifact, state.tasks, update]);

  const startReplay = useCallback(async (target: string, ops?: VibeOp[], opCount = ops?.length ?? 0) => {
    const finish = (message: string) => {
      console.info("[vibeReplayDemo]", message);
      return message;
    };
    attemptsRef.current.delete(target);
    if (grant) await api.revokePreviewToken(grant.token).catch(() => {});
    const draft = await api.createLivePptxDraft(target);
    registerLiveDraft(draft.filePath, target);
    const nextArtifact = { taskId: target, filePath: draft.filePath, fileName: draft.fileName, documentType: "pptx" } as Artifact;
    const issued = await api.issuePreviewToken(nextArtifact);
    adopt(issued, nextArtifact);
    setReplayOps(ops);
    setLiveTrace(true);
    const from = ops ? "a recording" : `task ${target}`;
    return finish(`replaying ${opCount} ops of ${from} from a blank draft — each op is logged before it executes`);
  }, [adopt, api, grant]);

  // `__officedexReplayDemo()` in the console replays a task's drawing from a
  // fresh blank draft: the live-generation experience on demand, no model
  // calls, no credits. It bypasses the active-status guard on purpose.
  const replayDemoRef = useRef<(source?: string | VibeOp[]) => Promise<string>>(async () => "not ready");
  replayDemoRef.current = async (source?: string | VibeOp[]) => {
    const finish = (message: string) => {
      // The command is usually invoked bare in the console, so the resolved
      // value would go unseen; announce it there as well.
      console.info("[vibeReplayDemo]", message);
      return message;
    };
    if (source === NEXAEDGE_DEMO_ID || source === "nexaedge") {
      return startReplay(NEXAEDGE_DEMO_ID, await loadNexaEdgeOps());
    }
    const loaded =
      typeof source === "string" && /^(https?:)?\//.test(source)
        ? ((await (await fetch(source)).json()) as VibeOp[])
        : Array.isArray(source)
          ? source
          : undefined;
    if (loaded) return startReplay(`recording-${loaded.length}`, loaded);
    const taskId = typeof source === "string" ? source : undefined;
    const current = stateRef.current;
    const target = taskId ?? current.taskOrder.find((id) => (current.tasks[id]?.vibeOps?.length ?? 0) > 0);
    if (!target) {
      return finish("no task with drawing ops in this session — open the generated document first, then rerun __officedexReplayDemo()");
    }
    const task = current.tasks[target];
    if (!task) return finish(`unknown task: ${target}`);
    const opCount = task.vibeOps?.length ?? 0;
    if (opCount === 0) return finish(`task ${target} has no drawing ops`);
    return startReplay(target, undefined, opCount);
  };

  useEffect(() => {
    const host = window as unknown as { __officedexReplayDemo?: (source?: string | VibeOp[]) => Promise<string> };
    host.__officedexReplayDemo = (source?: string | VibeOp[]) => replayDemoRef.current(source);
    return () => {
      delete host.__officedexReplayDemo;
    };
  }, []);

  const replayBundledDemo = useCallback(async () => {
    setBundledDemoLoading(true);
    try {
      await replayDemoRef.current(NEXAEDGE_DEMO_ID);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBundledDemoLoading(false);
    }
  }, []);

  // The same replay behind a button in the preview's title bar. It always shows
  // — a debug affordance nobody can find is worse than one that reports an
  // empty session — and it replays the deck on screen and nothing else: the
  // console command's "any task that has ops" fallback would quietly draw a
  // different deck than the one that was clicked (R-E-08).
  const replayTaskId = artifact?.taskId;
  const replayOpCount = replayTaskId ? state.tasks[replayTaskId]?.vibeOps?.length ?? 0 : 0;
  const replayPreviewDemo = useCallback(() => {
    if (replayTaskId === NEXAEDGE_DEMO_ID) {
      void replayBundledDemo();
      return;
    }
    if (!replayTaskId || replayOpCount === 0) {
      toast.warning(t("pptx.agent.replayDemoNoOps"));
      return;
    }
    void replayDemoRef.current(replayTaskId).then((result) => toast.info(result));
  }, [replayBundledDemo, replayOpCount, replayTaskId, t]);

  const replayFeed = useMemo(
    () =>
      liveDraft
        ? buildReplayFeed({
          draft: liveDraft,
          ops: replayOps,
          performing: true,
          trace: liveTrace,
          task: state.tasks[liveDraft.taskId],
        })
        : undefined,
    [liveDraft, liveTrace, replayOps, state.tasks],
  );

  return {
    liveDraft,
    timelineNodeId,
    setTimelineNodeId,
    timelineTaskId,
    openTimelineNode,
    returnToLatestDeck,
    replayFeed,
    replayBundledDemo,
    replayPreviewDemo,
    bundledDemoLoading,
  };
}

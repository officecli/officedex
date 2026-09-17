import { useCallback, useEffect, useMemo, useState } from "react";
import type { RecentFile } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import { deleteTask } from "../taskState";
import { computeTaskSignals, failedTaskIds, readSeenFailures, sidebarSignal, writeSeenFailures, type SidebarSignal } from "../taskSignals";
import { taskTitle } from "../taskTitle";
import { documentTypeFromTask } from "./useGeneration";
import { toast } from "../ui";
import { errorMessage } from "../utils/values";
import { BRIDGE_ERROR_CODES, errorCode } from "../failureKind";
import { fileExtension, fileNameFromPath } from "../utils/path";
import type { useRecentFiles } from "../useRecentFiles";
import type { DocumentSessionController } from "./useDocumentSession";
import type { AppRoutingController } from "./useAppRouting";

/**
 * One row of the document list: a recent file, or a run that has not produced
 * one yet. Defined here rather than on the component that renders it — the view
 * is going to be replaced and this shape is not.
 */
export interface SidebarDocument {
  id: string;
  createdAt?: string;
  title: string;
  documentType: string;
  filePath?: string;
  conversationId?: string;
  workspaceId?: string;
  status?: "starting" | "running" | "question" | "plan_review" | "completed" | "failed" | "cancelled";
}

/** How many rows the sidebar keeps. */
const SIDEBAR_LIMIT = 40;

/** "Open file" edits in place, so only editable formats are offered (R-D-07). */
export const OPEN_LOCAL_FILE_TYPES = ["docx", "xlsx", "pptx"];

function taskCreatedTimestamp(document: SidebarDocument): number {
  if (!document.createdAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(document.createdAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortSidebarDocuments(documents: SidebarDocument[]): SidebarDocument[] {
  return [...documents].sort((a, b) => {
    const aTime = taskCreatedTimestamp(a);
    const bTime = taskCreatedTimestamp(b);
    if (aTime !== bTime) return bTime - aTime;
    return a.id.localeCompare(b.id);
  });
}

function isWorkbookFile(file: RecentFile): boolean {
  return file.documentType.toLowerCase() === "xlsx" || file.fileName.toLowerCase().endsWith(".xlsx");
}

function isUnsupported(message: string): boolean {
  return message.toLowerCase().includes("unsupported preview file type");
}

function isMissing(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("recent file is unavailable") || normalized.includes("no such file") || normalized.includes("not found");
}

function isPermissionDenied(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("permission") || normalized.includes("access denied");
}

export interface DocumentLibraryDeps {
  readonly recent: ReturnType<typeof useRecentFiles>;
  readonly session: DocumentSessionController;
  readonly routing: AppRoutingController;
  readonly homeWorkspaceId: string | undefined;
  /** Opens a workbook in the spreadsheet workspace. Returns whether it opened. */
  readonly openWorkbookFile: (file: RecentFile) => Promise<boolean>;
  readonly clearError: () => void;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}

export interface DocumentLibraryController {
  /** Recent files and live runs, folded into one list the sidebar renders. */
  readonly documents: SidebarDocument[];
  /** One badge, highest urgency first: needs-you > running > unseen failures. */
  readonly signal: SidebarSignal | undefined;
  /** Tell the library the activity list is on screen, so failures count as seen. */
  readonly setActivityVisible: (visible: boolean) => void;
  readonly openRecentFile: (file: RecentFile) => Promise<void>;
  readonly openLocalFile: () => Promise<void>;
  readonly openDocument: (document: SidebarDocument) => void;
  readonly removeRecentFile: (filePath: string) => Promise<void>;
  readonly deleteDocument: (document: SidebarDocument) => Promise<void>;
  readonly deleteDocuments: (documents: SidebarDocument[]) => Promise<void>;
}

/**
 * The list of things the user can open, and what removing one means.
 *
 * Files and runs are one list rather than two. A run that produced a file is
 * that file's row, so the artifact path is the identity and a task without one
 * only appears while it is still active or has just failed. Local files carry
 * no task creation time, so their persisted open time stands in — otherwise a
 * newly opened file sorts to the bottom and falls off the row limit (R-C-14).
 */
export function useDocumentLibrary({
  recent,
  session,
  routing,
  homeWorkspaceId,
  openWorkbookFile,
  clearError,
  t,
}: DocumentLibraryDeps): DocumentLibraryController {
  const api = useDesktopApi();
  const { state, update } = useTaskStore();
  const { files: recentFiles, refresh: refreshRecentFiles } = recent;
  const [seenFailures, setSeenFailures] = useState<string[]>(() => readSeenFailures());
  const [activityVisible, setActivityVisible] = useState(false);

  const tasks = useMemo(() => state.taskOrder.map((taskID) => state.tasks[taskID]).filter(Boolean), [state]);

  const documents = useMemo<SidebarDocument[]>(() => {
    const byPath = new Map<string, SidebarDocument>();
    for (const file of recentFiles) {
      byPath.set(file.filePath, {
        id: file.taskId || `file:${file.filePath}`,
        createdAt: file.lastOpenedAt,
        title: file.fileName,
        documentType: file.documentType,
        filePath: file.filePath,
        conversationId: file.conversationId,
        workspaceId: file.workspaceId,
        status: "completed",
      });
    }
    const pending: SidebarDocument[] = [];
    for (const task of tasks) {
      const item: SidebarDocument = {
        id: task.id,
        createdAt: task.createdAt || task.events.map((event) => event.ts).find((ts): ts is string => Boolean(ts)),
        title: taskTitle(task, t("tasks.untitled")),
        documentType: documentTypeFromTask(task),
        filePath: task.artifact?.filePath,
        conversationId: task.conversationId,
        workspaceId: task.workspaceId,
        status: task.status,
      };
      if (task.artifact?.filePath) byPath.set(task.artifact.filePath, item);
      else if (["starting", "running", "question", "plan_review", "failed"].includes(task.status)) pending.push(item);
    }
    return sortSidebarDocuments([...pending, ...byPath.values()]).slice(0, SIDEBAR_LIMIT);
  }, [recentFiles, t, tasks]);

  const signal = useMemo(() => sidebarSignal(computeTaskSignals(tasks, seenFailures)), [tasks, seenFailures]);

  // A failure counts as seen only while the activity list is actually on
  // screen, so a stale badge cannot outlive the visit that acknowledged it —
  // and cannot clear without one either (R-C-12).
  useEffect(() => {
    if (!activityVisible) return;
    const ids = failedTaskIds(tasks);
    setSeenFailures((current) => {
      if (ids.length === current.length && ids.every((id) => current.includes(id))) return current;
      writeSeenFailures(ids);
      return ids;
    });
  }, [activityVisible, tasks]);

  const removeRecentFile = useCallback(async (filePath: string) => {
    try {
      await recent.remove(filePath);
    } catch (error) {
      void toast.error(errorMessage(error));
    }
  }, [recent]);

  const openRecentFile = useCallback(async (file: RecentFile) => {
    try {
      if (isWorkbookFile(file)) {
        await openWorkbookFile(file);
        return;
      }
      const artifact = await api.openRecentFile(file);
      // A generated file belongs to a run; selecting it keeps the document
      // surface pointed at the right lineage.
      if (file.source === "generated") {
        const matchingTask = tasks.find((task) =>
          (file.taskId && task.id === file.taskId) ||
          (file.conversationId && task.conversationId === file.conversationId));
        if (matchingTask) routing.selectTask(matchingTask.id);
      }
      await session.open(artifact);
      void refreshRecentFiles(homeWorkspaceId);
    } catch (error) {
      // Three failures, three different ways out (R-D-06).
      const text = errorMessage(error);
      if (isUnsupported(text)) {
        void toast.info(t("home.systemOpenFallback"));
        await api.openPath(file.filePath);
        return;
      }
      if (isMissing(text)) {
        void toast.error({
          content: t("home.missingFile"),
          action: { label: t("home.removeRecentAction"), onClick: () => void removeRecentFile(file.filePath) },
        });
        return;
      }
      void toast.error(isPermissionDenied(text) ? t("home.permissionError") : text);
    }
  }, [api, homeWorkspaceId, openWorkbookFile, refreshRecentFiles, removeRecentFile, routing, session, t, tasks]);

  const openLocalFile = useCallback(async () => {
    try {
      const selected = await api.openFileDialog({
        filters: [{ name: "Office files", extensions: [...OPEN_LOCAL_FILE_TYPES] }],
      });
      if (!selected) return;
      // The dialog filters already narrow the list, but a typed path can still
      // slip through, so keep the rule on this side too.
      const documentType = fileExtension(selected);
      if (!OPEN_LOCAL_FILE_TYPES.includes(documentType)) {
        void toast.error(t("home.openReferencedFile.unsupported"));
        return;
      }
      await openRecentFile({
        filePath: selected,
        fileName: fileNameFromPath(selected),
        documentType,
        source: "local",
        ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : {}),
        lastOpenedAt: new Date().toISOString(),
      });
    } catch (error) {
      void toast.error(errorMessage(error));
    }
  }, [api, homeWorkspaceId, openRecentFile, t]);

  const openDocument = useCallback((document: SidebarDocument) => {
    if (state.tasks[document.id]) {
      const task = state.tasks[document.id];
      if (task?.status === "completed" && task.artifact?.filePath) {
        routing.setSelectedTask({ kind: "task", id: document.id });
        routing.setNav("document");
        void session.open(task.artifact);
        return;
      }
      routing.selectTask(document.id);
      return;
    }
    const filePath = document.id.startsWith("file:") ? document.id.slice("file:".length) : undefined;
    const file = recentFiles.find((candidate) => candidate.filePath === filePath || candidate.taskId === document.id);
    if (file) void openRecentFile(file);
  }, [openRecentFile, recentFiles, routing, session, state.tasks]);

  // Deleting a row deletes the conversation behind it: a follow-up edit is a
  // second run against the same document, and leaving it listed resurrects a
  // document the user just removed (R-D-09).
  const deleteDocument = useCallback(async (document: SidebarDocument) => {
    const task = state.tasks[document.id];
    const conversationId = document.conversationId || task?.conversationId;
    const lineage = task ? tasks.filter((candidate) => candidate.conversationId === conversationId) : [];
    try {
      for (const candidate of lineage) {
        if (["starting", "running", "question", "plan_review"].includes(candidate.status)) {
          try {
            await api.cancel(candidate.id);
          } catch (error) {
            if (errorCode(errorMessage(error)) !== BRIDGE_ERROR_CODES.taskNotFound) throw error;
          }
        }
      }
      if (task) {
        await api.deleteDocument(task.id);
        const lineageIds = new Set(lineage.map((candidate) => candidate.id));
        update((current) => lineage.reduce((next, candidate) => deleteTask(next, candidate.id), current));
        recent.forgetWhere((file) =>
          lineageIds.has(file.taskId || "") ||
          (!!conversationId && file.conversationId === conversationId) ||
          (!!document.filePath && file.filePath === document.filePath),
        );
        const selected = routing.selectedTaskID;
        if (selected.kind === "task" && lineageIds.has(selected.id)) {
          routing.setSelectedTask({ kind: "none" });
          routing.setNav("home");
        }
        const open = session.artifact;
        if ((open?.taskId && lineageIds.has(open.taskId)) || (document.filePath && open?.filePath === document.filePath)) {
          await session.close();
        }
      } else if (document.filePath) {
        await removeRecentFile(document.filePath);
        if (session.artifact?.filePath === document.filePath) {
          await session.close();
          routing.setNav("home");
        }
      }
      clearError();
    } catch (error) {
      void toast.error(errorMessage(error));
    }
  }, [api, clearError, recent, removeRecentFile, routing, session, state.tasks, tasks, update]);

  const deleteDocuments = useCallback(async (documentsToDelete: SidebarDocument[]) => {
    // A conversation can have several rows (retries, edits). The single-row
    // delete already removes that whole lineage, so do not issue duplicates.
    const handled = new Set<string>();
    for (const document of documentsToDelete) {
      const key = document.conversationId || document.id;
      if (handled.has(key)) continue;
      handled.add(key);
      await deleteDocument(document);
    }
  }, [deleteDocument]);

  return {
    documents,
    signal,
    setActivityVisible,
    openRecentFile,
    openLocalFile,
    openDocument,
    removeRecentFile,
    deleteDocument,
    deleteDocuments,
  };
}

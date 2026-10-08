import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createInitialTaskState, type TaskState } from "../taskState";
import { projectTaskStateToDocuments, type DocumentProjection } from "../documentModel";

/**
 * The task/artifact truth for the whole renderer, and the document projection
 * over it.
 *
 * Two things live here rather than in `App.tsx`:
 *
 * 1. `TaskState` itself. It used to be a `useState` inside the root component,
 *    which is why every consumer had to be handed a prop: there was nowhere
 *    else to read it from. Anything that wants to render tasks now can.
 *
 * 2. `documents` — `projectTaskStateToDocuments` applied to that state, and
 *    memoised. The projection (Document / Run / Activity / PendingDocument /
 *    ArchivedConversation) has been written and tested since August with no
 *    production consumer at all, because the only place to call it from was the
 *    root component and the root component could not be touched. This is that
 *    call site.
 *
 * `update` takes the same `(current) => next` updater the reducer functions in
 * `taskState.ts` are written as, so moving a `setState` here is a rename and
 * nothing else. The store deliberately holds no actions of its own: what the
 * events mean is `taskState.ts`'s business and stays there.
 */
export interface TaskStore {
  readonly state: TaskState;
  readonly update: (updater: (current: TaskState) => TaskState) => void;
  /** Memoised per state identity; safe to read on every render. */
  readonly documents: DocumentProjection;
}

const TaskStoreContext = createContext<TaskStore | null>(null);

export function TaskStoreProvider({ initial, children }: { initial?: TaskState; children: ReactNode }) {
  const [state, setState] = useState<TaskState>(() => initial ?? createInitialTaskState());
  const documents = useMemo(() => projectTaskStateToDocuments(state), [state]);
  const store = useMemo<TaskStore>(() => ({ state, update: setState, documents }), [state, documents]);
  return <TaskStoreContext.Provider value={store}>{children}</TaskStoreContext.Provider>;
}

export function useTaskStore(): TaskStore {
  const store = useContext(TaskStoreContext);
  if (!store) throw new Error("useTaskStore must be used inside a TaskStoreProvider");
  return store;
}

/** The document view of the current tasks. Nothing else needs the raw state. */
export function useDocumentProjection(): DocumentProjection {
  return useTaskStore().documents;
}

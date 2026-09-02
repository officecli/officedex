interface CompletionPreviewState {
  taskId: string;
  liveDraftTaskId?: string | null;
  previewTaskId?: string;
  previewLiveTaskId?: string;
}

/**
 * Completion must not replace the op-authored editor with a second artifact
 * import. The registry-derived preview ownership covers the React state race
 * where task.completed arrives before setLiveDraftTaskId has committed.
 */
export function shouldKeepLivePreviewOnCompletion(state: CompletionPreviewState): boolean {
  return state.liveDraftTaskId === state.taskId || (
    state.previewTaskId === state.taskId && state.previewLiveTaskId === state.taskId
  );
}

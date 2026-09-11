import type { DesktopTask } from '../shared/types';

/** Generated naming metadata outlives the initial brief and artifact filename. */
export function taskTitle(task: DesktopTask, fallback: string, fileName = task.artifact?.fileName): string {
  const named = [...task.events].reverse().find(event => event.type === 'task.title' && typeof event.payload?.topic === 'string');
  const title = typeof named?.payload?.topic === 'string' ? named.payload.topic.trim() : '';
  return title || fileName || task.topic?.trim() || (task.documentType === 'pptx' ? 'New slides' : task.userInput?.prompt?.trim() || fallback);
}

import type { DesktopTask } from '../shared/types';

/**
 * The topic the desktop submits for a presentation that has not been named yet.
 * It is a protocol value, not copy: the runtime uses this exact string as its
 * cue to call back with a real title once the outline exists, so changing it
 * changes whether decks ever get named. It must never reach the user.
 */
export const PRESENTATION_PLACEHOLDER_TOPIC = 'New slides';

/**
 * Generated naming metadata outlives the initial brief and artifact filename.
 *
 * When there is nothing real to show, this returns the caller's own localized
 * fallback rather than inventing a label or falling back to the brief: a title
 * has to stay short enough for a sidebar row, and the brief is not a name.
 */
export function taskTitle(task: DesktopTask, fallback: string, fileName = task.artifact?.fileName): string {
  const named = [...task.events].reverse().find(event => event.type === 'task.title' && typeof event.payload?.topic === 'string');
  const title = typeof named?.payload?.topic === 'string' ? named.payload.topic.trim() : '';
  const topic = task.topic?.trim();
  const usableTopic = topic && topic !== PRESENTATION_PLACEHOLDER_TOPIC ? topic : '';
  const brief = task.documentType === 'pptx' ? '' : task.userInput?.prompt?.trim();
  return title || fileName || usableTopic || brief || fallback;
}

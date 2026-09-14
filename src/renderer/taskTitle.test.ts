import { describe, expect, it } from 'vitest';
import { taskTitle } from './taskTitle';
import { applyTaskEvent, createInitialTaskState } from './taskState';
import type { BridgeEvent, DesktopTask } from '../shared/types';

describe('asynchronous presentation naming', () => {
  it('keeps the title across late input, completion and history replay without changing the brief', () => {
    const events: BridgeEvent[] = [
      { task_id: 'one', type: 'task.started', payload: { topic: 'New slides', document_type: 'pptx' } },
      { task_id: 'one', type: 'task.title', payload: { topic: 'Brand Launch' } },
      { task_id: 'two', type: 'task.started', payload: { topic: 'New slides', document_type: 'pptx' } },
      { task_id: 'one', type: 'task.user_input', payload: { topic: 'New slides', prompt: 'Create a presentation about a new brand.' } },
      { task_id: 'one', type: 'task.completed', payload: {} },
    ];
    const state = events.reduce(applyTaskEvent, createInitialTaskState());
    expect(state.tasks.one.topic).toBe('Brand Launch');
    expect(state.tasks.one.status).toBe('completed');
    expect(state.tasks.one.userInput?.prompt).toBe('Create a presentation about a new brand.');
    expect(taskTitle(state.tasks.one, 'Untitled', 'New slides.pptx')).toBe('Brand Launch');
    expect(taskTitle(state.tasks.two, 'Untitled')).toBe('Untitled');
  });
  it('never uses the full brief when the presentation has no name yet', () => {
    const task: DesktopTask = { id: 'a', conversationId: 'a', status: 'starting', documentType: 'pptx', events: [], userInput: { prompt: 'Create a long presentation about all of our products.' } };
    // The submission topic is a protocol value the runtime keys its naming call
    // off; showing it would put a meaningless label on every unnamed deck, so
    // the caller's own fallback wins instead.
    expect(taskTitle(task, 'Untitled')).toBe('Untitled');
    expect(taskTitle({ ...task, topic: 'New slides' }, 'Untitled')).toBe('Untitled');
  });
});

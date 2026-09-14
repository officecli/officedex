import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BridgeEvent } from '../../../shared/types';
import { officecli } from '../../bridge';
import { ImageAgentPanel } from './ImageAgentPanel';
let emit: (event: BridgeEvent) => void;
const off = vi.fn();
vi.mock('../../bridge', () => ({ officecli: { onBridgeEvent: vi.fn(), generate: vi.fn(), cancel: vi.fn(), respond: vi.fn(), getTaskHistory: vi.fn() } }));
beforeEach(() => {
  localStorage.clear();
  vi.mocked(officecli.onBridgeEvent).mockImplementation(callback => { emit = callback; return off; });
  vi.mocked(officecli.generate).mockResolvedValue({ taskId: 'generated', sessionId: 'session', status: 'running' });
  vi.mocked(officecli.cancel).mockResolvedValue(undefined);
  vi.mocked(officecli.getTaskHistory).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup() { const generated = vi.fn().mockResolvedValue(undefined); const view = render(<ImageAgentPanel ready fileName="cat.png" filePath="/tmp/cat.png" historyPath="/tmp/cat.png" onGenerated={generated} />); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Warmer colors' } }); return { generated, ...view }; }
it('generates with the current reference, ignores other tasks, and opens one result', async () => {
  const { generated } = setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(officecli.generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: ['/tmp/cat.png'], prompt: 'Warmer colors', documentType: 'img' })));
  await act(async () => emit({ task_id: 'other', type: 'task.completed', payload: { file_path: '/tmp/wrong.png' } }));
  expect(generated).not.toHaveBeenCalled();
  await act(async () => { emit({ task_id: 'generated', type: 'task.completed', payload: { result: { file_path: '/tmp/new.png' } } }); emit({ task_id: 'generated', type: 'task.completed', payload: { file_path: '/tmp/new.png' } }); });
  expect(generated).toHaveBeenCalledOnce(); expect(generated).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/new.png' }));
});
it('cancels a request even if the task id arrives after closing the viewer', async () => {
  let resolve!: (value: { taskId: string; sessionId: string; status: string }) => void;
  vi.mocked(officecli.generate).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { unmount, generated } = setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!); unmount();
  await act(async () => resolve({ taskId: 'late', sessionId: '', status: 'running' }));
  expect(officecli.cancel).toHaveBeenCalledWith('late'); expect(generated).not.toHaveBeenCalled(); expect(off).toHaveBeenCalled();
});
it('handles a completion arriving before generate resolves', async () => {
  vi.mocked(officecli.generate).mockImplementationOnce(async () => { emit({ task_id: 'generated', type: 'task.completed', payload: { file_path: '/tmp/fast.png' } }); return { taskId: 'generated', sessionId: '', status: 'completed' }; });
  const { generated } = setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(generated).toHaveBeenCalledWith(expect.objectContaining({ filePath: '/tmp/fast.png' })));
});
it('reports a generation failure without opening an image', async () => {
  const { generated } = setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(officecli.getTaskHistory).toHaveBeenCalled());
  await act(async () => emit({ task_id: 'generated', type: 'task.failed', payload: { message: 'Provider unavailable' } }));
  expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable'); expect(generated).not.toHaveBeenCalled();
});
it('sends clarification replies to the existing task', async () => {
  vi.mocked(officecli.respond).mockResolvedValue(undefined);
  setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(officecli.getTaskHistory).toHaveBeenCalled());
  await act(async () => emit({ task_id: 'generated', type: 'task.question', payload: { id: 'question-1', question: 'Which background?' } }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Blue' } });
  fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(officecli.respond).toHaveBeenCalledWith({ taskId: 'generated', questionId: 'question-1', answer: 'Blue' }));
  expect(officecli.generate).toHaveBeenCalledTimes(1);
});
it('does not open a late result while cancellation is pending', async () => {
  let finish!: () => void;
  vi.mocked(officecli.cancel).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const { generated } = setup(); fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(officecli.getTaskHistory).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }));
  await act(async () => emit({ task_id: 'generated', type: 'task.completed', payload: { file_path: '/tmp/late.png' } }));
  await act(async () => finish());
  expect(generated).not.toHaveBeenCalled();
});

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Image, Square } from 'lucide-react';
import type { Artifact, BridgeEvent } from '../../../shared/types';
import { useDesktopApi } from "../../services/desktopApi";
import { useT } from '../../i18n';
import { Button } from '../../ui';
import { AgentMessage } from '../../workbench/AgentMessage';
import { agentHistoryKey, messageHistoryCodec, useAgentHistory } from '../../workbench/useAgentHistory';
import '../../workbench/agent-panel.css';

interface Operation { id?: string; cancelled: boolean; finishing?: boolean; buffered: BridgeEvent[]; questionId?: string }
export function ImageAgentPanel({ filePath, fileName, historyPath, parentTaskId, ready, onGenerated }: {
  filePath?: string; fileName: string; historyPath?: string; parentTaskId?: string; ready: boolean;
  onGenerated: (artifact: Artifact) => Promise<void>;
}) {
  const api = useDesktopApi();
  const t = useT();
  const [messages, setMessages] = useAgentHistory(agentHistoryKey('img', historyPath), messageHistoryCodec);
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running' | 'question' | 'opening'>('idle');
  const [error, setError] = useState('');
  const active = useRef<Operation | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const handler = useRef<(event: BridgeEvent) => void>(() => {});
  const reply = (text: string) => setMessages(items => [...items, { role: 'assistant', text }]);
  handler.current = (event) => {
    const op = active.current;
    if (!op || op.cancelled || op.finishing) return;
    if (!op.id) { op.buffered.push(event); if (op.buffered.length > 200) op.buffered.shift(); return; }
    if (event.task_id !== op.id) return;
    const payload = event.payload ?? {};
    if (event.type === 'task.question') {
      const question = typeof payload.question === 'string' ? payload.question : typeof payload.message === 'string' ? payload.message : '';
      if (!question) return;
      const id = typeof payload.id === 'string' ? payload.id : typeof payload.question_id === 'string' ? payload.question_id : event.event_id;
      if (op.questionId === id) return;
      op.questionId = id;
      reply(question); setPhase('question');
    }
    if (event.type === 'task.failed' || event.type === 'task.cancelled') {
      active.current = null; setPhase('idle');
      const message = event.type === 'task.cancelled' ? t('image.agent.cancelled') : String(payload.message || payload.error || t('image.agent.failed'));
      reply(message); if (event.type === 'task.failed') setError(message);
    }
    if (event.type === 'task.completed') {
      op.finishing = true; setPhase('opening');
      const result = payload.result && typeof payload.result === 'object' ? payload.result as Record<string, unknown> : payload;
      const path = typeof result.file_path === 'string' ? result.file_path : typeof result.filePath === 'string' ? result.filePath : '';
      const name = typeof result.file_name === 'string' ? result.file_name : path.split(/[\\/]/).pop() || '';
      void (async () => {
        try {
          if (!path) throw new Error(t('image.agent.noOutput'));
          await onGenerated({ taskId: op.id, filePath: path, fileName: name, documentType: path.split('.').pop()?.toLowerCase() ?? '' });
          if (!op.cancelled) reply(t('image.agent.completed'));
        } catch (reason) {
          if (!op.cancelled) { const message = String(reason instanceof Error ? reason.message : reason); setError(message); reply(message); }
        } finally { if (active.current === op) { active.current = null; setPhase('idle'); } }
      })();
    }
  };
  useEffect(() => {
    const unsubscribe = api.onBridgeEvent(event => handler.current(event));
    return () => {
      unsubscribe();
      const op = active.current;
      if (op) { op.cancelled = true; if (op.id && !op.finishing) void api.cancel(op.id).catch(() => {}); }
      active.current = null;
    };
  }, []);
  useEffect(() => { log.current?.scrollTo?.({ top: log.current.scrollHeight }); }, [messages, phase]);
  const submit = async () => {
    const text = prompt.trim();
    if (!text || !filePath || !ready || (active.current && phase !== 'question')) return;
    setError(''); setPrompt(''); setMessages(items => [...items, { role: 'user', text }]);
    if (active.current && phase === 'question') {
      const op = active.current;
      setPhase('running');
      try { await api.respond({ taskId: op.id!, questionId: op.questionId, answer: text }); }
      catch (reason) { if (!op.cancelled) { setError(String(reason)); setPhase('question'); setPrompt(text); } }
      return;
    }
    const op: Operation = { cancelled: false, buffered: [] };
    active.current = op; setPhase('running');
    try {
      const result = await api.generate({ documentType: 'img', generationMode: 'fast', topic: fileName, prompt: text, referenceImages: [filePath], parentTaskId, noProject: true });
      op.id = result.taskId;
      if (op.cancelled) { if (op.id) await api.cancel(op.id); return; }
      if (!op.id) throw new Error(t('image.agent.failed'));
      for (const event of op.buffered.splice(0)) handler.current(event);
      // A fast task can finish before the listener receives its replay. Recover
      // only this task, and let the normal completion handler deduplicate it.
      if (active.current === op && !op.finishing) {
        const history = await api.getTaskHistory(50).catch(() => []);
        if (!op.cancelled && active.current === op) history.find(item => item.taskId === op.id)?.events.forEach(event => handler.current(event));
      }
    } catch (reason) {
      if (!op.cancelled && active.current === op) { active.current = null; setPhase('idle'); setPrompt(text); setError(String(reason instanceof Error ? reason.message : reason)); }
    }
  };
  const cancel = async () => {
    const op = active.current;
    if (!op || op.finishing) return;
    op.cancelled = true;
    try {
      if (op.id) await api.cancel(op.id);
      if (active.current === op) { active.current = null; setPhase('idle'); reply(t('image.agent.cancelled')); }
    } catch (reason) {
      op.cancelled = false; setError(String(reason));
      const history = await api.getTaskHistory(50).catch(() => []);
      if (active.current === op) history.find(item => item.taskId === op.id)?.events.forEach(event => handler.current(event));
    }
  };
  return <div className="image-agent agent-panel" data-has-messages={messages.length > 0}>
    <div ref={log} className="agent-panel__body" role="log" aria-live="polite">
      {!messages.length && <div className="image-agent__welcome"><Image size={22} /><strong>{t('image.agent.ready')}</strong><p>{t('image.agent.description')}</p></div>}
      {messages.map((message, i) => <AgentMessage key={i} role={message.role}>{message.text}</AgentMessage>)}
      {phase === 'running' || phase === 'opening' ? <p role="status">{t(phase === 'opening' ? 'image.agent.opening' : 'image.agent.running')}</p> : null}
      {!filePath && <p>{t('image.agent.noPath')}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    <form className="agent-compose-box" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <textarea rows={3} value={prompt} aria-label={t('image.agent.placeholder')} placeholder={t('image.agent.placeholder')}
        disabled={!filePath || !ready || phase === 'running' || phase === 'opening'} onChange={event => setPrompt(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void submit(); } }} />
      <div className="agent-composer-actions"><span className="agent-panel__scope"><Image size={14} /><span>{fileName}</span></span>
        {phase === 'running' || phase === 'question' ? <Button ariaLabel={t('image.agent.stop')} icon={<Square />} onClick={() => void cancel()} /> : null}
        {phase !== 'running' && <Button className="od-button--icon-submit" type="primary" htmlType="submit" ariaLabel={t('pptx.agent.send')} icon={<ArrowUp />} disabled={!filePath || !ready || !prompt.trim() || phase === 'opening'} />}
      </div>
    </form>
  </div>;
}

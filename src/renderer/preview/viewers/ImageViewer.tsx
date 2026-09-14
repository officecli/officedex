import { useCallback, useEffect, useRef, useState } from 'react';
import { Contrast, FolderClosed, Info, Maximize, Minus, Plus, RotateCw, Scan } from 'lucide-react';
import type { Artifact, PreviewGrant } from '../../../shared/types';
import { useT } from '../../i18n';
import { officecli } from '../../bridge';
import { Button, Tooltip, toast } from '../../ui';
import { OfficeWorkbenchLayout } from '../../workbench/OfficeWorkbenchLayout';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import type { PreviewViewerProps } from './previewViewers';
import { ImageAgentPanel } from './ImageAgentPanel';
import { fitImage, IMAGE_MIME_TYPES, isImagePreview, zoomImage, type ImageViewport } from './imageViewport';
import './imageViewer.css';

export interface ImageViewerProps extends PreviewViewerProps { filePath?: string; artifact?: Artifact }
export default function ImageViewer(props: ImageViewerProps) { return <ImageWorkbench key={props.previewToken} {...props} />; }
function ImageWorkbench({ previewToken, fileName, documentType, onRequestClose, filePath, artifact }: ImageViewerProps) {
  const t = useT();
  const [current, setCurrent] = useState({ token: previewToken, fileName, documentType, filePath: artifact?.filePath ?? filePath, taskId: artifact?.taskId });
  const [src, setSrc] = useState('');
  const [sourceToken, setSourceToken] = useState('');
  const [error, setError] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0, bytes: 0 });
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<ImageViewport>({ scale: 1, x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [background, setBackground] = useState(0);
  const [info, setInfo] = useState(false);
  const [loading, setLoading] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const fitMode = useRef(true);
  const drag = useRef<{ x: number; y: number; view: ImageViewport } | null>(null);
  const ownedTokens = useRef<string[]>([]);
  const mounted = useRef(true);
  const extension = (current.documentType || current.fileName.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ownedTokens.current.forEach(token => { void officecli.revokePreviewToken(token).catch(() => {}); }); }; }, []);
  useEffect(() => {
    let cancelled = false;
    let url = '';
    setSrc(''); setError(''); setLoading(true); setSize({ width: 0, height: 0, bytes: 0 }); setRotation(0); fitMode.current = true;
    setView({ scale: 1, x: 0, y: 0 });
    void officecli.readArtifactFile(current.token).then(({ data }) => {
      if (cancelled) return;
      const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : new Uint8Array(data));
      const blob = new Blob([bytes], { type: IMAGE_MIME_TYPES[extension] || 'application/octet-stream' });
      url = URL.createObjectURL(blob); setSize(value => ({ ...value, bytes: blob.size })); setSourceToken(current.token); setSrc(url);
    }).catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); } });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [current.token, extension, reload]);
  const fit = useCallback(() => {
    fitMode.current = true;
    if (stage.current && size.width && size.height) setView(fitImage(size.width, size.height, stage.current.clientWidth, stage.current.clientHeight, rotation));
  }, [size.width, size.height, rotation]);
  useEffect(() => { if (fitMode.current) fit(); }, [fit]);
  useEffect(() => {
    if (!stage.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (fitMode.current) fit(); });
    observer.observe(stage.current); return () => observer.disconnect();
  }, [fit]);
  const zoom = useCallback((scale: number, x = 0, y = 0) => { if (loading || error) return; fitMode.current = false; setView(value => zoomImage(value, scale, x, y)); }, [loading, error]);
  const actual = () => { if (loading || error) return; fitMode.current = false; setView({ scale: 1, x: 0, y: 0 }); };
  useEffect(() => {
    const canvas = stage.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || loading || error) return;
      event.preventDefault(); fitMode.current = false;
      const rect = canvas.getBoundingClientRect();
      setView(value => zoomImage(value, value.scale * Math.exp(-event.deltaY * .008), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [loading, error]);
  const report = (reason: unknown) => toast.error(reason instanceof Error ? reason.message : String(reason));
  const openExternal = current.filePath ? () => { void officecli.openPath(current.filePath!).catch(report); } : undefined;
  const generated = async (next: Artifact) => {
    if (!isImagePreview(next.documentType)) throw new Error(t('image.unsupportedOutput'));
    const grant: PreviewGrant = await officecli.issuePreviewToken(next);
    if (!mounted.current) { await officecli.revokePreviewToken(grant.token); return; }
    ownedTokens.current.push(grant.token);
    setCurrent({ ...grant, filePath: next.filePath, taskId: next.taskId });
  };
  const tool = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => <Tooltip title={label}><Button type="text" size="small" ariaLabel={label} icon={icon} onClick={onClick} disabled={disabled} /></Tooltip>;
  const disabled = loading || Boolean(error) || sourceToken !== current.token;
  return <div ref={frame} className="image-workbench" onKeyDown={event => {
    if (event.target instanceof Element && event.target.closest('textarea,input,select,[contenteditable="true"]')) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { if (info) setInfo(false); else onRequestClose?.(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(view.scale * 1.25); }
    else if (event.key === '-') { event.preventDefault(); zoom(view.scale / 1.25); }
    else if (event.key === '0') { event.preventDefault(); fit(); }
    else if (event.key === '1') { event.preventDefault(); actual(); }
  }}>
    <OfficeWorkbenchLayout documentType="img" fileName={current.fileName} onBack={onRequestClose} backLabel={t('workbench.closePreview')} onOpenExternal={openExternal}
      panel={{ title: t('docx.agent.panelTitle'), children: <ImageAgentPanel filePath={current.filePath} fileName={current.fileName} historyPath={artifact?.filePath ?? filePath} parentTaskId={current.taskId} ready={!disabled} onGenerated={generated} /> }}
      actions={<div className="image-tools">
        {tool(t('workbench.zoomOut'), <Minus size={16} />, () => zoom(view.scale / 1.25), disabled)}
        <Button type="text" size="small" ariaLabel={t('image.actual')} onClick={actual} disabled={disabled}>{Math.round(view.scale * 100)}%</Button>
        {tool(t('workbench.zoomIn'), <Plus size={16} />, () => zoom(view.scale * 1.25), disabled)}
        {tool(t('image.fit'), <Scan size={16} />, fit, disabled)}
        {tool(t('image.rotate'), <RotateCw size={16} />, () => setRotation(value => (value + 90) % 360), disabled)}
        <details className="image-more"><summary aria-label={t('image.more')}>···</summary><div className="image-more__menu">
          {tool(t('image.background'), <Contrast size={16} />, () => setBackground(value => (value + 1) % 3))}
          {tool(t('image.info'), <Info size={16} />, () => setInfo(value => !value))}
          {tool(t('image.fullscreen'), <Maximize size={16} />, () => { if (document.fullscreenElement) void document.exitFullscreen().catch(report); else if (frame.current?.requestFullscreen) void frame.current.requestFullscreen().catch(report); })}
          {current.filePath && tool(t('preview.showInFolder'), <FolderClosed size={16} />, () => { void officecli.showItemInFolder(current.filePath!).catch(report); })}
        </div></details>
      </div>}>
      <div className="image-canvas" data-background={background} ref={stage} tabIndex={0} aria-label={t('image.canvas')}
        onDoubleClick={() => { if (fitMode.current) actual(); else fit(); }}
        onPointerDown={event => { if (disabled || event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return; stage.current?.focus(); drag.current = { x: event.clientX, y: event.clientY, view }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { const start = drag.current; if (start) setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {src && sourceToken === current.token && !error && <img key={src} src={src} alt={current.fileName} draggable={false} className="image-canvas__image" style={{ visibility: loading ? 'hidden' : 'visible', transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) rotate(${rotation}deg) scale(${view.scale})` }}
          onLoad={event => { const { naturalWidth: width, naturalHeight: height } = event.currentTarget; setSize(value => ({ ...value, width, height })); setLoading(false); }}
          onError={() => { setError(t('image.decodeError')); setLoading(false); }} />}
        {(loading || sourceToken !== current.token) && !error && <LoadingState fileName={current.fileName} />}
        {error && <ErrorState fileName={current.fileName} message={error} onRetry={() => setReload(value => value + 1)} onOpenExternal={openExternal} />}
      </div>
      {info && <aside className="image-info" aria-label={t('image.info')}><Button type="text" onClick={() => setInfo(false)}>{t('image.closeInfo')}</Button><strong>{current.fileName}</strong><dl><dt>{t('image.dimensions')}</dt><dd>{size.width} × {size.height} px</dd><dt>{t('image.size')}</dt><dd>{(size.bytes / 1024).toFixed(1)} KB</dd><dt>{t('image.format')}</dt><dd>{extension.toUpperCase()}</dd></dl></aside>}
    </OfficeWorkbenchLayout>
  </div>;
}

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { officecli } from '../../bridge';
import ImageViewer from './ImageViewer';
import { fitImage, isImagePreview, zoomImage } from './imageViewport';
import { previewViewerFor } from './previewViewers';
vi.mock('../../bridge', () => ({ officecli: { readArtifactFile: vi.fn(), revokePreviewToken: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('./ImageAgentPanel', () => ({ ImageAgentPanel: () => <div>Agent</div> }));
vi.mock('../../workbench/OfficeWorkbenchLayout', () => ({ OfficeWorkbenchLayout: ({ children, panel, actions, status, zoom }: any) => <div>{panel.children}<header>{actions}</header>{children}{(status || zoom) && <footer>footer</footer>}</div> }));
beforeEach(() => {
  vi.mocked(officecli.readArtifactFile).mockReset().mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  URL.createObjectURL = vi.fn().mockReturnValue('blob:image');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('image preview', () => {
  it.each(['png', '.PNG', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'])('registers supported image %s in both preview paths', type => {
    expect(isImagePreview(type)).toBe(true); expect(previewViewerFor(type)).toBeDefined();
  });
  it('fits without upscaling and accounts for rotation', () => {
    expect(fitImage(100, 100, 800, 600).scale).toBe(1);
    expect(fitImage(1200, 600, 664, 364).scale).toBe(.5);
    expect(fitImage(1200, 600, 664, 364, 90).scale).toBe(.25);
  });
  it('keeps the pixel under the cursor stationary when zooming', () => {
    const next = zoomImage({ scale: .5, x: 20, y: -10 }, 1, 100, 80);
    expect(next).toEqual({ scale: 1, x: -60, y: -100 });
    expect((100 - next.x) / next.scale).toBe((100 - 20) / .5);
  });
  it('loads via the authorized bridge, waits for decode, and has no bottom bar', async () => {
    const view = render(<ImageViewer previewToken="token" fileName="cat.png" documentType="png" />);
    const img = await screen.findByAltText('cat.png');
    expect(officecli.readArtifactFile).toHaveBeenCalledWith('token');
    expect(img).toHaveStyle({ visibility: 'hidden' });
    fireEvent.load(img);
    expect(img).toHaveStyle({ visibility: 'visible' });
    expect(view.container.querySelector('footer')).toBeNull();
    expect(view.container.querySelector('header')).toContainElement(screen.getByRole('button', { name: 'Fit to window' }));
    view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image');
  });
  it('ignores an old file read after switching files', async () => {
    let resolve!: (value: { data: Uint8Array }) => void;
    vi.mocked(officecli.readArtifactFile).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const view = render(<ImageViewer previewToken="old" fileName="old.png" documentType="png" />);
    view.rerender(<ImageViewer previewToken="new" fileName="new.png" documentType="png" />);
    await screen.findByAltText('new.png');
    await act(async () => resolve({ data: new Uint8Array([9]) }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('old.png')).toBeNull();
  });
  it('shows decode failures and retries with a fresh read', async () => {
    render(<ImageViewer previewToken="token" fileName="cat.png" documentType="png" />);
    fireEvent.error(await screen.findByAltText('cat.png'));
    expect(screen.getByText(/could not be decoded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(officecli.readArtifactFile).toHaveBeenCalledTimes(2));
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PreviewPanel } from '../../components/PreviewPanel';
vi.mock('./ImageViewer', () => ({ default: ({ artifact, fileName }: any) => <div data-testid="image-viewer" data-path={artifact?.filePath}>{fileName}</div> }));
afterEach(cleanup);
it.each(['png', '.PNG', 'jpg', 'jpeg', 'webp', 'bmp', 'svg'])('opens %s inside the main image workbench, without a ready footer', async documentType => {
  const artifact = { filePath: '/tmp/cat.png', fileName: 'cat.png', documentType };
  const view = render(<PreviewPanel grant={{ token: 'token', fileName: 'cat.png', documentType }} artifact={artifact} onClose={vi.fn()} />);
  expect(await screen.findByTestId('image-viewer')).toHaveAttribute('data-path', '/tmp/cat.png');
  expect(view.container.querySelector('.preview-ready-notice')).toBeNull();
  expect(screen.queryByText(/not supported for preview/)).toBeNull();
});

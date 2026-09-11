import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureHomeEntryTransition, playHomeEntryTransition } from './homeEntryTransition';

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  document.body.innerHTML = '<section class="home-screen"><h1 id="home-title">Home</h1><form class="home-intake"><textarea>Brand launch</textarea><button>Create</button></form></section><main><header class="document-workspace__header"></header><div class="pptx-flow-request"><span>Your request</span></div><div class="pptx-flow-lower"><section class="pptx-flow-step"></section></div></main>';
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 500, height: 160 } as DOMRect);
  return document.querySelector('main')!;
}

describe('home entry motion', () => {
  it('restores content and removes the overlay when navigation interrupts it', () => {
    const host = setup();
    const cancel = vi.fn();
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel, finished: new Promise(() => {}) })) });
    const entry = captureHomeEntryTransition('<script>user text</script>');
    const cleanup = playHomeEntryTransition(host, entry);
    expect(document.querySelector('.home-entry-morph')?.textContent).toContain('<script>user text</script>');
    expect(document.querySelector('.home-entry-morph script')).toBeNull();
    expect(document.querySelector('.home-entry-morph button')?.textContent).toBe('Create');
    expect(document.querySelector<HTMLTextAreaElement>('.home-entry-morph textarea')?.style.visibility).toBe('hidden');
    expect(host.querySelector<HTMLElement>('.pptx-flow-request')?.style.visibility).toBe('hidden');
    cleanup?.();
    expect(document.querySelector('.home-entry-morph')).toBeNull();
    expect(host.querySelector<HTMLElement>('.pptx-flow-request')?.style.visibility).toBe('');
    expect(cancel).toHaveBeenCalled();
    expect(playHomeEntryTransition(host, entry)).toBeUndefined();
  });
  it('lets the lower reveal finish after the brief lands', async () => {
    const host = setup();
    const pending: Array<{ element: Element; finish: () => void; cancel: ReturnType<typeof vi.fn> }> = [];
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element) {
      let finish!: () => void;
      const finished = new Promise<void>(resolve => { finish = resolve; });
      const cancel = vi.fn();
      pending.push({ element: this, finish, cancel });
      return { finished, cancel };
    } });
    playHomeEntryTransition(host, captureHomeEntryTransition('Brand launch'));
    const lower = pending.find(item => item.element.classList.contains('pptx-flow-lower'))!;
    pending.filter(item => item !== lower).forEach(item => item.finish());
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector('.home-entry-morph')).toBeNull();
    expect(host.querySelector<HTMLElement>('.pptx-flow-request')?.style.visibility).toBe('');
    expect(lower.cancel).not.toHaveBeenCalled();
    lower.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(lower.cancel).toHaveBeenCalled();
  });
  it('fades Home before moving the stationary brief and cleans up its snapshot', () => {
    const host = setup();
    const calls: Array<{ element: Element; options: KeyframeAnimationOptions }> = [];
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: function (this: Element, _frames: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ element: this, options });
      return { cancel: vi.fn(), finished: new Promise(() => {}) };
    } });
    const entry = captureHomeEntryTransition('Brand launch')!;
    const snapshot = entry.homeSnapshot!;
    expect(snapshot.querySelector('[id]')).toBeNull();
    expect(snapshot.querySelector<HTMLElement>('.home-intake')?.style.visibility).toBe('hidden');
    const cleanup = playHomeEntryTransition(host, entry);
    const fade = calls.find(call => call.element === snapshot)!;
    const move = calls.find(call => call.element.classList.contains('home-entry-morph'))!;
    expect(Number(move.options.delay)).toBeGreaterThan(Number(fade.options.duration));
    expect(document.body.contains(snapshot)).toBe(true);
    cleanup?.();
    expect(document.body.contains(snapshot)).toBe(false);
    expect(document.getElementById('home-title')).not.toBeNull();
    expect(entry.homeSnapshot).toBeUndefined();
  });
  it('ignores programmatic scrolling but yields to user scrolling', () => {
    const host = setup();
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn(), finished: new Promise(() => {}) })) });
    playHomeEntryTransition(host, captureHomeEntryTransition('Brand launch'));
    host.dispatchEvent(new Event('scroll'));
    expect(document.querySelector('.home-entry-morph')).not.toBeNull();
    expect(host.dataset.homeEntryTransition).toBe('running');
    host.dispatchEvent(new WheelEvent('wheel'));
    expect(document.querySelector('.home-entry-morph')).toBeNull();
    expect(host.dataset.homeEntryTransition).toBeUndefined();
  });
  it('leaves generation immediately visible when reduced motion is requested', () => {
    setup();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(captureHomeEntryTransition('New brief')).toBeUndefined();
    expect(document.querySelector('.home-entry-morph')).toBeNull();
  });
});

export interface HomeEntryTransition {
  rect: { left: number; top: number; width: number; height: number };
  prompt: string;
  font: string;
  color: string;
  background: string;
  border: string;
  homeSnapshot?: HTMLElement;
  composerSnapshot?: HTMLElement;
  radius?: string;
  shadow?: string;
  textBox?: { left: number; top: number; width: number; height: number; scrollTop: number; fontSize: string; lineHeight: string };
  consumed?: boolean;
}

/** Capture before Home unmounts; no navigation or generation waits on motion. */
export function captureHomeEntryTransition(prompt: string): HomeEntryTransition | undefined {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const source = document.querySelector<HTMLElement>('.home-intake');
  if (!source) return;
  const rect = source.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const style = getComputedStyle(source);
  const composerSnapshot = source.cloneNode(true) as HTMLElement;
  composerSnapshot.removeAttribute('id');
  composerSnapshot.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
  composerSnapshot.querySelectorAll('textarea').forEach(el => { el.style.visibility = 'hidden'; });
  const sourceText = source.querySelector('textarea');
  const textRect = sourceText?.getBoundingClientRect();
  const textStyle = sourceText ? getComputedStyle(sourceText) : undefined;
  const textBox = textRect && textStyle ? {
    left: textRect.left - rect.left + (parseFloat(textStyle.paddingLeft) || 0),
    top: textRect.top - rect.top + (parseFloat(textStyle.paddingTop) || 0),
    width: textRect.width - (parseFloat(textStyle.paddingLeft) || 0) - (parseFloat(textStyle.paddingRight) || 0),
    height: Math.max(0, textRect.height - (parseFloat(textStyle.paddingTop) || 0) - (parseFloat(textStyle.paddingBottom) || 0)),
    scrollTop: sourceText?.scrollTop || 0,
    fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight,
  } : undefined;
  const home = source.closest<HTMLElement>('.home-screen');
  const homeSnapshot = home?.cloneNode(true) as HTMLElement | undefined;
  if (home && homeSnapshot) {
    const homeRect = home.getBoundingClientRect();
    homeSnapshot.setAttribute('aria-hidden', 'true');
    homeSnapshot.inert = true;
    homeSnapshot.removeAttribute('id');
    homeSnapshot.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    const composer = homeSnapshot.querySelector<HTMLElement>('.home-intake');
    if (composer) composer.style.visibility = 'hidden';
    Object.assign(homeSnapshot.style, {
      position: 'fixed', zIndex: '999', pointerEvents: 'none', margin: '0',
      left: `${homeRect.left}px`, top: `${homeRect.top}px`,
      width: `${homeRect.width}px`, height: `${homeRect.height}px`, maxWidth: 'none',
      boxSizing: 'border-box', overflow: 'hidden',
    });
  }
  return { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, prompt,
    font: style.font, color: style.color, background: style.backgroundColor, border: style.borderColor, homeSnapshot,
    composerSnapshot, textBox, radius: style.borderRadius, shadow: style.boxShadow };
}

export function playHomeEntryTransition(host: HTMLElement, entry?: HomeEntryTransition): (() => void) | undefined {
  if (!entry || entry.consumed) return;
  delete host.dataset.homeEntryTransition;
  const target = host.querySelector<HTMLElement>('.pptx-flow-request');
  if (!target || typeof target.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Measure the full brief before animating; rows=2 is only a fallback.
  const targetInput = target.querySelector('textarea');
  if (targetInput) { targetInput.style.height = 'auto'; targetInput.style.height = `${targetInput.scrollHeight}px`; }
  const end = target.getBoundingClientRect();
  if (!end.width || !end.height) return;
  entry.consumed = true;
  host.dataset.homeEntryTransition = "running";
  const style = getComputedStyle(target);
  const homeSnapshot = entry.homeSnapshot;
  if (homeSnapshot) document.body.append(homeSnapshot);
  const overlay = document.createElement('div');
  overlay.className = 'home-entry-morph';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  const chrome = entry.composerSnapshot;
  if (chrome) {
    Object.assign(chrome.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', margin: '0', maxWidth: 'none', border: '0', boxShadow: 'none', background: 'transparent', boxSizing: 'border-box' });
    overlay.append(chrome);
  }
  const label = document.createElement('div');
  label.className = 'home-entry-morph__label';
  label.textContent = target.querySelector('span')?.textContent || '';
  const text = document.createElement('div');
  text.className = 'home-entry-morph__text';
  const textContent = document.createElement('div');
  textContent.textContent = entry.prompt;
  text.append(textContent);
  const targetText = target.querySelector('textarea');
  const targetTextRect = targetText?.getBoundingClientRect();
  const targetTextStyle = targetText ? getComputedStyle(targetText) : undefined;
  const endText = {
    left: targetTextRect ? targetTextRect.left - end.left : 18,
    top: targetTextRect ? targetTextRect.top - end.top : 37,
    width: targetTextRect?.width || end.width - 36,
    height: targetTextRect?.height || end.height - 51,
    fontSize: targetTextStyle?.fontSize || '14px', lineHeight: targetTextStyle?.lineHeight || '23.8px',
  };
  const startText = entry.textBox || { left: 18, top: 14, width: entry.rect.width - 36, height: entry.rect.height - 28, scrollTop: 0, fontSize: '14px', lineHeight: '23.8px' };
  Object.assign(text.style, { position: 'absolute', margin: '0', overflow: 'hidden', whiteSpace: 'pre-wrap', height: `${startText.height}px`, left: `${startText.left}px`, top: `${startText.top}px`, width: `${startText.width}px`, fontSize: startText.fontSize, lineHeight: startText.lineHeight });
  Object.assign(label.style, { position: 'absolute', left: style.paddingLeft, top: style.paddingTop, margin: '0' });
  overlay.append(label, text);
  Object.assign(overlay.style, { left: `${entry.rect.left}px`, top: `${entry.rect.top}px`, width: `${entry.rect.width}px`, height: `${entry.rect.height}px`, padding: '0', color: entry.color, font: entry.font, background: entry.background, borderColor: entry.border, borderRadius: entry.radius || '14px', boxShadow: entry.shadow || 'none' });
  document.body.append(overlay);
  const animations: Animation[] = [];
  const animate = (el: Element, frames: Keyframe[], duration: number, delay = 0, easing = 'cubic-bezier(.22,1,.36,1)') => {
    const animation = el.animate(frames, { duration, delay, easing, fill: 'both' });
    animations.push(animation);
    void animation.finished.catch(() => {});
    return animation;
  };
  const visibility = target.style.visibility;
  target.style.visibility = 'hidden';
  // First clear the surrounding Home content, then hold the stationary brief
  // for a beat. Generation already runs while this visual handoff plays.
  const intro = 760;
  if (homeSnapshot) {
    const fade = animate(homeSnapshot, [{ opacity: 1 }, { opacity: 0 }], 600, 0, 'cubic-bezier(.4,0,.2,1)');
    void fade.finished.then(() => homeSnapshot.remove(), () => homeSnapshot.remove());
  }
  if (chrome) animate(chrome, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(8px)' }], 280, intro);
  animate(label, [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translateY(0)' }], 300, intro + 260);
  animate(textContent, [{ transform: `translateY(${-startText.scrollTop}px)` }, { transform: 'translateY(0)' }], 650, intro);
  animate(text, [
    { left: `${startText.left}px`, top: `${startText.top}px`, width: `${startText.width}px`, height: `${startText.height}px`, fontSize: startText.fontSize, lineHeight: startText.lineHeight },
    { left: `${endText.left}px`, top: `${endText.top}px`, width: `${endText.width}px`, height: `${endText.height}px`, fontSize: endText.fontSize, lineHeight: endText.lineHeight },
  ], 650, intro);
  host.querySelectorAll('.document-workspace__header').forEach(el => {
    animate(el, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], 360, intro + 180);
  });
  const lower = host.querySelector('.pptx-flow-lower');
  if (lower) {
    // Move a feathered alpha edge down the whole lower region. Its layout
    // stays still, so the title, card and actions emerge in reading order.
    const mask = {
      maskImage: 'linear-gradient(to bottom, #000 44%, transparent 56%)',
      maskSize: '100% 250%', maskRepeat: 'no-repeat',
      webkitMaskImage: 'linear-gradient(to bottom, #000 44%, transparent 56%)',
      webkitMaskSize: '100% 250%', webkitMaskRepeat: 'no-repeat',
    };
    animate(lower, [
      { ...mask, maskPosition: '0% 100%', webkitMaskPosition: '0% 100%', opacity: 0 },
      { ...mask, maskPosition: '0% 0%', webkitMaskPosition: '0% 0%', opacity: 1 },
    ], 860, intro + 300, 'cubic-bezier(.35,0,.25,1)');
  }
  const morph = animate(overlay, [{ transform: 'translate(0,0)', background: entry.background, borderRadius: entry.radius || '14px', boxShadow: entry.shadow || 'none' }, { transform: `translate(${end.left - entry.rect.left}px,${end.top - entry.rect.top}px)`, width: `${end.width}px`, height: `${end.height}px`, background: style.backgroundColor, borderColor: 'transparent', borderWidth: style.borderWidth, borderRadius: style.borderRadius, boxShadow: 'none' }], 650, intro);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    animations.forEach(animation => animation.cancel());
    target.style.visibility = visibility;
    overlay.remove();
    homeSnapshot?.remove();
    entry.homeSnapshot = undefined;
    entry.composerSnapshot = undefined;
    window.removeEventListener('resize', cleanup);
    delete host.dataset.homeEntryTransition;
    window.removeEventListener('wheel', cleanup, true);
    window.removeEventListener('touchmove', cleanup, true);
  };
  window.addEventListener('resize', cleanup, { once: true });
  // Programmatic scroll/focus during task promotion must not abort the handoff.
  window.addEventListener('wheel', cleanup, { once: true, capture: true, passive: true });
  window.addEventListener('touchmove', cleanup, { once: true, capture: true, passive: true });
  void morph.finished.then(() => {
    target.style.visibility = visibility;
    overlay.remove();
  }, cleanup);
  // The brief lands first; do not cancel the longer lower-region reveal.
  void Promise.all(animations.map(animation => animation.finished)).then(cleanup, cleanup);
  return cleanup;
}

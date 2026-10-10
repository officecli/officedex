import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installEmbeddedFrameClock, EMBEDDED_FRAME_CLOCK_SOURCE, withEmbeddedFrameClock } from './embedded-frame-clock.mjs';
function clock() {
  let next = 0;
  const frames = new Map(), timers = new Map();
  const target = { performance: { now: () => 250 },
    requestAnimationFrame: fn => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: fn => { timers.set(++next, fn); return next; },
    clearTimeout: id => timers.delete(id),
  };
  installEmbeddedFrameClock(target);
  return { target, frames, timers };
}
for (const winner of ['frame', 'timer']) test(`paint is delivered once when ${winner} wins, including late browser callbacks`, () => {
  const { target, frames, timers } = clock();
  const values = [];
  target.requestAnimationFrame(t => values.push(t));
  const frame = [...frames.values()][0], timer = [...timers.values()][0];
  if (winner === 'frame') { frame(16); timer(); } else { timer(); frame(500); }
  assert.deepEqual(values, [winner === 'frame' ? 16 : 250]);
  assert.equal(frames.size + timers.size, 0);
});
test('cancel suppresses both queues and reentrant frames keep their own registration', () => {
  const { target, frames, timers } = clock(); let calls = 0;
  const id = target.requestAnimationFrame(() => calls++);
  const stale = [...frames.values(), ...timers.values()];
  target.cancelAnimationFrame(id); stale.forEach(fn => fn(20));
  assert.equal(calls, 0); assert.equal(frames.size + timers.size, 0);
  target.requestAnimationFrame(() => { calls++; target.requestAnimationFrame(() => calls++); });
  [...timers.values()][0](); [...frames.values()][0](300);
  assert.equal(calls, 2); assert.equal(frames.size + timers.size, 0);
});
test('only native editor embeds receive the clock, before module evaluation', () => {
  assert.match(EMBEDDED_FRAME_CLOCK_SOURCE, /location.protocol === 'wails:' && window !== window.top/);
  const html = withEmbeddedFrameClock('<head><script type="module" src="editor.js"></script></head>');
  assert.ok(html.indexOf('officedex-frame-clock.js') < html.indexOf('type="module"'));
});

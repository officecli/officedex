/**
 * WKWebView can suspend iframe rAF delivery while its window is occluded.
 * Editor paint/ready promises must still settle. Scope this adapter to the
 * packaged embeds; normal browser pages retain the browser's frame clock.
 */
export function installEmbeddedFrameClock(target) {
  const request = target.requestAnimationFrame.bind(target);
  const cancel = target.cancelAnimationFrame.bind(target);
  const pending = new Map();
  let next = 0;
  target.requestAnimationFrame = function (callback) {
    const id = ++next;
    const entry = { frame: 0, timer: 0 };
    pending.set(id, entry);
    const finish = (now) => {
      if (!pending.delete(id)) return;
      cancel(entry.frame);
      target.clearTimeout(entry.timer);
      callback.call(target, now);
    };
    entry.frame = request(finish);
    entry.timer = target.setTimeout(() => finish(target.performance.now()), 250);
    return id;
  };
  target.cancelAnimationFrame = function (id) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    cancel(entry.frame);
    target.clearTimeout(entry.timer);
  };
}

export const EMBEDDED_FRAME_CLOCK_FILE = 'officedex-frame-clock.js';
export const EMBEDDED_FRAME_CLOCK_SOURCE = `if (location.protocol === 'wails:' && window !== window.top) { (${installEmbeddedFrameClock.toString()})(window); }\n`;
export function withEmbeddedFrameClock(html) {
  const module = /<script\b[^>]*type=["']module["'][^>]*>/i.exec(html);
  if (!module || module.index === undefined) throw new Error('Embedded editor has no module entry');
  return html.slice(0, module.index) + `<script src="./${EMBEDDED_FRAME_CLOCK_FILE}"></script>\n` + html.slice(module.index);
}

#!/usr/bin/env node

// A tiny browser control plane for the dev-real session.
//
// `dev-real.mjs` gives us the app in a real browser tab; this gives us eyes and
// hands on it: screenshots (full page, region, element), computed styles,
// accessibility trees, pixel hit tests, and real click/drag/type input --
// including inside the Writer iframe, which is where the document actually
// lives.
//
// It runs as a *daemon* so the page keeps its state between commands: HMR
// reloads, selection, scroll position and console history all survive.
//
//   node scripts/dsh/play.mjs serve   # start the daemon (keep it running)
//   node scripts/dsh/play.mjs shot    # then drive it one command at a time
//
// Every command takes one JSON argument (or `-` / nothing for `{}`) and prints
// a compact JSON result. Screenshots are written under build/dev-real/shots/
// and reported by path.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const SHOT_DIR = path.join(ROOT, "build", "dev-real", "shots");
const PORT = Number(process.env.PLAY_PORT ?? 3299);
const APP_URL = process.env.PLAY_URL ?? "";
const HEADLESS = process.env.PLAY_HEADLESS !== "0";

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function short(value, max = 400) {
  const text = String(value ?? "");
  return text.length <= max ? text : `${text.slice(0, max)}…(+${text.length - max})`;
}

/** Never throw on console/network serialization -- some args are circular. */
function safe(value) {
  try {
    if (typeof value === "string") return value;
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/** Compact "path/to/thing" for a frame, so output stays readable. */
function frameLabel(frame) {
  try {
    const url = new URL(frame.url());
    return url.pathname === "/" ? "main" : url.pathname;
  } catch {
    return frame.url() || "about:blank";
  }
}

// ------------------------------------------------------------ element lookup
//
// One description language for every element command:
//
//   { selector: ".toolbar button" }          CSS
//   { text: "保存" }                          first element whose visible text is/contains it
//   { text: "保存", exact: true }             exact visible text only
//   { role: "button", name: "保存" }          accessibility role + name
//   { frame: "/writer/index.html", ...any }   restrict to one frame
//
// Lookup order is always: main frame first, then embedded frames, so a plain
// `{ selector: "h1" }` finds the app chrome before it finds the document.

function frameMatches(frame, want) {
  if (!want) return true;
  return frameLabel(frame) === want || frame.url().includes(want);
}

function candidateFrames(page, spec) {
  const all = page.frames();
  const ordered = [
    ...all.filter((frame) => frame === page.mainFrame()),
    ...all.filter((frame) => frame !== page.mainFrame()),
  ];
  return ordered.filter((frame) => frameMatches(frame, spec.frame));
}

/**
 * Resolves an element description to a locator plus a plain-JS descriptor.
 *
 * The JS descriptor is what gets evaluated inside the page; the locator is what
 * Playwright drives. We build both because evaluation is how we reach into
 * iframes for measurement while Playwright's own frame piercing handles input.
 */
async function resolve(page, spec, { required = true } = {}) {
  if (!spec || typeof spec !== "object") throw new Error("element spec required");
  const frames = candidateFrames(page, spec);
  if (!frames.length) throw new Error(`no frame matches ${JSON.stringify(spec.frame)}`);

  if (spec.role) {
    for (const frame of frames) {
      const locator = frame.getByRole(spec.role, { name: spec.name, exact: spec.exact });
      if (await locator.count()) return { locator: locator.first(), frame, spec };
    }
  }

  if (spec.selector) {
    for (const frame of frames) {
      const locator = frame.locator(spec.selector);
      const count = await locator.count();
      if (!count) continue;
      const index = spec.index ?? 0;
      if (count <= index && required) {
        throw new Error(`selector ${spec.selector} matched ${count}, index ${index} out of range`);
      }
      return { locator: locator.nth(index), frame, spec, count };
    }
  }

  if (spec.text) {
    for (const frame of frames) {
      const locator = frame.getByText(spec.text, { exact: spec.exact ?? false });
      if (await locator.count()) return { locator: locator.first(), frame, spec };
    }
  }

  if (required) throw new Error(`element not found: ${JSON.stringify(spec)}`);
  return null;
}

/** In-page description used by evaluate()-based commands (styles, a11y, boxes). */
const DESCRIBE_FN = `(spec) => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  // Text lookup walks real text nodes, so "rollout-memo.docx" finds the label
  // that owns the text rather than <html>, which merely contains it.
  const all = Array.from(document.querySelectorAll("*"));
  const byText = (exact) => {
    const target = spec.text.trim();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const exactHit = [];
    const looseHit = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || "").trim();
      if (!text) continue;
      const parent = node.parentElement;
      if (!parent || !visible(parent)) continue;
      if (text === target && !exactHit.includes(parent)) exactHit.push(parent);
      else if (text.includes(target) && !looseHit.includes(parent)) looseHit.push(parent);
    }
    const rank = (list) => list.sort((a, b) => {
      const depth = (el) => { let n = 0; for (let p = el; p; p = p.parentElement) n += 1; return n; };
      return depth(b) - depth(a);
    });
    return (exact ? rank(exactHit) : rank(exactHit).concat(rank(looseHit)))[0] || null;
  };
  let el = null;
  let matched = 0;
  if (spec.selector) {
    const list = Array.from(document.querySelectorAll(spec.selector));
    matched = list.length;
    el = list[spec.index || 0] || null;
  } else if (spec.role) {
    const roleOf = (node) => {
      const explicit = node.getAttribute && node.getAttribute("role");
      if (explicit) return explicit;
      const tag = node.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && node.hasAttribute("href")) return "link";
      if (/^h[1-6]$/.test(tag)) return "heading";
      if (tag === "input") return node.type === "checkbox" ? "checkbox" : "textbox";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "img") return "img";
      return null;
    };
    const nameOf = (node) => (node.getAttribute && (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "")).trim();
    const list = all.filter((node) => roleOf(node) === spec.role && (!spec.name || nameOf(node) === spec.name || (!spec.exact && nameOf(node).includes(spec.name))));
    matched = list.length;
    el = list[spec.index || 0] || null;
  } else if (spec.text) {
    el = byText(spec.exact) || null;
  }
  if (!el) return { found: false, matched: matched };
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const attrs = {};
  for (const attr of Array.from(el.attributes || [])) attrs[attr.name] = attr.value;
  const path = [];
  for (let node = el; node && node.nodeType === 1 && path.length < 8; node = node.parentElement) {
    let label = node.tagName.toLowerCase();
    if (node.id) label += "#" + node.id;
    else if (node.classList.length) label += "." + Array.from(node.classList).slice(0, 2).join(".");
    path.unshift(label);
  }
  return {
    found: true,
    matched,
    tag: el.tagName.toLowerCase(),
    path: path.join(" > "),
    id: el.id || null,
    classes: Array.from(el.classList || []),
    attrs,
    text: (el.innerText || el.textContent || "").trim().slice(0, 600),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
    visible: visible(el),
    style: {
      display: style.display, position: style.position, boxSizing: style.boxSizing,
      width: style.width, height: style.height,
      minWidth: style.minWidth, maxWidth: style.maxWidth, minHeight: style.minHeight, maxHeight: style.maxHeight,
      margin: style.margin, padding: style.padding, border: style.border,
      flex: style.flex, flexDirection: style.flexDirection, flexWrap: style.flexWrap, gap: style.gap,
      alignItems: style.alignItems, justifyContent: style.justifyContent,
      gridTemplateColumns: style.gridTemplateColumns,
      overflow: style.overflow, overflowX: style.overflowX, overflowY: style.overflowY,
      whiteSpace: style.whiteSpace, textOverflow: style.textOverflow,
      font: style.font, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
      lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign,
      color: style.color, backgroundColor: style.backgroundColor,
      opacity: style.opacity, zIndex: style.zIndex, visibility: style.visibility,
      scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth, clientHeight: el.clientHeight,
    },
    a11y: { role: el.getAttribute("role") || null, ariaLabel: el.getAttribute("aria-label") || null, tabIndex: el.tabIndex },
  };
}`;

/** Runs DESCRIBE_FN in the first frame that actually has the element. */
async function describe(page, spec) {
  for (const frame of candidateFrames(page, spec)) {
    const result = await frame.evaluate(DESCRIBE_FN, spec).catch(() => ({ found: false, matched: 0 }));
    if (result?.found) return { ...result, frame: frameLabel(frame) };
  }
  // Playwright's own locator can see through iframes in cases eval cannot
  // (e.g. sandboxed frames) -- fall back to it, then re-measure in whichever
  // frame actually owns the element.
  for (const frame of candidateFrames(page, spec)) {
    const locator = spec.selector
      ? frame.locator(spec.selector).nth(spec.index ?? 0)
      : spec.text
        ? frame.getByText(spec.text, { exact: spec.exact ?? false }).first()
        : spec.role
          ? frame.getByRole(spec.role, { name: spec.name, exact: spec.exact }).first()
          : null;
    if (!locator || !(await locator.count().catch(() => 0))) continue;
    const handle = await locator.elementHandle().catch(() => null);
    if (!handle) continue;
    const measured = await frame.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const pick = ["display", "position", "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "margin", "padding", "border", "flex", "flexDirection", "flexWrap", "gap", "alignItems", "justifyContent", "gridTemplateColumns", "overflow", "overflowX", "overflowY", "whiteSpace", "textOverflow", "font", "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textAlign", "color", "backgroundColor", "opacity", "zIndex", "visibility"];
      const out = {};
      for (const prop of pick) out[prop] = style[prop];
      out.scrollWidth = node.scrollWidth;
      out.scrollHeight = node.scrollHeight;
      out.clientWidth = node.clientWidth;
      out.clientHeight = node.clientHeight;
      return { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, style: out, text: (node.innerText || node.textContent || "").trim().slice(0, 600) };
    }, handle).catch(() => null);
    if (!measured) continue;
    return {
      found: true,
      frame: frameLabel(frame),
      tag: await locator.evaluate((node) => node.tagName.toLowerCase()).catch(() => null),
      path: await locator.evaluate((node) => {
        const parts = [];
        for (let n = node; n && n.nodeType === 1 && parts.length < 8; n = n.parentElement) {
          let label = n.tagName.toLowerCase();
          if (n.id) label += "#" + n.id;
          else if (n.classList.length) label += "." + Array.from(n.classList).slice(0, 2).join(".");
          parts.unshift(label);
        }
        return parts.join(" > ");
      }).catch(() => null),
      ...measured,
      note: "resolved via locator",
    };
  }
  return { found: false };
}

// ------------------------------------------------------------------- daemon

let context = null;
let page = null;
const consoleLog = [];
const networkLog = [];
let shotSeq = 0;

function record(page) {
  page.on("console", (message) => {
    consoleLog.push({ at: Date.now(), type: message.type(), text: short(message.text(), 2000) });
    if (consoleLog.length > 400) consoleLog.shift();
  });
  page.on("pageerror", (error) => {
    consoleLog.push({ at: Date.now(), type: "pageerror", text: short(error.message, 2000) });
  });
  page.on("requestfailed", (request) => {
    networkLog.push({ at: Date.now(), kind: "failed", url: request.url(), error: request.failure()?.errorText });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) networkLog.push({ at: Date.now(), kind: "http", status: response.status(), url: response.url() });
    if (networkLog.length > 400) networkLog.shift();
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) consoleLog.push({ at: Date.now(), type: "navigation", text: frame.url() });
  });
}

import { mkdtemp } from "node:fs/promises";
import os from "node:os";

async function newPage(view = { width: 1440, height: 900 }) {
  if (page && !page.isClosed()) await page.close().catch(() => {});
  page = await context.newPage();
  await page.setViewportSize(view);
  record(page);
  if (APP_URL) {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(Number(process.env.PLAY_SETTLE_MS ?? 3500));
  }
  return page;
}

/** Waits for HMR to settle so a screenshot is not taken mid-swap. */
async function settle(ms = 350) {
  await sleep(ms);
}

const handlers = {
  async state() {
    return {
      url: page.url(),
      title: await page.title(),
      viewport: page.viewportSize(),
      frames: page.frames().map(frameLabel),
      consoleErrors: consoleLog.filter((entry) => entry.type === "error" || entry.type === "pageerror").slice(-12),
      networkIssues: networkLog.slice(-12),
    };
  },

  /** Region/element/full screenshots. `clip` is in page CSS pixels. */
  async shot(input = {}) {
    await mkdir(SHOT_DIR, { recursive: true });
    let target = page;
    let clip = input.clip;
    if (input.selector || input.text || input.role) {
      const hit = await resolve(page, input);
      target = hit;
      if (!clip) {
        const box = await hit.locator.boundingBox();
        if (!box) throw new Error("element has no box (not visible?)");
        const pad = input.pad ?? 0;
        clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
      }
    }
    const file = path.join(SHOT_DIR, input.name ?? `shot-${String(++shotSeq).padStart(3, "0")}.png`);
    const options = {
      path: file,
      fullPage: input.fullPage ?? false,
      clip,
      scale: input.scale ?? "css",
    };
    if (target === page) await page.screenshot(options);
    else await target.locator.screenshot({ ...options, clip: undefined });
    const { size } = await (await import("node:fs/promises")).stat(file);
    return { file, clip: clip ?? null, viewport: page.viewportSize(), bytes: size };
  },

  async styles(input) {
    const result = await describe(page, input);
    if (!result.found) throw new Error(`element not found: ${JSON.stringify(input)}`);
    if (input.props) {
      const wanted = {};
      for (const prop of input.props) wanted[prop] = result.style?.[prop] ?? result.attrs?.[prop] ?? null;
      return { frame: result.frame, path: result.path, rect: result.rect, props: wanted };
    }
    return result;
  },

  async dom(input) {
    const hit = await resolve(page, input);
    return hit.frame.evaluate(([spec, depth, maxDepth]) => {
      const el = document.querySelector(spec.selector) || null;
      if (!el) return null;
      const lines = [];
      const walk = (node, level) => {
        if (level > maxDepth) return;
        const tag = node.tagName.toLowerCase();
        const id = node.id ? `#${node.id}` : "";
        const cls = Array.from(node.classList).slice(0, 4).join(".");
        const rect = node.getBoundingClientRect();
        const own = Array.from(node.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
        const label = `${"  ".repeat(level)}${tag}${id}${cls ? "." + cls : ""} [${Math.round(rect.width)}x${Math.round(rect.height)}]${own ? ` "${own.slice(0, 40)}"` : ""}`;
        lines.push(label);
        for (const child of Array.from(node.children)) walk(child, level + 1);
      };
      walk(el, 0);
      return lines.join("\n");
    }, [input, 0, input.depth ?? 3]);
  },

  async a11y(input = {}) {
    const scope = input.frame
      ? candidateFrames(page, input).find((frame) => frameMatches(frame, input.frame))
      : page.mainFrame();
    if (!scope) throw new Error(`no frame matches ${input.frame}`);
    return scope.evaluate(() => {
      const roleOf = (node) => {
        const explicit = node.getAttribute("role");
        if (explicit) return explicit;
        const tag = node.tagName.toLowerCase();
        if (tag === "button") return "button";
        if (tag === "a" && node.hasAttribute("href")) return "link";
        if (/^h[1-6]$/.test(tag)) return `heading${tag.slice(1)}`;
        if (tag === "input") return node.type === "checkbox" ? "checkbox" : "textbox";
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "combobox";
        if (tag === "img") return "img";
        if (tag === "nav") return "navigation";
        return null;
      };
      const nodes = Array.from(document.querySelectorAll("body *"));
      const out = [];
      for (const node of nodes) {
        const role = roleOf(node);
        if (!role) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const name = (node.getAttribute("aria-label") || node.getAttribute("title") || node.innerText || node.textContent || "").trim().replace(/\s+/g, " ");
        out.push({
          role,
          name: name.slice(0, 120),
          tag: node.tagName.toLowerCase(),
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          ariaHidden: node.getAttribute("aria-hidden"),
          tabIndex: node.tabIndex,
        });
      }
      return out;
    });
  },

  async eval(input) {
    const frame = input.frame
      ? candidateFrames(page, input).find((item) => frameMatches(item, input.frame))
      : page.mainFrame();
    if (!frame) throw new Error(`no frame matches ${input.frame}`);
    // `code` is an expression evaluating to a function, e.g. "() => 42" or
    // "async () => await fetch(...)"; evaluate() awaits whatever it returns.
    const result = await frame
      .evaluate((source) => Promise.resolve().then(() => eval(source)()), input.code)
      .catch((error) => ({ __error: String(error), stack: short(error.stack, 500) }));
    return result;
  },

  async hitTest(input) {
    const point = input.at ?? (() => { throw new Error("hitTest needs {at:[x,y]}"); })();
    return page.evaluate(([x, y]) => {
      const stack = document.elementsFromPoint(x, y).slice(0, 6).map((node) => {
        let label = node.tagName.toLowerCase();
        if (node.id) label += `#${node.id}`;
        else if (node.classList.length) label += "." + Array.from(node.classList).slice(0, 2).join(".");
        return label;
      });
      return { at: [x, y], stack };
    }, point);
  },

  async click(input = {}) {
    if (input.at) {
      await page.mouse.click(input.at[0], input.at[1], { button: input.button ?? "left" });
      return { clicked: input.at };
    }
    const hit = await resolve(page, input);
    await hit.locator.click({ button: input.button ?? "left", clickCount: input.count ?? 1, force: input.force });
    return { clicked: true };
  },

  async hover(input) {
    if (input.at) {
      await page.mouse.move(input.at[0], input.at[1]);
      return { hovered: input.at };
    }
    const hit = await resolve(page, input);
    await hit.locator.hover();
    return { hovered: true };
  },

  /** Real press-move-release so drag handlers see intermediate mousemove. */
  async drag(input) {
    const pointOf = async (raw, spec) => {
      if (Array.isArray(raw)) return { x: raw[0], y: raw[1] };
      const hit = await resolve(page, spec);
      const box = await hit.locator.boundingBox();
      if (!box) throw new Error("drag target has no box");
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const startPoint = await pointOf(input.from, input.start);
    const endPoint = await pointOf(input.at, input.end);
    await page.mouse.move(startPoint.x, startPoint.y);
    await page.mouse.down();
    const steps = input.steps ?? 18;
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(
        startPoint.x + ((endPoint.x - startPoint.x) * step) / steps,
        startPoint.y + ((endPoint.y - startPoint.y) * step) / steps,
      );
      await sleep(input.stepDelayMs ?? 12);
    }
    await page.mouse.up();
    return { from: startPoint, to: endPoint };
  },

  async type(input) {
    const text = input.text ?? "";
    if (input.at || input.selector || input.text === undefined) {
      const hit = await resolve(page, input);
      await hit.locator.click();
    }
    await page.keyboard.type(text, { delay: input.delayMs ?? 20 });
    return { typed: text.length };
  },

  async press(input) {
    const keys = input.keys ?? [input.key];
    for (const key of keys) {
      await page.keyboard.press(key);
      await sleep(input.stepDelayMs ?? 60);
    }
    return { pressed: keys };
  },

  async scroll(input) {
    if (input.at) {
      await page.mouse.move(input.at[0], input.at[1]);
      await page.mouse.wheel(0, input.dy ?? 0);
      return { scrolled: input.dy ?? 0 };
    }
    const hit = await resolve(page, input);
    await hit.locator.evaluate((node, [dy, dx]) => { node.scrollTop += dy; node.scrollLeft += dx; }, [input.dy ?? 0, input.dx ?? 0]);
    return { scrolled: input.dy ?? 0 };
  },

  async viewport(input) {
    await page.setViewportSize({ width: input.width ?? 1440, height: input.height ?? 900 });
    return { viewport: page.viewportSize() };
  },

  async reload(input = {}) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    if (input.waitMs !== 0) await page.waitForTimeout(input.waitMs ?? 3500);
    return { url: page.url(), frames: page.frames().map(frameLabel) };
  },

  async waitFor(input) {
    const deadline = Date.now() + (input.timeoutMs ?? 20000);
    for (;;) {
      const result = input.code
        ? await page.evaluate(input.code).catch(() => false)
        : (await describe(page, input)).found;
      if (result) return { ok: true, result: safe(result) };
      if (Date.now() > deadline) throw new Error("waitFor timed out");
      await sleep(input.pollMs ?? 250);
    }
  },

  async console(input = {}) {
    let entries = consoleLog;
    if (input.since) entries = entries.filter((entry) => entry.at >= input.since);
    if (input.types) entries = entries.filter((entry) => input.types.includes(entry.type));
    return { count: entries.length, entries: entries.slice(-(input.limit ?? 60)) };
  },

  async network(input = {}) {
    let entries = networkLog;
    if (input.since) entries = entries.filter((entry) => entry.at >= input.since);
    return { count: entries.length, entries: entries.slice(-(input.limit ?? 40)) };
  },

  async clear() {
    consoleLog.length = 0;
    networkLog.length = 0;
    return { cleared: true };
  },

  async quit() {
    setTimeout(() => process.exit(0), 200);
    return { quitting: true };
  },
};

async function serve() {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "dsh-play-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    args: ["--font-render-hinting=none"],
  });
  context.setDefaultTimeout(15000);
  await newPage();
  await settle(0);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const name = url.pathname.replace(/^\//, "") || "state";
    const handler = handlers[name];
    if (!handler) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: `no such command: ${name}` }));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    let input = {};
    if (body.trim()) {
      try {
        input = JSON.parse(body);
      } catch (error) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: `bad JSON: ${error.message}` }));
        return;
      }
    }
    const started = Date.now();
    try {
      const result = await handler(input);
      await settle(input.settleMs ?? 250);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, ms: Date.now() - started, result: safe(result) }));
    } catch (error) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, ms: Date.now() - started, error: String(error.message ?? error), stack: short(error.stack, 800) }));
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(JSON.stringify({ ready: true, port: PORT, url: page.url() }));
  });
  process.on("SIGTERM", async () => {
    await context.close().catch(() => {});
    process.exit(0);
  });
}

async function client() {
  const [, , commandName, rawArg] = process.argv;
  const input = rawArg && rawArg !== "-" ? JSON.parse(rawArg) : {};
  const response = await fetch(`http://127.0.0.1:${PORT}/${commandName ?? "state"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json();
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exit(1);
}

const mode = process.argv[2] ?? "client";
if (mode === "serve") await serve();
else await client();

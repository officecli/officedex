#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3120";
const HOST = (process.env.OFFICEDEX_REAL_E2E_ENDPOINT || "http://127.0.0.1:57364").replace(/\/+$/, "");
const OUT = path.resolve("test-results/tiktok-ui-run");
const PROMPT =
  "请做一份介绍 TikTok 运营的 PPT。用自由构图，不要套同一套列表模板。内容覆盖定位、短视频生产、钩子、发布节奏、推荐流和复盘。必须包含可编辑的原生图表，用来展示趋势、栏目对比和内容结构。大约 20 页。请走 aippt-jssdk-design Skill 的自由构图，用 JSSDK 生成可编辑的 native chartSpace，不要用图片或 SVG 假图表。";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  log("screenshot", file);
}

async function hostControl(pathname) {
  const response = await fetch(`${HOST}${pathname}`);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: response.ok, status: response.status, body };
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60_000);
page.on("pageerror", (error) => log("pageerror", error.message));
page.on("console", (msg) => {
  if (msg.type() === "error") log("console.error", msg.text());
});
page.on("response", async (response) => {
  if (response.status() < 400) return;
  let body = "";
  try {
    body = (await response.text()).slice(0, 500);
  } catch {
    body = "<unreadable>";
  }
  log("http", response.status(), response.url(), body);
});

await mkdir(OUT, { recursive: true });

try {
  log("goto", BASE);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByText("OfficeDex").first().waitFor({ timeout: 60_000 });
  const skip = page.getByRole("button", { name: /Skip for now/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    log("dismissed onboarding");
  }
  await shot(page, "01-home");

  const pptx = page.locator("button.doc-type--pptx").first();
  if (await pptx.isVisible().catch(() => false)) {
    await pptx.click();
    log("selected PPTX");
  }

  const textarea = page.locator("form.home-intake textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 30_000 });
  await textarea.fill(PROMPT, { force: true });
  const value = await textarea.inputValue();
  log("prompt length", value.length);
  if (value !== PROMPT) {
    await textarea.evaluate((el, next) => {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
      descriptor?.set?.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, PROMPT);
    log("prompt force-set via native setter", (await textarea.inputValue()).length);
  }
  await shot(page, "02-filled");

  const start = page.locator("button.od-button--circular-submit").last();
  const disabled = await start.isDisabled();
  log("submit disabled", disabled);
  if (disabled) {
    throw new Error("Submit stayed disabled after filling the home prompt");
  }
  await start.click({ force: true });
  log("clicked Start creating");
  await page.waitForTimeout(1500);
  await shot(page, "03-after-submit");

  for (const name of [/Create execution plan/i, /Confirm and start/i, /Confirm and start|确认并开始/i]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      log("clicked confirm", String(name));
      await page.waitForTimeout(1000);
    }
  }
  await shot(page, "04-after-confirm");

  const startedAt = Date.now();
  const deadline = startedAt + 50 * 60 * 1000;
  let lastShot = 0;
  let lastNote = "";
  let retries = 0;
  while (Date.now() < deadline) {
    const currentFailed = page.getByText("制作未能完成").filter({ visible: true }).first();
    if (await currentFailed.isVisible().catch(() => false)) {
      await shot(page, "failed");
      const detail = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
      throw new Error(`Generation failed in the OfficeDex UI: ${detail}`);
    }

    const onHome = await page.locator("form.home-intake").isVisible().catch(() => false);
    const attention = page.locator(".home-attention-row").first();
    if (onHome && await attention.isVisible().catch(() => false)) {
      await attention.click();
      log("opened attention row");
      await page.waitForTimeout(400);
    }

    for (const name of [
      /Continue|继续确认|确认方向并继续|Confirm direction|Start drawing|开始绘制|Approve plan|确认计划|开始执行|Create execution plan|Confirm and start/i,
    ]) {
      const button = page.getByRole("button", { name }).first();
      if (await button.isVisible().catch(() => false) && await button.isEnabled().catch(() => false)) {
        await button.click();
        log("clicked stage button");
        await page.waitForTimeout(800);
      }
    }

    const approve = page.locator("button.plan-review-approve").first();
    if (await approve.isVisible().catch(() => false)) {
      await approve.click();
      log("approved plan");
      await page.waitForTimeout(800);
    }

    const option = page.locator(".question-composer-option").first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
      log("picked question option");
      await page.waitForTimeout(800);
    }

    const confirmNode = page.getByRole("button", { name: /确认这个节点|确认所属|Confirm this node|Confirm parent/i }).first();
    if (await confirmNode.isVisible().catch(() => false)) {
      await confirmNode.dispatchEvent("click");
      log("confirmed vibe node");
      await page.waitForTimeout(600);
    }

    const pending = page.locator(".living-tree-flow-node.is-confirmable.is-pending").first();
    if (await pending.isVisible().catch(() => false)) {
      await pending.dispatchEvent("click");
      log("clicked pending vibe node");
      await page.waitForTimeout(600);
    }

    const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 240);
    if (bodyText && bodyText !== lastNote) {
      lastNote = bodyText;
      log("ui", bodyText);
    }

    const complete = await page.getByText("Generation Complete").first().isVisible().catch(() => false);
    const preview = await page.getByRole("button", { name: /Open in app|Show in folder/i }).first().isVisible().catch(() => false);
    const latest = await hostControl("/control/artifacts/latest");
    if (complete || preview || latest.ok) {
      await shot(page, "05-complete");
      const result = {
        complete,
        preview,
        durationMs: Date.now() - startedAt,
        artifact: latest.body,
      };
      await writeFile(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
      log("DONE", JSON.stringify(result, null, 2));
      await page.waitForTimeout(5000);
      process.exit(0);
    }

    if (Date.now() - lastShot > 20_000) {
      lastShot = Date.now();
      await shot(page, `progress-${Math.round((Date.now() - startedAt) / 1000)}s`);
    }
    await page.waitForTimeout(1500);
  }

  await shot(page, "timeout");
  throw new Error("Timed out waiting for OfficeDex UI PPTX generation");
} catch (error) {
  log("ERROR", error instanceof Error ? error.stack || error.message : error);
  await shot(page, "error").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

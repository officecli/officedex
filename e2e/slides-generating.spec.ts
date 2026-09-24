import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_PHASES = ["research", "outline", "writing", "drawing", "polish"] as const;
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, "../docs/ui-audit-2026-09-19/slides-generating");

async function measure(page: Page) {
  return page.evaluate(() => {
    const mark = document.querySelector(".shell-gen-rider .od-mark") as HTMLElement | null;
    const slide = document.querySelector(".shell-gen-slide") ?? document.querySelector(".shell-gen-stage");
    const panel = document.querySelector(".shell-gen-panel");
    const badge = document.querySelector(".shell-gen-badge");
    const eye = document.querySelector(".shell-gen-rider .od-mark__eye") as HTMLElement | null;
    if (!mark || !slide) return { error: "missing mark or slide" };

    const overlap = (a: DOMRect, b: DOMRect) => {
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? w * h : 0;
    };
    const markBox = mark.getBoundingClientRect();
    let text = 0;
    const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) text += overlap(markBox, rect);
    }
    const panelArea = panel && getComputedStyle(panel).opacity !== "0" ? overlap(markBox, panel.getBoundingClientRect()) : 0;
    const badgeArea = badge && getComputedStyle(badge).opacity !== "0" ? overlap(markBox, badge.getBoundingClientRect()) : 0;
    const transform = eye ? getComputedStyle(eye).transform : "";
    const matrix = /matrix\(([^)]+)\)/.exec(transform);
    const tx = matrix ? Math.abs(Number(matrix[1].split(",")[4])) : 0;
    const ty = matrix ? Math.abs(Number(matrix[1].split(",")[5])) : 0;
    const gazeX = mark.style.getPropertyValue("--gaze-x");
    return {
      text: Math.round(text),
      panel: Math.round(panelArea),
      badge: Math.round(badgeArea),
      eyeShift: Math.max(tx, ty),
      markSize: markBox.width,
      gazeX,
      phase: document.querySelector(".shell-gen")?.getAttribute("data-phase"),
      thumbs: document.querySelectorAll(".shell-gen-thumb").length,
      sketch: Boolean(document.querySelector(".shell-gen-slide.is-sketch")),
    };
  });
}

test.describe("slides generating canvas", () => {
  test("phase screenshots, zero text overlap, readable gaze", async ({ page }) => {
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/e2e/harness/slides-generating.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='shell-slides-generating']");

    const numbers: Record<string, Awaited<ReturnType<typeof measure>>> = {};

    for (const phase of AGENT_PHASES) {
      await page.evaluate((next) => window.__slidesGenerating?.goto(next), phase);
      await page.waitForSelector(`[data-testid='shell-slides-generating'][data-phase='${phase}']`);
      await page.waitForTimeout(phase === "research" ? 900 : 1300);
      await page.screenshot({ path: join(shots, `${phase}-full.png`), fullPage: true });
      const stage = page.locator(".shell-gen-stage");
      await stage.screenshot({ path: join(shots, `${phase}-canvas.png`) });
      numbers[phase] = await measure(page);
    }

    for (const phase of AGENT_PHASES) {
      expect(numbers[phase].text, `${phase} text overlap`).toBe(0);
      expect(numbers[phase].panel, `${phase} panel overlap`).toBe(0);
      expect(numbers[phase].badge, `${phase} badge overlap`).toBe(0);
    }
    expect(numbers.research?.markSize ?? 0).toBeGreaterThanOrEqual(88);
    expect(numbers.outline?.thumbs).toBe(5);
    expect(numbers.outline?.sketch).toBe(true);
    expect(numbers.writing?.thumbs).toBe(5);
    expect(numbers.writing?.sketch).toBe(true);

    await page.evaluate(() => window.__slidesGenerating?.goto("research"));
    await page.waitForSelector("[data-testid='shell-slides-generating'][data-phase='research']");
    await page.waitForTimeout(200);
    const amplitude = await page.evaluate(() => {
      const mark = document.querySelector(".shell-gen-rider .od-mark") as HTMLElement | null;
      const eye = document.querySelector(".shell-gen-rider .od-mark__eye") as HTMLElement | null;
      if (!mark || !eye) return 0;
      mark.style.setProperty("--gaze-x", "1");
      mark.style.setProperty("--gaze-y", "0");
      eye.style.transition = "none";
      void eye.offsetWidth;
      const matrix = /matrix\(([^)]+)\)/.exec(getComputedStyle(eye).transform);
      return matrix ? Math.abs(Number(matrix[1].split(",")[4])) : 0;
    });
    expect(amplitude, "eye translate at full gaze").toBeGreaterThanOrEqual(5);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".shell-skeleton-slide")).toBeVisible();
    await expect(page.locator("[data-testid='shell-slides-generating']")).toHaveCount(0);

    console.log(JSON.stringify({ numbers, amplitude }, null, 2));
  });
});

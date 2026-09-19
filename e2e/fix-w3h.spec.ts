/**
 * Wave 3, track H — the canvas contract.
 *
 * Five findings (S4-002, S4-003, S4-009, S4-010, S6-015) with one cause: the
 * shell and the editor mounted inside it had no way to tell each other
 * anything. The presence placed itself against the viewport and landed on the
 * sheet tab strip; `App` drew a status bar over three editors that each draw
 * one; and nothing told a mounted runtime which language to speak.
 *
 * This file is the fence around the two channels that fixed it
 * (`src/shell/editor/canvasSurface.ts`, `…/canvasLocale.ts`), and it asserts
 * the *absence* case as hard as the presence case. A channel whose silent
 * default is wrong is worse than no channel at all: `createShellCanvas()`
 * returns null in every browser, so silence is the common path, and it has to
 * mean "behave exactly as before".
 *
 * **No `test.skip`, conditional or otherwise.** `e2e/ui-audit-s4.spec.ts` is 30
 * cases gated on `S4_BRIDGE`; run without it they print `30 skipped` and exit
 * 0, which reads like success and once was reported as such. Everything here
 * runs against the fixture server, which needs a dev server and nothing else —
 * `?canvasChrome=` exists precisely so the channel is reachable without a real
 * editor (see `dev/fixture.ts`).
 *
 * **What it does not prove.** The numbers each editor reports (36px for the
 * workbook footer, 32px for the two status bars) were measured on `dev-real`
 * during the audit and are restated as constants; this file proves the shell
 * does the right thing *with* them, not that they are still the right numbers.
 * Nothing here has a real editor in it.
 *
 *   npx vite --port 3171 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3171 npx playwright test e2e/fix-w3h.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

interface CanvasProbe {
  surface: () => { box: unknown; chrome: { insets: Record<string, number>; ownsStatusBar: boolean } | null };
  locale: () => string | null;
}

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?shellFixture=1&${query}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  await settle(page);
}

/** Two identical readings of the presence box — see the note in fix-w1b. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector(".shell-presence-panel, .shell-presence-face");
      if (!panel) return true;
      const now = JSON.stringify(panel.getBoundingClientRect());
      const previous = (window as unknown as { __settleLast?: string }).__settleLast;
      (window as unknown as { __settleLast?: string }).__settleLast = now;
      return previous === now;
    },
    undefined,
    { polling: 100 },
  );
}

function readChannels(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __officedexCanvas?: CanvasProbe }).__officedexCanvas;
    if (!probe) return null;
    return { surface: probe.surface(), locale: probe.locale() };
  });
}

async function presenceRect(page: Page) {
  const box = await page.locator(".shell-presence-panel").boundingBox();
  expect(box, "the floating panel has no box").not.toBeNull();
  return box!;
}

/* ───────────────────────────────── silence ───────────────────────────────── */

test("with no editor mounted the channel is empty, not zero", async ({ page }) => {
  await open(page, "shell=C9");
  const channels = await readChannels(page);
  expect(channels, "the dev probe is missing — is this the fixture build?").not.toBeNull();
  // The box is reported (the host is on screen); the chrome is not, because
  // nothing is mounted in it. Those are different facts and the shell acts on
  // the pair, never on the box alone.
  expect(channels!.surface.box).not.toBeNull();
  expect(channels!.surface.chrome).toBeNull();
});

test("silence leaves the panel in the corner it used before this channel existed", async ({
  page,
}) => {
  await open(page, "shell=C9");
  const rect = await presenceRect(page);
  const viewport = page.viewportSize()!;
  // `HOME_OFFSET.bottom` is 28 (presenceLayout.ts). Unchanged from W1-B.
  expect(Math.round(rect.y + rect.height)).toBe(viewport.height - 28);
});

test("silence leaves the shell's own status bar exactly where it was", async ({ page }) => {
  await open(page, "shell=C9");
  await expect(page.locator(".shell-statusbar")).toBeVisible();
  const height = await page.evaluate(() =>
    getComputedStyle(document.getElementById("shell")!).getPropertyValue("--shell-statusbar-h").trim(),
  );
  expect(height).toBe("32px");
});

/* ─────────────────────────── a reporting editor ──────────────────────────── */

test("a reported bottom strip moves the panel's first landing point off it", async ({ page }) => {
  await open(page, "shell=C9");
  const before = await presenceRect(page);

  await open(page, "shell=C9&canvasChrome=sheet");
  const after = await presenceRect(page);
  const viewport = page.viewportSize()!;

  const channels = await readChannels(page);
  expect(channels!.surface.chrome).not.toBeNull();
  expect(channels!.surface.chrome!.insets.bottom).toBe(36);

  // The workbook's footer owns the bottom 36px of the window. The panel used to
  // start 28px off the bottom, i.e. 8px inside it (S4-002, S6-015).
  const keepOutTop = viewport.height - 36;
  expect(after.y + after.height).toBeLessThanOrEqual(keepOutTop);
  expect(after.y + after.height).toBeLessThan(before.y + before.height);
});

test("the panel dragged to the bottom edge still stops above the editor's strip", async ({
  page,
}) => {
  await open(page, "shell=C9&canvasChrome=sheet");
  const grip = page.locator(".shell-presence-panel .shell-task-head");
  const box = await grip.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 12);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, 1400, { steps: 24 });
  await page.mouse.up();
  await settle(page);

  const rect = await presenceRect(page);
  const viewport = page.viewportSize()!;
  // Not just the first landing point: the clamp reads the same safe area, which
  // is the whole reason W1-B threaded `safeArea` through `placePresence` rather
  // than offsetting the default position.
  expect(Math.round(rect.y + rect.height)).toBeLessThanOrEqual(viewport.height - 36);
});

test("an editor that owns a status bar takes the shell's place, not a second row", async ({
  page,
}) => {
  await open(page, "shell=C9&canvasChrome=sheet");
  await expect(page.locator(".shell-statusbar")).toHaveCount(0);
  const measured = await page.evaluate(() => {
    const shell = document.getElementById("shell")!;
    const canvas = document.querySelector(".shell-canvas")!;
    const attention = document.querySelector(".shell-attention")!;
    return {
      token: getComputedStyle(shell).getPropertyValue("--shell-statusbar-h").trim(),
      canvasBottom: Math.round(canvas.getBoundingClientRect().bottom),
      attentionBottom: Math.round(attention.getBoundingClientRect().bottom),
    };
  });
  expect(measured.token).toBe("0px");
  // The canvas reaches the window, and the attention border reaches the canvas.
  // Leaving the token at 32px is how the border ends up tracing a line 32px
  // above the document it is supposed to be around.
  expect(measured.canvasBottom).toBe(page.viewportSize()!.height);
  expect(measured.attentionBottom).toBe(measured.canvasBottom);
});

test("the three editors report three different strips, and each is honoured", async ({ page }) => {
  for (const [name, bottom] of [
    ["sheet", 36],
    ["slides", 32],
    ["doc", 32],
  ] as const) {
    await open(page, `shell=C9&canvasChrome=${name}`);
    const channels = await readChannels(page);
    expect(channels!.surface.chrome!.insets.bottom, name).toBe(bottom);
    const rect = await presenceRect(page);
    expect(Math.round(rect.y + rect.height), name).toBeLessThanOrEqual(
      page.viewportSize()!.height - bottom,
    );
  }
});

test("going Home withdraws the box, so nothing is reserved over the hero", async ({ page }) => {
  await open(page, "shell=C9&canvasChrome=sheet");
  expect((await readChannels(page))!.surface.box).not.toBeNull();

  await page.goto("/?shellFixture=1&shell=C3&canvasChrome=sheet");
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  await settle(page);
  const channels = await readChannels(page);
  // The chrome is still published — nothing unmounted — but with no box there
  // is nothing to keep out of, which is what `canvasKeepOut` returns zeros for.
  expect(channels!.surface.box).toBeNull();
  // The workspace is hidden rather than unmounted, so the shell's status bar is
  // still in the tree; what matters is that it is not on screen competing with
  // anything, and that Home never had a floating presence to place.
  await expect(page.locator(".shell-statusbar")).not.toBeVisible();
  await expect(page.locator(".shell-presence")).toHaveCount(0);
});

/* ──────────────────────────────── locale ─────────────────────────────────── */

test("the locale channel carries the shell's language, not navigator's", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  await open(page, "shell=C9");
  const channels = await readChannels(page);
  expect(channels!.locale).toBe("zh");
  // The document says so too. `<html lang="en">` around Chinese text is half of
  // what S4-009 measured.
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

test("the locale channel follows a change rather than sampling once", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("officedex.locale", "en"));
  await open(page, "shell=C9");
  expect((await readChannels(page))!.locale).toBe("en");

  await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  await open(page, "shell=C9");
  expect((await readChannels(page))!.locale).toBe("zh");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});

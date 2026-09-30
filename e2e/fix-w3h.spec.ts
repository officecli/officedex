/**
 * Wave 3, track H — the canvas contract.
 *
 * Five findings (S4-002, S4-003, S4-009, S4-010, S6-015) with one cause: the
 * shell and the editor mounted inside it had no way to tell each other anything.
 * The floating presence placed itself against the viewport and landed on the
 * sheet tab strip; `App` drew a status bar over three editors that each draw
 * one; and nothing told a mounted runtime which language to speak.
 *
 * This file is the fence around the two channels that fixed it
 * (`src/shell/editor/canvasSurface.ts`, `…/canvasLocale.ts`), and it asserts the
 * *absence* case as hard as the presence case. A channel whose silent default is
 * wrong is worse than no channel at all: `createShellCanvas()` returns null in
 * every browser, so silence is the common path, and it has to mean "behave
 * exactly as before".
 *
 * ── What r10 moved ─────────────────────────────────────────────────────────
 *
 * Both channels are unchanged. Their consumers are not:
 *
 *  - The floating presence panel and its dock are gone. Dex is the floating
 *    agent affordance now (a 42px bubble over the document), and it keeps off
 *    the editor's bottom controls from its own `editorKind` rather than from
 *    this channel — so the presence-placement cases went with the panel.
 *  - The shell draws no status bar at all: `--shell-statusbar-h` is 0px for
 *    good. So "the editor's status bar takes the shell's place" is no longer a
 *    decision the shell makes each time; what survives is that there is never a
 *    second row, whatever an editor reports.
 *  - The reader that does act on `chrome.insets` is the attention border
 *    (`agent/AttentionBorder.tsx`), which pushes its frame in by the editor's
 *    own chrome so the light traces the document rather than the deck's status
 *    bar. That is where the reported strips are checked here.
 *
 * **No `test.skip`, conditional or otherwise.** `e2e/ui-audit-s4.spec.ts` is 30
 * cases gated on `S4_BRIDGE`; run without it they print `30 skipped` and exit 0,
 * which reads like success and once was reported as such. Everything here runs
 * against the fixture server, which needs a dev server and nothing else —
 * `?canvasChrome=` exists precisely so the channel is reachable without a real
 * editor (see `dev/fixture.ts`).
 *
 * **What it does not prove.** The numbers each editor reports (36px for the
 * workbook footer, 32px for the two status bars) were measured on `dev-real`
 * during the audit and are restated as constants in `src/canvas/editorChrome.ts`;
 * this file proves the shell does the right thing *with* them, not that they are
 * still the right numbers. Nothing here has a real editor in it.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w3h.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

interface CanvasProbe {
  surface: () => { box: unknown; chrome: { insets: Record<string, number>; ownsStatusBar: boolean } | null };
  locale: () => string | null;
}

/**
 * The combination every case here starts from.
 *
 * C5 is the editor page with the audit dataset's working conversation beside it:
 * a run in progress and a document on screen, which is what lights the attention
 * border. C9 is the same content region with no conversation, used where the
 * question is only about the channel.
 */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/?shellFixture=1&${query}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
}

function readChannels(page: Page) {
  return page.evaluate(() => {
    const probe = (window as unknown as { __officedexCanvas?: CanvasProbe }).__officedexCanvas;
    if (!probe) return null;
    return { surface: probe.surface(), locale: probe.locale() };
  });
}

/**
 * How far the attention border's frame sits inside each edge of its host.
 *
 * Read off the overlay's `<rect>` geometry, not off the `<svg>`: the svg fills
 * the host, and the frame is the rectangle painted inside it, in the host's own
 * coordinates. Those are the numbers `AttentionBorder` computes from `inset` plus
 * whatever the editor reported, so they are the thing under test.
 *
 * The geometry eases toward its target rather than jumping, so this waits for two
 * identical readings — a measurement taken mid-transition is a position on its
 * way somewhere else, which is the hazard the audit specs recorded as MERGE-002.
 */
interface FrameInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function frameInsets(page: Page): Promise<FrameInsets> {
  const frame = await page.waitForFunction<FrameInsets | null>(
    () => {
      const host = document.querySelector<HTMLElement>(".dx-editor-wrapper .shell-attention");
      const rect = host?.querySelector("rect");
      if (!host || !rect) return null;
      const read = (name: string) => Math.round(parseFloat(rect.getAttribute(name) ?? "NaN"));
      const now = {
        left: read("x"),
        top: read("y"),
        right: Math.round(host.clientWidth) - (read("x") + read("width")),
        bottom: Math.round(host.clientHeight) - (read("y") + read("height")),
      };
      const key = JSON.stringify(now);
      const store = window as unknown as { __w3hLast?: string };
      const settled = store.__w3hLast === key;
      store.__w3hLast = key;
      return settled ? now : null;
    },
    undefined,
    { polling: 120 },
  );
  // `waitForFunction` only resolves once the predicate returns something truthy,
  // so the null branch above is what the wait is made of rather than a result.
  return (await frame.jsonValue())!;
}

/** The frame's own clearance from the host edge, with no editor reporting. */
const INSET = 16;

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

test("silence leaves the attention frame exactly where it was", async ({ page }) => {
  // The "no information" answer has to be the additive identity: with nothing
  // reported the frame sits its own 16px inside the host and no further. A
  // channel that answered zeros as though they were a measurement would be
  // indistinguishable here, which is why the reporting cases below exist.
  await open(page, "shell=C5");
  expect((await readChannels(page))!.surface.chrome).toBeNull();
  expect(await frameInsets(page)).toEqual({ left: INSET, top: INSET, right: INSET, bottom: INSET });
});

test("the shell draws no status bar of its own, reporting editor or not", async ({ page }) => {
  // S4-003 / S4-010 were two status bars on screen, and under the workbook's
  // `position: fixed` footer none at all. r10 settles it once: the shell has no
  // status bar, the save state lives in the tab row, and the token is 0px for
  // good — so an editor that draws one can never be the second.
  for (const query of ["shell=C5", "shell=C5&canvasChrome=sheet", "shell=C5&canvasChrome=slides"]) {
    await open(page, query);
    expect(await page.locator(".shell-statusbar, .dx-statusbar").count(), query).toBe(0);
    const token = await page.evaluate(() =>
      getComputedStyle(document.getElementById("shell")!).getPropertyValue("--shell-statusbar-h").trim(),
    );
    expect(token, query).toBe("0px");
    // The save state is in the tab row instead, and it is still reachable.
    await expect(page.locator(".dx-source-header-actions [data-act=save]")).toHaveCount(1);
  }
});

/* ─────────────────────────── a reporting editor ──────────────────────────── */

test("a reported bottom strip pushes the attention frame off it", async ({ page }) => {
  await open(page, "shell=C5");
  const before = await frameInsets(page);

  await open(page, "shell=C5&canvasChrome=sheet");
  const channels = await readChannels(page);
  expect(channels!.surface.chrome).not.toBeNull();
  expect(channels!.surface.chrome!.insets.bottom).toBe(36);

  const after = await frameInsets(page);
  // eslint-disable-next-line no-console
  console.log(`W3H frame ${JSON.stringify({ before, after })}`);
  // The workbook's footer owns the bottom 36px of the canvas. The frame used to
  // be drawn 16px inside the host whatever was in it, i.e. 20px inside the
  // footer, tracing a line across the sheet tab strip (S4-002, S6-015).
  expect(after.bottom).toBe(INSET + 36);
  // Only the edge the editor claimed moves; the other three are the editor's
  // business to claim too, and it claimed nothing there.
  expect({ ...after, bottom: INSET }).toEqual(before);
});

test("the three editors report three different strips, and each is honoured", async ({ page }) => {
  for (const [name, bottom] of [
    ["sheet", 36],
    ["slides", 32],
    ["doc", 32],
  ] as const) {
    await open(page, `shell=C5&canvasChrome=${name}`);
    const channels = await readChannels(page);
    expect(channels!.surface.chrome!.insets.bottom, name).toBe(bottom);
    expect(channels!.surface.chrome!.ownsStatusBar, name).toBe(true);
    expect((await frameInsets(page)).bottom, name).toBe(INSET + bottom);
  }
});

test("going to a page without a canvas withdraws the box, so nothing is reserved", async ({ page }) => {
  await open(page, "shell=C5&canvasChrome=sheet");
  expect((await readChannels(page))!.surface.box).not.toBeNull();

  // Home, with the same fixture editor still reporting.
  await page.goto("/?shellFixture=1&shell=C1&canvasChrome=sheet");
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  const channels = await readChannels(page);
  // The chrome is still published — nothing unmounted — but with no box there is
  // nothing to keep out of, which is what `canvasKeepOut` returns zeros for and
  // what `AttentionBorder` reads as "no insets".
  expect(channels!.surface.chrome).not.toBeNull();
  expect(channels!.surface.box).toBeNull();
  // The document host is hidden rather than unmounted, so it is still in the
  // tree; what matters is that nothing of it is on screen over Home.
  await expect(page.locator(".dx-editor-wrapper")).toHaveAttribute("hidden", "");
  await expect(page.locator(".dx-dex")).toHaveCount(0);
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

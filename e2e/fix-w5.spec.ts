/**
 * W5 — the findings no wave owned, after the fix.
 *
 * The 124 audit findings were split into waves by root cause, and 32 of them
 * fell through: no track owned `src/shell/home/` or Home's composition. This
 * file covers the ones W5 could actually close.
 *
 *   S1-008  the collapsed rail hid the shell's only "New folder" button, and
 *           rendered nine file rows at 0×0 that nothing could reach
 *   S8-008  Agent Home's empty state named two actions the screen could not do
 *   S6-014  the sheet skeleton stopped at row 18, leaving 234px (32%) of white
 *   S6-013  `data-loaded` was written and read by nothing (CSS side only)
 *   S1-009  Editor's sidebar carried a 348px empty box
 *   S3-001  Home's three bands sat on three different left edges
 *   S3-002  Editor Home's heading row ran 52px past the table under it
 *   S3-016  the carousel arrows wore a focus ring inset for a clipping problem
 *           they do not have
 *
 * There is no `test.skip` in this file, conditional or otherwise, for the
 * reason `e2e/fix-w2e.spec.ts` gives: `ui-audit-s4.spec.ts` is 30 cases that
 * all skip, print "30 skipped" and exit 0, and that was read as a pass.
 * Everything here runs against the fixture server, which always exists.
 *
 * Run:
 *   npx vite --port 3161 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3161 npx playwright test e2e/fix-w5.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { open } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W5" };

/** `element.focus()` really moved focus here — not "the element has tabindex". */
async function canFocus(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target: string) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return false;
    element.focus();
    return document.activeElement === element;
  }, selector);
}

async function box(page: Page, selector: string) {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left * 100) / 100,
      right: Math.round(rect.right * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    };
  }, selector);
}

/* ------------------------------------------------------------- S1-008 */

test.describe("S1-008: the collapsed rail can create a folder and open a file", () => {
  // C1 is the shell a new user opens the app in; C5 and C7 are the other two
  // collapsed Agent shells the finding names.
  for (const combination of ["C1", "C5", "C7"] as const) {
    test(`${combination}: "New folder" is visible and focusable on the rail`, async ({ page }) => {
      await open(page, combination, SESSION);

      const head = page.locator(".shell-tree-section-head");
      await expect(head).toBeVisible();

      const button = page.locator(".shell-tree-section-head button");
      await expect(button).toBeVisible();

      const rect = await box(page, ".shell-tree-section-head button");
      // The audit measured this button at exactly 0×0.
      expect(rect, "the New folder button has no box").not.toBeNull();
      expect(rect!.width).toBeGreaterThan(0);
      expect(rect!.height).toBeGreaterThan(0);

      // `newFolderFocusable: false` was the measurement that made this P1.
      expect(await canFocus(page, ".shell-tree-section-head button")).toBe(true);

      // It has to sit inside the 52px rail, not hang out of it.
      const rail = await box(page, ".shell-sidebar");
      expect(rect!.left).toBeGreaterThanOrEqual(rail!.left);
      expect(rect!.right).toBeLessThanOrEqual(rail!.right + 0.5);

      // The label is what does not fit; it is the only thing that goes.
      const labelDisplay = await page.evaluate(() => {
        const label = document.querySelector(".shell-tree-section-head > span");
        return label ? getComputedStyle(label).display : null;
      });
      expect(labelDisplay).toBe("none");

      // eslint-disable-next-line no-console
      console.log(`W5 ${combination}/new-folder ${JSON.stringify(rect)}`);
    });

    test(`${combination}: pressing a folder on the rail opens the sidebar and shows its files`, async ({ page }) => {
      await open(page, combination, SESSION);

      // Nothing invisible is rendered: the nine 0×0 file rows are gone, not
      // merely hidden. "In the DOM but unreachable" is the defect.
      expect(await page.locator(".shell-tree-file-row").count()).toBe(0);
      await expect(page.locator("#shell")).toHaveAttribute("data-nav-collapsed", "true");

      const toggle = page.locator(".shell-tree-folder-toggle").first();
      // Collapsed, a folder claims nothing about being open.
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();

      await expect(page.locator("#shell")).toHaveAttribute("data-nav-collapsed", "false");
      const rows = page.locator(".shell-tree-file-row");
      await expect(rows.first()).toBeVisible();

      const first = await box(page, ".shell-tree-file-row");
      expect(first!.width).toBeGreaterThan(0);
      expect(first!.height).toBeGreaterThan(0);
      expect(await canFocus(page, ".shell-tree-file-open")).toBe(true);

      // eslint-disable-next-line no-console
      console.log(`W5 ${combination}/rail-open rows=${await rows.count()} ${JSON.stringify(first)}`);
    });
  }
});

/* ------------------------------------------------------------- S8-008 */

test.describe("S8-008: the empty state names actions this screen has", () => {
  test("C1: Agent Home offers create and open, next to the sentence that promises them", async ({ page }) => {
    await open(page, "C1", SESSION);

    const actions = page.locator(".shell-home-list .shell-home-new");
    await expect(actions).toHaveCount(4);

    const labels = await actions.allInnerTexts();
    // The four EditorHome offers, so one sentence is true on both Homes.
    expect(labels.map((text) => text.trim())).toEqual([
      "Blank document",
      "Blank workbook",
      "Blank presentation",
      "Open from this computer",
    ]);

    for (let index = 0; index < 4; index += 1) {
      await expect(actions.nth(index)).toBeVisible();
      await expect(actions.nth(index)).toBeEnabled();
    }

    // eslint-disable-next-line no-console
    console.log(`W5 C1/home-actions ${JSON.stringify(labels)}`);
  });

  test("C1: an empty Agent workspace shows the sentence with its controls above it", async ({ page }) => {
    // No `shellFixture`, which is the explicit empty workspace the finding used.
    await page.goto("/?shell=C1");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    const empty = page.locator(".shell-list-empty");
    await expect(empty).toBeVisible();
    await expect(empty.locator("p")).toHaveText("Create a file, or open one from this computer.");

    const actions = page.locator(".shell-home-list .shell-home-new");
    await expect(actions).toHaveCount(4);

    const actionBox = await box(page, ".shell-home-list .shell-home-new");
    const emptyBox = await box(page, ".shell-list-empty");
    // Same screen, and above the sentence rather than six steps away.
    expect(actionBox!.bottom).toBeLessThanOrEqual(emptyBox!.top);

    // eslint-disable-next-line no-console
    console.log(
      `W5 C1/empty-actions actions=${JSON.stringify(actionBox)} empty=${JSON.stringify(emptyBox)}`,
    );
  });

  test("C1: pressing Blank document creates a file and leaves Home", async ({ page }) => {
    await open(page, "C1", SESSION);
    await page.locator(".shell-home-list .shell-home-new").first().click();
    // The control does the thing rather than reporting that it cannot.
    await expect(page.locator("#shell")).toHaveAttribute("data-home", "false");
  });
});

/* ------------------------------------------------------------- S6-014 */

test.describe("S6-014: the sheet skeleton fills the canvas", () => {
  for (const combination of ["C7", "C9"] as const) {
    test(`${combination}: the grid reaches the bottom of the canvas`, async ({ page }) => {
      await open(page, combination, SESSION);
      await page.getByRole("tab", { name: /sales forecast/i }).click();
      await expect(page.locator(".shell-skeleton-grid")).toBeVisible();

      const canvas = await box(page, ".shell-canvas");
      const grid = await box(page, ".shell-skeleton-grid");
      const white = canvas!.bottom - grid!.bottom;

      // Was 234px of white, 32.1% of a 728px canvas. One row (26px) of slack is
      // the most the row grid can leave, and the grid may run past the bottom
      // (it scrolls) rather than stopping short of it.
      expect(white, `${white}px of empty canvas below the sheet skeleton`).toBeLessThan(26);
      expect(grid!.height).toBeGreaterThan(canvas!.height - 26);

      // eslint-disable-next-line no-console
      console.log(
        `W5 ${combination}/sheet-skeleton canvas=${canvas!.height} grid=${grid!.height} white=${white}`,
      );
    });
  }

  test("C9: a shorter window gets fewer rows, not a shorter table", async ({ page }) => {
    await open(page, "C9", SESSION);
    await page.getByRole("tab", { name: /sales forecast/i }).click();
    await expect(page.locator(".shell-skeleton-grid")).toBeVisible();

    const tall = await page.locator(".shell-skeleton-cell").count();
    await page.setViewportSize({ width: 1280, height: 560 });
    await expect
      .poll(async () => page.locator(".shell-skeleton-cell").count())
      .toBeLessThan(tall);

    const canvas = await box(page, ".shell-canvas");
    const grid = await box(page, ".shell-skeleton-grid");
    expect(canvas!.bottom - grid!.bottom).toBeLessThan(26);

    // eslint-disable-next-line no-console
    console.log(`W5 C9/sheet-reflow cells ${tall} -> ${await page.locator(".shell-skeleton-cell").count()}`);
  });
});

/* ------------------------------------------------------------- S6-013 */

test.describe("S6-013: the loading phase looks different from an empty workspace", () => {
  test("C2: `data-loaded=\"false\"` withdraws the empty sentence and shows a bar", async ({ page }) => {
    // No fixture: an empty workspace, which is the state the loading phase was
    // indistinguishable from.
    await page.goto("/?shell=C2");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    const read = async () =>
      page.evaluate(() => {
        const empty = document.querySelector(".shell-list-empty");
        const list = document.querySelector(".shell-home-list");
        return {
          emptyVisibility: empty ? getComputedStyle(empty).visibility : null,
          barContent: list ? getComputedStyle(list, "::before").content : null,
          barHeight: list ? getComputedStyle(list, "::before").height : null,
        };
      });

    const loaded = await read();
    expect(loaded.emptyVisibility).toBe("visible");
    expect(loaded.barContent).toBe("none");

    // Drive the attribute directly: the fixture port resolves within a frame,
    // so the only way to observe the phase is to put the shell in it. This
    // tests the CSS consumption, which is the half W5 owns — `App.tsx` still
    // renders no skeleton of its own (see docs/.../fixes/W5.md).
    await page.evaluate(() => document.querySelector("#shell")!.setAttribute("data-loaded", "false"));

    const loading = await read();
    expect(loading.emptyVisibility).toBe("hidden");
    expect(loading.barContent).not.toBe("none");
    expect(parseFloat(loading.barHeight!)).toBeGreaterThan(0);

    // eslint-disable-next-line no-console
    console.log(`W5 C2/loading ${JSON.stringify(loaded)} -> ${JSON.stringify(loading)}`);
  });
});

/* ------------------------------------------------------------- S1-009 */

test.describe("S1-009: Editor's sidebar has no empty middle", () => {
  for (const combination of ["C4", "C10"] as const) {
    test(`${combination}: the empty sidebar body takes no height`, async ({ page }) => {
      await open(page, combination, SESSION);

      const body = await box(page, ".shell-sidebar-body");
      expect(body, ".shell-sidebar-body is not in the DOM").not.toBeNull();
      const children = await page.locator(".shell-sidebar-body > *").count();
      expect(children, "this case is about the *empty* body").toBe(0);

      // Was 348px in both, measured identical.
      expect(body!.height, `${body!.height}px of empty sidebar`).toBeLessThan(2);

      // And the gap it used to hold open is gone: the views sit under the nav.
      const topNav = await box(page, ".shell-sidebar-top");
      const views = await box(page, ".shell-sidebar-views");
      const gap = views!.top - topNav!.bottom;
      expect(gap, `${gap}px between the top nav and Recent/Pinned`).toBeLessThan(40);

      // eslint-disable-next-line no-console
      console.log(`W5 ${combination}/sidebar-body height=${body!.height} gap=${gap}`);
    });
  }

  test("C2: Agent's sidebar body still takes the slack", async ({ page }) => {
    // The fix is keyed on `:empty`, so the mode that fills it must be unchanged.
    await open(page, "C2", SESSION);
    const children = await page.locator(".shell-sidebar-body > *").count();
    expect(children).toBeGreaterThan(0);
    const body = await box(page, ".shell-sidebar-body");
    expect(body!.height).toBeGreaterThan(100);
  });
});

/* --------------------------------------------------------- S3-001/002 */

test.describe("S3-001 / S3-002: Home is one column", () => {
  test("C1: the carousel, the resume card and the file list share a left edge", async ({ page }) => {
    await open(page, "C1", SESSION);

    const highlights = await box(page, ".shell-highlights");
    const resume = await box(page, ".shell-hero-resume");
    const list = await box(page, ".shell-home-list");

    // Was highlights 126 against 100 and 100 — a 26px step.
    expect(Math.abs(highlights!.left - list!.left)).toBeLessThan(0.5);
    expect(Math.abs(resume!.left - list!.left)).toBeLessThan(0.5);
    expect(Math.abs(highlights!.right - list!.right)).toBeLessThan(0.5);
    expect(Math.abs(resume!.right - list!.right)).toBeLessThan(0.5);

    // eslint-disable-next-line no-console
    console.log(
      `W5 C1/band-left-edges ${JSON.stringify({
        highlights: highlights!.left,
        resume: resume!.left,
        files: list!.left,
      })}`,
    );
  });

  test("C3: Editor Home's heading row and button row match the table", async ({ page }) => {
    await open(page, "C3", SESSION);

    const head = await box(page, ".shell-home-head");
    const actions = await box(page, ".shell-home-actions");
    const list = await box(page, ".shell-home-list");

    // Was head/actions right 1232 against list right 1180 — 52px of overhang.
    expect(Math.abs(head!.right - list!.right)).toBeLessThan(0.5);
    expect(Math.abs(actions!.right - list!.right)).toBeLessThan(0.5);
    expect(Math.abs(head!.left - list!.left)).toBeLessThan(0.5);

    // eslint-disable-next-line no-console
    console.log(
      `W5 C3/editorhome-rects ${JSON.stringify({ head: head!.right, actions: actions!.right, list: list!.right })}`,
    );
  });
});

/* ------------------------------------------------------------- S3-016 */

test.describe("S3-016: the carousel arrows get their own focus ring", () => {
  test("C2: the arrow's ring sits outside it, the card's stays inset", async ({ page }) => {
    await open(page, "C2", SESSION);

    const arrow = page.locator(".shell-highlights-controls button").last();
    await arrow.focus();
    const arrowRing = await page.evaluate(() => {
      const element = document.querySelector(".shell-highlights-controls button:last-child");
      const style = getComputedStyle(element!);
      return { offset: style.outlineOffset, width: style.outlineWidth };
    });
    expect(arrowRing.offset).toBe("1px");

    const card = page.locator(".shell-highlight-card").first();
    await card.focus();
    const cardRing = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector(".shell-highlight-card")!);
      return { offset: style.outlineOffset, width: style.outlineWidth };
    });
    // The card is in the overflow track and still needs the inset ring.
    expect(cardRing.offset).toBe("-2px");

    // eslint-disable-next-line no-console
    console.log(`W5 C2/focus-rings arrow=${JSON.stringify(arrowRing)} card=${JSON.stringify(cardRing)}`);
  });
});

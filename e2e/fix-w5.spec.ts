/**
 * W5 — the findings no wave owned, carried onto the r10 shell.
 *
 * The 124 audit findings were split into waves by root cause, and 32 fell through
 * because no track owned Home or its composition. This file covered the eight W5
 * could close. Each of those is a *class* of defect rather than a single element,
 * so each one below says which r10 surface now answers for it:
 *
 *   S1-008  a control rendered where nothing can reach it. Was nine 0×0 file rows
 *           and a 0×0 "New folder" on the collapsed 52px rail. r10 has no rail —
 *           hidden means 0px (§03) — so the claim is now about the hidden sidebar
 *           and the band that survives it.
 *   S8-008  an empty state naming actions the screen cannot do. Now Home's Recent
 *           and Local's My Files, both of which offer exactly one.
 *   S6-014  a skeleton that stops short of the canvas it is standing in for.
 *   S6-013  "still loading" looking identical to "empty".
 *   S1-009  a container holding height with nothing in it. Was Editor's
 *           `.shell-sidebar-body` at 348px; asked of the whole r10 sidebar here,
 *           since there are no modes to make one region empty.
 *   S3-001  a page whose bands sit on different left edges.
 *   S3-002  a heading row running past the table under it. Was Editor Home; now
 *           Local, which is the page with a heading row over a table.
 *   S3-016  a focus ring drawn where its own container clips it.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w5.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { AUDIT_OPEN_FILE_IDS } from "../src/shell/port/fake/auditSeed";
import { box, open, settle } from "./r10-c-helpers";

/**
 * §03's own tolerance for "these two line up": "同列文字左边界差均 ≤1 CSS px".
 * Used for every edge comparison below so the number is the standard's and not
 * this file's opinion of what looks close enough.
 */
const ALIGN = 1;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // The first-run usage notice covers the bottom-right corner of a fresh context.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("officedex:usage-notice:v2", new Date().toISOString());
    } catch {
      // A context that cannot write storage will just show the notice.
    }
  });
});

/** `element.focus()` really moved focus here — not "the element has tabindex". */
async function canFocus(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target: string) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return false;
    element.focus();
    return document.activeElement === element;
  }, selector);
}

/* ------------------------------------------------------------- S1-008 */

test.describe("S1-008: nothing is rendered where nothing can reach it", () => {
  // C2, C6, C7 and C9 are the four combinations whose sidebar is hidden.
  for (const combination of ["C2", "C6", "C7", "C9"] as const) {
    test(`${combination}: the hidden sidebar is out of reach as well as out of sight`, async ({ page }) => {
      await open(page, combination);

      // §03: "左侧收缩宽度 | 0，完全消失". The column collapses; the panel that
      // would slide out of it is marked `inert` and hidden, so its two dozen
      // controls are neither focusable nor clickable. "In the DOM but reachable
      // while invisible" is the defect, and so is the reverse.
      const sidebar = page.locator("#dx-sidebar");
      await expect(sidebar).toHaveAttribute("inert", "");
      const hidden = await page.evaluate(() => {
        const aside = document.querySelector<HTMLElement>("#dx-sidebar")!;
        const controls = [...aside.querySelectorAll<HTMLElement>("button, [tabindex], input, select")];
        return {
          visibility: getComputedStyle(aside).visibility,
          controls: controls.length,
          focusable: controls.filter((control) => {
            control.focus();
            return document.activeElement === control;
          }).length,
        };
      });
      expect(hidden.controls, "the sidebar has controls to talk about").toBeGreaterThan(0);
      expect(hidden.visibility).toBe("hidden");
      expect(hidden.focusable, `${hidden.focusable} hidden sidebar controls can still take focus`).toBe(0);

      // And the way back is always there: §03 keeps the switch and the traffic
      // lights in the 244px band whatever the sidebar is doing.
      for (const selector of [
        "#dx-global-controls [data-act=toggle-sidebar]",
        "#dx-global-controls [data-act=home]",
      ]) {
        const rect = await box(page, selector);
        expect(rect, `${selector} is not in the DOM`).not.toBeNull();
        expect(rect!.width, `${selector} has no box`).toBeGreaterThan(0);
        expect(rect!.height, `${selector} has no box`).toBeGreaterThan(0);
        expect(await canFocus(page, selector)).toBe(true);
        // It sits inside the band, not hanging out of it.
        const band = await box(page, "#dx-global-controls");
        expect(rect!.left).toBeGreaterThanOrEqual(band!.left - 0.5);
        expect(rect!.right).toBeLessThanOrEqual(band!.right + 0.5);
      }
    });

    test(`${combination}: resting on the switch brings the sidebar back, whole`, async ({ page }) => {
      await open(page, combination);

      // §03: "悬停开关临时覆盖展开" — the temporary reveal, which is the r10
      // replacement for pressing a folder on the rail. Everything it holds has to
      // come back reachable, not just visible.
      await page.locator("#dx-global-controls [data-act=toggle-sidebar]").hover();
      await expect(page.locator("#dx-workspace")).toHaveClass(/dx-sidebar-peek/);
      await settle(page);

      const shown = await page.evaluate(() => {
        const aside = document.querySelector<HTMLElement>("#dx-sidebar")!;
        const controls = [...aside.querySelectorAll<HTMLElement>("button")];
        return {
          visibility: getComputedStyle(aside).visibility,
          controls: controls.length,
          focusable: controls.filter((control) => {
            control.focus();
            return document.activeElement === control;
          }).length,
          boxless: controls
            .filter((control) => {
              const rect = control.getBoundingClientRect();
              return rect.width === 0 || rect.height === 0;
            })
            .map((control) => control.getAttribute("data-act") ?? control.className),
        };
      });
      expect(shown.visibility).toBe("visible");
      expect(shown.focusable, "every revealed control can take focus").toBe(shown.controls);
      // The 0×0 rows are what made the original finding a P1.
      expect(shown.boxless, `revealed controls with no box: ${shown.boxless.join(", ")}`).toEqual([]);

      // The sidebar covers the content region rather than pushing it: the column
      // itself is still 0 (§03), which is why the reveal is temporary.
      const nav = await page.evaluate(() =>
        getComputedStyle(document.querySelector("#dx-workspace")!).getPropertyValue("--dx-nav").trim(),
      );
      expect(nav).toBe("0px");
    });
  }

  test("C1: no visible control anywhere in the workspace has a zero-sized box", async ({ page }) => {
    await open(page, "C1");
    await settle(page);

    // The general form of the finding, asked of the whole shell: a control that
    // reports itself visible and then paints nothing is unclickable by pointer at
    // any zoom, whatever it says about itself.
    const ghosts = await page.evaluate(() => {
      const out: string[] = [];
      for (const control of document.querySelectorAll<HTMLElement>("#dx-workspace button, #dx-workspace a[href]")) {
        const style = getComputedStyle(control);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        if (control.closest("[inert]")) continue;
        const rect = control.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) continue;
        out.push(
          `${control.tagName.toLowerCase()}[data-act=${control.getAttribute("data-act") ?? ""}].${control.className} ${rect.width}x${rect.height}`,
        );
      }
      return out;
    });
    expect(ghosts, `visible controls with no box:\n${ghosts.join("\n")}`).toEqual([]);
  });
});

/* ------------------------------------------------------------- S8-008 */

test.describe("S8-008: an empty state names an action this screen has", () => {
  test("Home's Recent offers the one thing its sentence promises", async ({ page }) => {
    // `workspace=empty` is the fixture with nothing in it. The audit dataset is
    // never empty and a bridge-backed preview cannot promise to be either, so the
    // empty state is only reachable this way.
    await page.goto("/?shellFixture=1&shell=C1&workspace=empty");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    const empty = page.locator(".dx-empty");
    await expect(empty).toBeVisible();
    await expect(empty.locator("h2")).toHaveText("No recent files");
    await expect(empty.locator("p")).toHaveText("Open a file to get started.");

    // Exactly one action, it is the one the sentence names, and it works. The
    // original defect was a sentence naming two actions the screen could not do.
    const actions = empty.locator("button");
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveText("Open");
    await expect(actions).toBeEnabled();
    await expect(actions).toHaveAttribute("data-act", "open-picker");

    // And the create half of the promise lives on the same screen, above it:
    // Quick start, which is where Home's "make something" entry points are (§20).
    const quick = page.locator("[data-act=create-local]");
    await expect(quick.first()).toBeVisible();
    const quickBox = await box(page, ".dx-quick-start");
    const emptyBox = await box(page, ".dx-empty");
    expect(quickBox!.bottom, "Quick start sits above the empty sentence").toBeLessThanOrEqual(emptyBox!.top);
  });

  test("Local's My Files offers the one thing its sentence promises", async ({ page }) => {
    await page.goto("/?shellFixture=1&shell=C3&workspace=empty");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    const empty = page.locator("#dx-local-results .dx-empty");
    await expect(empty).toBeVisible();
    await expect(empty.locator("h2")).toHaveText("This folder is empty");
    // The sentence says "from your Mac", and Open is the control that does that.
    await expect(empty.locator("p")).toHaveText("Open a file from your Mac to get started.");
    const actions = empty.locator("button");
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveAttribute("data-act", "open-picker");
    await expect(actions).toBeEnabled();
  });

  test("C1: Quick start creates a file and leaves Home", async ({ page }) => {
    await open(page, "C1");
    // Home shows no tab strip (§10: the row is blank on Home, Local, Projects and
    // Settings), so the count before the click comes from the fixture rather than
    // from the screen.
    await expect(page.locator(".dx-file-tab")).toHaveCount(0);
    await page.locator("[data-act=create-local][data-id=docx]").click();

    // The control does the thing rather than reporting that it cannot: r10 routes
    // an unbuilt control to a line in `#dx-notice`, so a notice here would mean it
    // did not.
    await expect(page.locator("#shell")).toHaveAttribute("data-page", "editor");
    await expect(page.locator(".dx-file-tab")).toHaveCount(AUDIT_OPEN_FILE_IDS.length + 1);
    await expect(page.locator(".dx-file-tab.dx-active .dx-tab-title")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dx-notice.dx-visible")).toHaveCount(0);
  });
});

/* ------------------------------------------------------------- S6-014 */

test.describe("S6-014: the sheet skeleton fills the canvas", () => {
  for (const combination of ["C7", "C9"] as const) {
    test(`${combination}: the grid reaches the bottom of the canvas`, async ({ page }) => {
      await open(page, combination);
      await page.getByRole("tab", { name: /sales forecast/i }).click();
      await expect(page.locator(".shell-skeleton-grid")).toBeVisible();

      const canvas = await box(page, ".shell-canvas");
      const grid = await box(page, ".shell-skeleton-grid");
      const white = canvas!.bottom - grid!.bottom;

      // Was 234px of white, 32.1% of a 728px canvas. One row (26px) of slack is
      // the most the row grid can leave, and the grid may run past the bottom (it
      // scrolls) rather than stopping short of it.
      expect(white, `${white}px of empty canvas below the sheet skeleton`).toBeLessThan(26);
      expect(grid!.height).toBeGreaterThan(canvas!.height - 26);
    });
  }

  test("C9: a shorter window gets fewer rows, not a shorter table", async ({ page }) => {
    await open(page, "C9");
    await page.getByRole("tab", { name: /sales forecast/i }).click();
    await expect(page.locator(".shell-skeleton-grid")).toBeVisible();

    const tall = await page.locator(".shell-skeleton-cell").count();
    await page.setViewportSize({ width: 1280, height: 560 });
    await expect.poll(async () => page.locator(".shell-skeleton-cell").count()).toBeLessThan(tall);

    const canvas = await box(page, ".shell-canvas");
    const grid = await box(page, ".shell-skeleton-grid");
    expect(canvas!.bottom - grid!.bottom).toBeLessThan(26);
  });
});

/* ------------------------------------------------------------- S6-013 */

test.describe("S6-013: the loading phase looks different from an empty workspace", () => {
  test("`data-loaded=\"false\"` withdraws the empty sentence", async ({ page }) => {
    // No fixture data: an empty workspace, which is the state the loading phase
    // was indistinguishable from.
    await page.goto("/?shellFixture=1&shell=C1&workspace=empty");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");

    const visibility = async () =>
      page.evaluate(() => {
        const empty = document.querySelector(".dx-empty");
        return empty ? getComputedStyle(empty).visibility : null;
      });
    expect(await visibility()).toBe("visible");

    /*
     * Driven directly: the fixture port resolves within a frame, so the only way
     * to observe the phase is to put the shell in it. This tests the CSS side,
     * which is the half that was written and read by nothing —
     * `.shell[data-loaded="false"] .dx-empty` in `app.css`. The r10 shell states
     * the difference by withholding the sentence rather than by drawing a
     * placeholder bar over the list, so that is the whole of the claim.
     */
    await page.evaluate(() => document.querySelector("#shell")!.setAttribute("data-loaded", "false"));
    expect(await visibility()).toBe("hidden");

    // And "empty" is stated in words while "loading" is not, which is the
    // distinction the finding was about.
    await expect(page.locator(".dx-empty p")).toHaveText("Open a file to get started.");
  });
});

/* ------------------------------------------------------------- S1-009 */

test.describe("S1-009: no part of the sidebar is empty space holding height", () => {
  for (const combination of ["C1", "C3", "C10"] as const) {
    test(`${combination}: every region of the sidebar has something in it`, async ({ page }) => {
      await open(page, combination);
      await settle(page);

      /*
       * The original was `.shell-sidebar-body` at exactly 348px in Editor mode,
       * empty because that mode had nothing to put there. r10 has no modes, so
       * the claim is asked of the sidebar as a whole: a box with no content and
       * no background of its own must not be taller than a row (36px, §03).
       *
       * Two boxes are exempt, both by name and both because they are doing a job
       * an element with no content can do:
       *
       *   - `.dx-sidebar-scroll` is the flexible middle. The space under the tree
       *     is what puts the footer on the floor.
       *   - `.dx-sidebar-cap` is the 40px spacer that lines the sidebar's first
       *     row up under the band beside it (§03: each column has its own top
       *     row). It is exactly one band tall, which is asserted rather than
       *     waved through.
       *
       * Graphics are not walked into: an `<svg>`'s paths and an `<img>` are
       * childless and textless by nature, and their height is their content.
       */
      const cap = await box(page, "#dx-sidebar .dx-sidebar-cap");
      expect(cap!.height, "the sidebar's top spacer is one top row tall").toBe(40);

      const dead = await page.evaluate(() => {
        const out: string[] = [];
        const walk = (node: Element) => {
          for (const child of Array.from(node.children)) {
            if (["svg", "img", "canvas", "video"].includes(child.tagName.toLowerCase())) continue;
            const style = getComputedStyle(child);
            if (style.display === "none") continue;
            if (child.classList.contains("dx-sidebar-scroll") || child.classList.contains("dx-sidebar-cap")) continue;
            const rect = child.getBoundingClientRect();
            const empty = child.children.length === 0 && !(child.textContent ?? "").trim();
            const decorative = style.backgroundColor !== "rgba(0, 0, 0, 0)" || style.backgroundImage !== "none";
            if (empty && !decorative && rect.height > 36) {
              out.push(`.${child.className || child.tagName} ${Math.round(rect.height)}px`);
              continue;
            }
            walk(child);
          }
        };
        walk(document.querySelector("#dx-sidebar")!);
        return out;
      });
      expect(dead, `empty boxes holding height in the sidebar:\n${dead.join("\n")}`).toEqual([]);
    });
  }

  test("C1: the footer sits at the bottom, not floated up by a gap above it", async ({ page }) => {
    await open(page, "C1");
    await settle(page);

    // The gap the old empty box held open pushed everything below it out of
    // alignment; the r10 shape is tree at the top, footer on the floor.
    const sidebar = await box(page, "#dx-sidebar");
    const footer = await box(page, "#dx-sidebar .dx-sidebar-footer");
    expect(sidebar!.bottom - footer!.bottom, "space under the sidebar footer").toBeLessThan(16);

    const main = await box(page, "#dx-sidebar .dx-sidebar-main");
    const scroll = await box(page, "#dx-sidebar .dx-sidebar-scroll");
    expect(scroll!.top - main!.bottom, "gap between the fixed rows and the tree").toBeLessThan(16);
  });
});

/* --------------------------------------------------------- S3-001/002 */

test.describe("S3-001 / S3-002: a page is one column", () => {
  test("C1: Home's bands share a left and a right edge", async ({ page }) => {
    await open(page, "C1");
    await settle(page);

    // §03: "常规页面边距 24；宽页面可用 32；窄窗 16 | 同一页面同一轴线一致". Was
    // highlights at 126 against 100 and 100 — a 26px step.
    const home = await box(page, ".dx-home");
    const bands: Record<string, Awaited<ReturnType<typeof box>>> = {
      quickStart: await box(page, ".dx-quick-start"),
      features: await box(page, ".dx-feature-highlights"),
      recentSection: await box(page, ".dx-home-section:not(.dx-feature-highlights)"),
      recentTable: await box(page, ".dx-home-recent"),
    };
    for (const [name, rect] of Object.entries(bands)) {
      expect(rect, `${name} is not on Home`).not.toBeNull();
      expect(Math.abs(rect!.left - home!.left), `${name} left edge`).toBeLessThanOrEqual(ALIGN);
      expect(Math.abs(rect!.right - home!.right), `${name} right edge`).toBeLessThanOrEqual(ALIGN);
    }

    /*
     * The composer is the one band that is deliberately narrower — `max-width:
     * 780px` inside Home's 1120 (§"首页居中展示，最大宽 780") — so it is checked
     * for being centred on the same axis rather than for sharing the edge.
     */
    const composer = await box(page, ".dx-home-composer");
    const centre = (rect: NonNullable<Awaited<ReturnType<typeof box>>>) => (rect.left + rect.right) / 2;
    expect(Math.abs(centre(composer!) - centre(home!)), "the composer is off Home's axis").toBeLessThanOrEqual(ALIGN);
    expect(composer!.width, "the composer is narrower than the page").toBeLessThan(home!.width);
  });

  test("C3: Local's heading row and its actions match the table under them", async ({ page }) => {
    await open(page, "C3");
    await settle(page);

    // Was Editor Home's head/actions right 1232 against list right 1180 — 52px of
    // overhang. Local is the r10 page with the same shape: a page header, a
    // heading row carrying the sort and view controls, and a table below.
    const results = await box(page, "#dx-local-results");
    for (const selector of [".dx-local-page > .dx-page-header", ".dx-local-files-heading", ".dx-local-recent"]) {
      const rect = await box(page, selector);
      expect(rect, `${selector} is not on Local`).not.toBeNull();
      expect(Math.abs(rect!.left - results!.left), `${selector} left edge`).toBeLessThanOrEqual(ALIGN);
      expect(Math.abs(rect!.right - results!.right), `${selector} right edge`).toBeLessThanOrEqual(ALIGN);
    }

    // The right-hand control group ends where the table ends rather than past it.
    const actions = await box(page, ".dx-local-files-heading .dx-actions");
    expect(actions!.right).toBeLessThanOrEqual(results!.right + ALIGN);
  });

  test("C10: Settings' body is centred under its title and never wider than it", async ({ page }) => {
    await open(page, "C10");
    await settle(page);

    /*
     * S3-002's shape, on the one page where the approved design draws it on
     * purpose: `.dx-settings-layout` is capped at 1120px and centred, under a
     * header that fills the scroll region. At 1440 that leaves the body 6px
     * inside the title on each side — measured the same in the prototype, which
     * is the reference this page is held to. What must not happen is the defect
     * S3-002 was: a body that runs past its heading, or one that sits off its
     * axis.
     */
    const header = await box(page, ".dx-page-header");
    const layout = await box(page, ".dx-settings-layout");
    const centre = (rect: NonNullable<Awaited<ReturnType<typeof box>>>) => (rect.left + rect.right) / 2;
    expect(Math.abs(centre(layout!) - centre(header!)), "Settings' body is off its title's axis").toBeLessThanOrEqual(ALIGN);
    expect(layout!.left, "Settings' body starts left of its title").toBeGreaterThanOrEqual(header!.left - ALIGN);
    expect(layout!.right, "Settings' body runs past its title").toBeLessThanOrEqual(header!.right + ALIGN);
    expect(layout!.width, "the design's cap").toBeLessThanOrEqual(1120 + ALIGN);
  });
});

/* ------------------------------------------------------------- S3-016 */

test.describe("S3-016: a focus ring is not drawn where its container clips it", () => {
  /**
   * Reports how far `selector`'s focus ring is cut off, and by what.
   *
   * The ring is painted `outline-offset + outline-width` outside the border box,
   * so a container that clips — anything with a non-visible overflow — has to
   * leave that much room. `offset` may be negative, which is the fix: an inset
   * ring is drawn over the element and cannot be clipped at all.
   */
  async function ringClip(page: Page, selector: string) {
    await page.locator(selector).first().focus();
    return page.evaluate((target: string) => {
      const node = document.querySelector(target)!;
      const style = getComputedStyle(node);
      const grow = Math.max(0, (parseFloat(style.outlineOffset) || 0) + (parseFloat(style.outlineWidth) || 0));
      const rect = node.getBoundingClientRect();
      const clipped: string[] = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent);
        if (parentStyle.overflowX === "visible" && parentStyle.overflowY === "visible") continue;
        const bounds = parent.getBoundingClientRect();
        const cut = Math.max(
          bounds.left - (rect.left - grow),
          rect.right + grow - bounds.right,
          bounds.top - (rect.top - grow),
          rect.bottom + grow - bounds.bottom,
        );
        if (cut > 0.5) clipped.push(`${parent.className || parent.tagName} cuts ${cut.toFixed(1)}px`);
      }
      return {
        focusVisible: node.matches(":focus-visible"),
        offset: style.outlineOffset,
        width: style.outlineWidth,
        clipped,
      };
    }, selector);
  }

  test("C1: Home's Recent rows keep the inset ring their scroller needs", async ({ page }) => {
    await open(page, "C1");

    // The row sits inside `.dx-table-wrap`, which scrolls, so its ring is inset
    // (`outline-offset: -2px`) and nothing can clip it. This is the shape the fix
    // took, and the case that proves the measurement above can come back clean.
    const row = await ringClip(page, ".dx-home-recent .dx-open-row");
    expect(row.focusVisible, "the row took a visible focus").toBe(true);
    expect(row.offset).toBe("-2px");
    expect(row.clipped, `the Recent row's ring is clipped: ${row.clipped.join("; ")}`).toEqual([]);
  });

  test("C1: a feature card's ring is not clipped by the shelf it sits in", async ({ page }) => {
    await open(page, "C1");

    /*
     * `.dx-highlights` is a horizontal shelf with `overflow: auto`, so it clips.
     * A card inside it therefore needs the same inset ring the Recent rows got,
     * or an offset small enough to stay inside — the default 2px offset plus a
     * 2px outline puts 4px of ring outside the card, where the shelf cuts it.
     */
    const card = await ringClip(page, ".dx-highlight");
    expect(card.focusVisible, "the card took a visible focus").toBe(true);
    expect(card.clipped, `the feature card's ring is clipped: ${card.clipped.join("; ")}`).toEqual([]);
  });

  test("C1: a control outside any scroller keeps the standard's outer ring", async ({ page }) => {
    await open(page, "C1");

    // §05: "focus | #526F89 | 焦点外轮廓；2px，offset 2px" is the default, and it
    // is right wherever nothing clips. Asserted so a blanket switch to inset
    // rings — the lazy fix for the case above — shows up as a failure here.
    const nav = await ringClip(page, "#dx-sidebar [data-act=local]");
    expect(nav.offset).toBe("2px");
    expect(nav.width).toBe("2px");
    expect(nav.clipped).toEqual([]);
  });
});

/**
 * Wave 1, track B — the floating conversation and the Dex bubble.
 *
 * The inverse of the audit's R2 findings: every assertion here failed on the
 * code as it stood on 2026-09-19 and passed after the fix. Read it as the
 * regression fence, not as a survey — the survey is
 * `docs/ui-audit-2026-09-19/S4` and `…/S6`.
 *
 * **What r10 changed.** R2 was about `.shell-presence`: one floating panel that
 * could be collapsed to a 56px mark, dragged anywhere, tucked against an edge,
 * and that swapped places with a docked Agent column when the mode changed. r10
 * has no modes and no presence dock. What is left are two draggable objects, and
 * between them they carry every one of R2's guarantees:
 *
 *   - the **floating conversation** (`#dx-conversation` under
 *     `#dx-workspace.dx-chat-floating`, `chat/ConversationPane.tsx`) — the same
 *     column as the docked one, dragged by its header, clamped to the window,
 *     600px tall, and flipped between docked and floating by
 *     `[data-act=toggle-chat-display]`;
 *   - the **Dex bubble** (`.dx-dex`, `dex/Dex.tsx`) — 42px, dragged over the
 *     document, and the object that still *rests against an edge* with 60%
 *     showing and a rotation, which is what the old collapsed mark did.
 *
 * Three cases are gone rather than reinterpreted, and are in the migration
 * ledger with their reasons: the mode-switch handover, the unbounded overhang
 * transform, and the header slot reserved for a conditional dock button.
 *
 * There is deliberately **no** `test.skip` in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`: run
 * without its environment variable it prints `30 skipped` and exits 0, which
 * reads exactly like success and was once reported as such. Everything below
 * runs against the fixture server (`?shellFixture=1`), which needs nothing but a
 * dev server, so there is nothing to skip on.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w1b.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { open, settle } from "./r10-a-helpers";

test.use({ viewport: { width: 1280, height: 800 } });

/** The floating conversation, and the header it is dragged by. */
const PANE = "#dx-workspace.dx-chat-floating #dx-conversation";
const GRIP = `${PANE} > .dx-pane-top`;
/** The Dex bubble over an open document. */
const DEX = "button.dx-dex[data-act=dex]";

/**
 * Drags `handle` so the pointer ends on `to`.
 *
 * Stepped, because a single jump produces one `pointermove` and both drag
 * handlers derive the object's new position from the movement since
 * `pointerdown`. Grabbed 40px in from the handle's left edge, away from its
 * buttons: `ConversationPane.onHeaderPointerDown` ignores a press that started
 * on one, so a grab at the centre of the header would sometimes catch a control.
 */
async function drag(page: Page, handle: Locator, to: { x: number; y: number }): Promise<void> {
  const box = await handle.boundingBox();
  expect(box, "the drag handle has no box").not.toBeNull();
  await page.mouse.move(box!.x + Math.min(40, box!.width / 2), box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
  // The Dex bubble's snap to an edge animates (`INFLATE_MS` easing on left/top).
  await page.waitForTimeout(420);
}

/** Drags the Dex bubble itself, which is its own handle. */
async function dragBubble(page: Page, to: { x: number; y: number }): Promise<void> {
  const box = await page.locator(DEX).boundingBox();
  expect(box, "there is no Dex bubble on this shell").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** The three self-drawn window controls' own rects, read from the live DOM. */
async function windowControls(page: Page) {
  return page.evaluate(() =>
    [".dx-traffic.dx-close", ".dx-traffic.dx-min", ".dx-traffic.dx-max"].map((selector) => {
      const element = document.querySelector(selector);
      const rect = element!.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        selector,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        centre: { x, y },
        hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className)}` : null,
        reachable: hit === element || element!.contains(hit),
      };
    }),
  );
}

async function rectOf(page: Page, selector: string) {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, selector);
}

/* --------------------------------------------------------------- S4-001 */

test.describe("a floating object cannot sit on the window controls", () => {
  /**
   * S4-001 (P0). `useDraggable.place()` clamped x to a floor of 12 on the top
   * edge; the self-drawn close / minimise / full-screen cluster occupies 12–75px.
   * `elementFromPoint` on all three centres returned
   * `header.shell-task-head is-grip` — the window could not be closed.
   *
   * r10's answer for the conversation is a clamp rather than a reserved strip:
   * `ConversationPane.floatingStyle` floors y at 48, which is below the 40px band
   * the controls live in (WORKSPACE-STANDARD §02). Asserted as the outcome —
   * all three hittable — with the clamp measured underneath it so the case
   * cannot pass because the drag did nothing.
   */
  test("the floating conversation tucked to the top leaves all three controls hittable", async ({ page }) => {
    await open(page, "C7");
    await drag(page, page.locator(GRIP), { x: 4, y: 2 });

    const pane = await rectOf(page, PANE);
    expect(pane, "the conversation is not floating").not.toBeNull();
    // It really is as far up and left as it goes, so this is not passing by
    // having stayed where it started.
    expect(pane!.top).toBeLessThan(80);
    expect(pane!.left).toBeLessThan(24);
    // And it stops clear of the 40px band rather than being let onto it.
    expect(pane!.top).toBeGreaterThanOrEqual(40);

    for (const control of await windowControls(page)) {
      expect(control.reachable, `${control.selector} is covered by ${control.hit}`).toBe(true);
    }
  });

  /**
   * The same finding for the object that r10 *does* let onto the band.
   *
   * The Dex bubble is the heir to the collapsed mark: 42px, and parked against an
   * edge it is pulled outside its host by 40% of its width, which over the top
   * edge puts it into the window's top band and across the controls' own
   * coordinates. What keeps them workable is the ladder rather than a reserved
   * strip — `--dx-z-global-controls` 45 over `--dx-z-dex` 22 (`tokens.css`).
   *
   * So the overlap is asserted too. Without it this would pass the day the bubble
   * stops reaching the corner, and the stacking claim would go untested.
   */
  test("the parked Dex bubble leaves all three controls hittable", async ({ page }) => {
    await open(page, "C9");
    await expect(page.locator(DEX)).toBeVisible();
    await dragBubble(page, { x: 6, y: 2 });
    await expect(page.locator(DEX)).toHaveAttribute("data-edge", "top");

    const controls = await windowControls(page);
    const bubble = await rectOf(page, DEX);
    // The premise: it is in the band, over the cluster's own strip.
    expect(bubble!.top).toBeLessThan(40);
    const overlapsAny = controls.some(
      (control) =>
        bubble!.left < control.rect.right &&
        bubble!.right > control.rect.left &&
        bubble!.top < control.rect.bottom &&
        bubble!.bottom > control.rect.top,
    );
    expect(overlapsAny, `the parked bubble no longer reaches the controls: ${JSON.stringify(bubble)}`).toBe(true);

    for (const control of controls) {
      expect(control.reachable, `${control.selector} is covered by ${control.hit}`).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- S6-011 */

test.describe("the floating conversation is clamped to the box it actually has", () => {
  /**
   * S6-011. `PANEL_SIZE.height` was declared 520 and rendered 543, so every
   * vertical clamp left 23px too little and a panel dragged into the corner hung
   * out of the window with its composer cut off.
   *
   * The declared-versus-rendered split cannot recur the same way in r10: the
   * height is `min(600px, calc(100% - 80px))` in CSS and the clamp reads
   * `pane.offsetHeight`, so there is no second number to disagree. What is
   * asserted is the property the two numbers were supposed to produce, plus the
   * premise that the panel really is at its designed 600px cap — the old spec
   * had to run a whole task to get the panel past its constant, which r10 does
   * not need because the height is not content-driven.
   */
  test("dragged into the bottom-right corner, the conversation stays inside the window", async ({ page }) => {
    await open(page, "C7");
    const grown = await rectOf(page, PANE);
    // OD-CHAT §2 / ConversationPane: at most 600px tall.
    expect(grown!.height).toBe(600);

    await drag(page, page.locator(GRIP), { x: 1270, y: 795 });

    const pane = await rectOf(page, PANE);
    expect(pane).not.toBeNull();
    expect(pane!.bottom).toBeLessThanOrEqual(pane!.viewport.height + 0.5);
    expect(pane!.right).toBeLessThanOrEqual(pane!.viewport.width + 0.5);

    // The composer is the control the old clamp cut off. It has to be whole.
    const composer = await rectOf(page, `${PANE} .dx-chat-composer-wrap`);
    expect(composer).not.toBeNull();
    expect(composer!.bottom).toBeLessThanOrEqual(composer!.viewport.height + 0.5);
  });

  test("the same holds at every edge, not just the corner", async ({ page }) => {
    await open(page, "C7");
    for (const target of [
      { x: 2, y: 400 },
      { x: 1278, y: 400 },
      { x: 640, y: 798 },
      { x: 640, y: 2 },
    ]) {
      await drag(page, page.locator(GRIP), target);
      const pane = await rectOf(page, PANE);
      expect(
        pane!.bottom <= pane!.viewport.height + 0.5 &&
          pane!.top >= -0.5 &&
          pane!.left >= -0.5 &&
          pane!.right <= pane!.viewport.width + 0.5,
        `the conversation escaped the viewport at ${JSON.stringify(target)}: ${JSON.stringify(pane)}`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------- S4-004 / S6-012 */

test.describe("a parked object is a solid object", () => {
  /**
   * S4-004. "Tucked" used to mean nothing for an expanded panel but
   * `opacity: .82`, so the document's text and the panel's text printed through
   * each other. A parked panel is opaque.
   */
  test("a parked conversation is fully opaque, not a ghost over the document", async ({ page }) => {
    await open(page, "C7");
    await drag(page, page.locator(GRIP), { x: 1278, y: 400 });

    const opacity = await page.locator(PANE).evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(opacity)).toBe(1);
  });

  /**
   * The other half of S6-012: the overhang is a property of the parked object and
   * is meant to survive. `.dx-dex[data-edge]` is what carries it in r10 — the fix
   * scoped the transform to the object itself, it did not delete it.
   */
  test("the parked Dex bubble still hangs off the edge, and is opaque doing it", async ({ page }) => {
    await open(page, "C9");
    await dragBubble(page, { x: 1278, y: 400 });
    await expect(page.locator(DEX)).toHaveAttribute("data-edge", "right");

    const parked = await page.locator(DEX).evaluate((node) => ({
      transform: getComputedStyle(node).transform,
      opacity: getComputedStyle(node).opacity,
      rect: node.getBoundingClientRect().toJSON(),
      host: document.querySelector(".dx-editor-wrapper")!.getBoundingClientRect().toJSON(),
    }));
    // eslint-disable-next-line no-console
    console.log(`W1B-FIXED parked-dex ${JSON.stringify(parked)}`);

    expect(parked.transform, "the parked bubble lost its overhang").not.toBe("none");
    expect(Number(parked.opacity)).toBe(1);
    /*
     * BRAND-DEX §04, Chat 初始位置: "右边缘趴伏，42px圆形露出60%、旋转−90°" — 60% of
     * the 42px circle showing, the rest past the edge. So the overhang is
     * measured as the fraction still inside the host rather than bounded by the
     * window: hanging out of the window is what this object is *for*, which is
     * why S4-005 was about the panel's avatars inheriting the transform and not
     * about the mark carrying it.
     *
     * A couple of pixels of slack: the −90° rotation widens the bounding box by
     * about 0.9px on each side, so an exact 25.2 would fail on geometry that is
     * correct.
     */
    const showing = parked.host.right - parked.rect.left;
    expect(showing, `${showing}px of the bubble shows; the design asks for 60% of 42`).toBeGreaterThan(42 * 0.55);
    expect(showing).toBeLessThan(42 * 0.7);
  });
});

/* --------------------------------------------------------------- S4-007 */

test.describe("the floating conversation is not a scroll container", () => {
  /**
   * S4-007. `overflow: hidden` still makes a box programmatically scrollable — it
   * only removes the scrollbars. Focusing a control near the bottom pushed the
   * old panel's header 36px out of view with no way to bring it back.
   *
   * The symptom to fence off is the header leaving the panel's box, which is what
   * the audit measured (`headTop 316 < panelTop 352`).
   */
  test("moving focus inside the conversation never scrolls it", async ({ page }) => {
    await open(page, "C7");

    const before = await rectOf(page, GRIP);

    const focused = await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("#dx-conversation")!;
      const controls = pane.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex]");
      const last = controls[controls.length - 1];
      last.focus();
      last.scrollIntoView();
      return { count: controls.length, scrollTop: pane.scrollTop };
    });

    expect(focused.count).toBeGreaterThan(0);
    expect(focused.scrollTop).toBe(0);

    /*
     * An exact rect match is the wrong assertion: focusing a control relayouts
     * the composer by a couple of pixels. 36px of lost header is the defect; 3px
     * of composer is not.
     */
    const after = await rectOf(page, GRIP);
    const pane = await rectOf(page, PANE);
    expect(after!.top).toBeGreaterThanOrEqual(pane!.top - 0.5);
    expect(Math.abs(after!.top - before!.top)).toBeLessThan(8);
  });

  /**
   * The direct statement of the property, rather than of one implementation of
   * it.
   *
   * The old fix was `overflow: clip`, which is not a scroll container at all.
   * r10's panel is `overflow: hidden` again — and is safe for a different reason:
   * it is a flex column whose middle child (`.dx-chat-scroll`) takes the
   * overflow, so the panel's own box has none to scroll. Asserting `clip` here
   * would be asserting the old mechanism; what matters is that a write to
   * `scrollTop` cannot move the panel's contents, and that the scrolling happens
   * in the child that is meant to do it.
   */
  test("scrollTop cannot be written on the panel, and the log scrolls instead", async ({ page }) => {
    await open(page, "C7");
    const result = await page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>("#dx-conversation")!;
      const log = pane.querySelector<HTMLElement>(".dx-chat-scroll")!;
      pane.scrollTop = 240;
      return {
        scrollTop: pane.scrollTop,
        paneOverflow: pane.scrollHeight - pane.clientHeight,
        logScrolls: log.scrollHeight - log.clientHeight > 0,
      };
    });
    expect(result.scrollTop).toBe(0);
    expect(result.paneOverflow).toBe(0);
    expect(result.logScrolls, "the conversation's messages do not scroll anywhere").toBe(true);
  });
});

/* --------------------------------------------------------------- S6-003 */

interface Frame {
  /** How many conversation columns are mounted. */
  panes: number;
  /** The width the workspace's grid still reserves for the `chat` area, or 0. */
  trackWidth: number;
  /** Whether the pane has been taken out of the grid and is floating. */
  floating: boolean;
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: unknown[] = [];
    (window as unknown as { __w1b: unknown[] }).__w1b = frames;
    const tick = () => {
      const workspace = document.querySelector("#dx-workspace")!;
      const pane = document.querySelector<HTMLElement>("#dx-conversation");
      const style = getComputedStyle(workspace);
      /*
       * The grid's chat track, found by name rather than by position.
       *
       * The columns are `nav chat split main` docked left and `nav main split
       * chat` docked right, and floating drops the chat and splitter tracks
       * altogether — so an index picked by hand reads the *main* column's width
       * on the right-docked shells, which is a number that means nothing here.
       */
      const areas = style.gridTemplateAreas.replace(/"/g, "").trim().split(/\s+/);
      const columns = style.gridTemplateColumns.split(" ").map(parseFloat);
      const chat = areas.indexOf("chat");
      frames.push({
        panes: document.querySelectorAll("#dx-conversation").length,
        trackWidth: chat < 0 ? 0 : (columns[chat] ?? 0),
        floating: workspace.classList.contains("dx-chat-floating") && pane !== null,
      });
      (window as unknown as { __w1bRaf: number }).__w1bRaf = requestAnimationFrame(tick);
    };
    tick();
  });
}

async function stopSampling(page: Page): Promise<Frame[]> {
  return (await page.evaluate(() => {
    cancelAnimationFrame((window as unknown as { __w1bRaf: number }).__w1bRaf);
    return (window as unknown as { __w1b: unknown[] }).__w1b;
  })) as Frame[];
}

/**
 * The invariant S6-003 broke, stated over every frame of the transition.
 *
 * Counting mounted panels alone is not enough, and saying so matters: on the
 * unfixed code the count was 1 in every frame too, because the docked
 * conversation unmounted in the same React commit that mounted the floating one.
 * What the audit actually saw was a 320px column that still had its width but no
 * longer had its contents. So the shape of the assertion is: a column that is
 * still taking up space must still be holding the conversation.
 */
function assertOneConversationThroughout(frames: Frame[]): void {
  expect(frames.length, "the frame sampler never ran").toBeGreaterThan(10);

  const two = frames.filter((frame) => frame.panes > 1);
  const none = frames.filter((frame) => frame.panes < 1);
  const both = frames.filter((frame) => frame.trackWidth > 8 && frame.floating);

  expect(two, `two conversations mounted: ${JSON.stringify(two[0])}`).toHaveLength(0);
  expect(none, "no conversation on screen at all").toHaveLength(0);
  expect(
    both,
    `${both.length}/${frames.length} frames reserved a ${Math.round(
      both[0]?.trackWidth ?? 0,
    )}px docked column while the conversation was floating: ${JSON.stringify(both[0])}`,
  ).toHaveLength(0);
}

test.describe("the conversation is handed over, never duplicated", () => {
  /**
   * S6-003, driven by the control that is the flip itself.
   *
   * The audited driver was the Agent/Editor mode switch, which r10 does not have;
   * `[data-act=toggle-chat-display]` is the r10 control that moves the
   * conversation between the grid and the floating layer, which is the same
   * handover. Sampled every animation frame because the defect lasted 200ms and a
   * single assertion after the fact would miss it.
   */
  test("floating the conversation never shows two of it, or none", async ({ page }) => {
    await open(page, "C6");
    await expect(page.locator("#dx-conversation .dx-chat-scroll")).toHaveCount(1);

    await startSampling(page);
    await page.locator("#dx-conversation [data-act=toggle-chat-display]").click();
    await page.waitForTimeout(700);
    assertOneConversationThroughout(await stopSampling(page));

    await expect(page.locator("#dx-workspace")).toHaveClass(/dx-chat-floating/);
    await expect(page.locator("#dx-conversation")).toHaveCount(1);
  });

  /** And back again, which is the same handover in the other direction. */
  test("docking it again never shows two of it, or none", async ({ page }) => {
    await open(page, "C7");

    await startSampling(page);
    await page.locator("#dx-conversation [data-act=toggle-chat-display]").click();
    await page.waitForTimeout(700);
    assertOneConversationThroughout(await stopSampling(page));

    await expect(page.locator("#dx-workspace")).not.toHaveClass(/dx-chat-floating/);
    // Docked, the column is back in the grid at the design's default width.
    const pane = await rectOf(page, "#dx-conversation");
    expect(pane!.width).toBe(360);
  });
});

/* ------------------------------------------------- S4-012 / S4-015 */

test.describe("the floating conversation follows the window it is in", () => {
  /**
   * S4-012: at 1024×700 a fixed 340px panel covered 32% of the canvas. It now
   * gives width back on a window that does not have it.
   *
   * The numbers are the design's, not a recording of what r10 happens to render:
   * OD-UI-1.2 §03 gives the conversation 320–520px with 360 as the default, and
   * 320 is the floor. So a roomy window gets the default and a narrow one is
   * taken down to the floor — never below it, which is the other half of the
   * range being a range.
   */
  test("a narrow window gets a narrower conversation, down to the design's floor", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "C7");
    const wide = (await rectOf(page, PANE))!.width;

    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(300);
    await settle(page);
    const narrow = (await rectOf(page, PANE))!.width;
    // eslint-disable-next-line no-console
    console.log(`W1B-FIXED conversation-width wide=${wide} narrow=${narrow}`);

    expect(wide).toBe(360);
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeGreaterThanOrEqual(320);
  });

  /**
   * S4-015: the first window resize wrote the derived default into persisted
   * state, so "never placed" was gone forever and a grown window left the panel
   * stranded mid-canvas.
   *
   * r10 keeps the floating position in component state (`ConversationPane`'s
   * `point`) and `state/persist.ts` has no field for it, so there is nothing a
   * resize could write. Asserted rather than assumed, both ways round: nothing
   * about a position appears in storage, and an unplaced panel is still where the
   * window puts it after the window changes size.
   */
  test("an unplaced conversation follows the window instead of being written down", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page, "C7");
    const before = (await rectOf(page, PANE))!;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    await settle(page);

    const stored = await page.evaluate(() => localStorage.getItem("officedex.shell.v1"));
    // Nothing persisted at all is also correct — the defect was a resize
    // *writing* the derived default down. What must never appear is a coordinate.
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      expect(Object.keys(parsed), "a resize wrote a floating position into storage").not.toContain("chatPoint");
      expect(Object.keys(parsed)).not.toContain("presence");
    }

    const after = (await rectOf(page, PANE))!;
    // eslint-disable-next-line no-console
    console.log(`W1B-FIXED unplaced-follows ${JSON.stringify({ before, after })}`);
    // It moved with the window rather than staying at the old coordinates, and
    // it is whole and clear of the 40px band wherever it landed.
    expect(after.bottom).toBeGreaterThan(before.bottom);
    expect(after.bottom).toBeLessThanOrEqual(900);
    expect(after.right).toBeLessThanOrEqual(1440);
    expect(after.top).toBeGreaterThanOrEqual(40);
  });
});

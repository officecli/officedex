/**
 * Wave 1, track B — the floating Agent presence.
 *
 * The inverse of the audit's R2 findings: every assertion here fails on the
 * code as it stood on 2026-09-19 and passes after the fix. Read it as the
 * regression fence, not as a survey — the survey is
 * `docs/ui-audit-2026-09-19/S4` and `…/S6`.
 *
 * There is deliberately **no** `test.skip` in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`:
 * run without its environment variable it prints `30 skipped` and exits 0,
 * which reads exactly like success and was once reported as such. Everything
 * below runs against the fixture server (`?shellFixture=1`), which needs
 * nothing but a dev server, so there is nothing to skip on.
 *
 *   npx vite --port 3122 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3122 npx playwright test e2e/fix-w1b.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

const PANEL = ".shell-presence-panel";
const GRIP = ".shell-presence-panel .shell-task-head";
const FACE = ".shell-presence-face";

async function open(page: Page, combination: string): Promise<void> {
  await page.goto(`/?shellFixture=1&shell=${combination}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
  await settle(page);
}

/**
 * Waits for the presence panel to stop moving.
 *
 * `data-loaded` says the workspace arrived; it says nothing about layout. The
 * panel is placed with a transition (`--ease`, ~300ms), and measuring during it
 * reads a position that is on its way somewhere else: probed at +0ms the panel
 * top is 302.56, at +100ms 354.63, and only from +300ms is it 355.
 *
 * That cost a real afternoon. Two cases here took their "before" baseline mid-
 * transition and then blamed the movement on whatever they did next — one
 * measured 12.9px of "scroll on focus" that was the tail of the animation, and
 * with the panel settled the same focus moves it by exactly 0. A third read the
 * drag handle's box before it reached its resting place and dragged to the
 * wrong spot, so `data-edge` never became "top".
 *
 * Polls for two identical readings rather than sleeping a fixed duration: the
 * transition's length is a design token, and a test that hard-codes 300ms goes
 * quietly wrong the day someone tunes it. No presence (Home, or Editor without
 * a floating panel) settles immediately.
 */
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

/**
 * Drags `handle` by the delta that would land the pointer on `to`.
 *
 * Stepped, because the drag does not start until the pointer has travelled 6px
 * (`useDraggable`), and a single jump produces one `pointermove`.
 */
async function drag(page: Page, handle: Locator, to: { x: number; y: number }): Promise<void> {
  const box = await handle.boundingBox();
  expect(box, "drag handle has no box").not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + Math.min(12, box!.height / 2));
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();
  // The snap animates (`transition: left/top 160ms` on .shell-presence).
  await page.waitForTimeout(420);
}

/**
 * Collapses the panel and waits for the mark to stop moving.
 *
 * Collapsing changes the object's size, so the derived bottom-right landing
 * point changes with it and `.shell-presence` animates `left`/`top` for 160ms.
 * A `boundingBox()` taken during that animation is a coordinate the mark has
 * already left, and a drag from it lands on the canvas instead.
 */
async function collapse(page: Page): Promise<void> {
  await page.getByTitle("Collapse").click();
  await expect(page.locator(FACE)).toBeVisible();
  await page.waitForTimeout(420);
}


/**
 * Runs a task in the floating panel until the conversation is tall enough to
 * hit the panel's `max-height`.
 *
 * Necessary, not decorative. The audit measured the panel at 543px against a
 * declared 520 (S6-011) and found one `.shell-face` per assistant reply thrown
 * out of the window (S4-005). The fixture's opening state is a single user
 * message — 417px, one avatar — which reproduces neither. A conversation is
 * what the panel is *for*, and the defects only exist once there is one.
 */
async function growConversation(page: Page): Promise<void> {
  const panel = page.locator(PANEL);
  await panel.getByLabel("Message Agent").fill("Draft the launch checklist, in detail.");
  /*
   * Sent from the keyboard, and not because that is tidier.
   *
   * A mouse click on Send is *intercepted* inside the 340px floating panel:
   * `.shell-cx-left` — which carries `.shell-cx-output-name`, the current
   * file's name — is laid over the button, so Playwright reports
   * "<span class="shell-cx-output-name">…</span> intercepts pointer events"
   * and waits out its full timeout. That is a real defect, not a test
   * inconvenience: a user with a mouse cannot press Send in this panel.
   *
   * It is filed as MERGE-001 in docs/ui-audit-2026-09-19/SUMMARY.md §3.2 and
   * belongs to the composer's inline layout, which no Wave 1 or Wave 2 track
   * owned. Sending with Enter routes around it so this test can get to the
   * thing it is actually about — the clamp — instead of dying in its own setup.
   * When MERGE-001 is fixed, this can go back to a click.
   */
  await panel.getByLabel("Message Agent").press("Enter");
  await expect(panel.getByText("Suggested changes are ready")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** The window controls' own rects, read from the live DOM rather than assumed. */
async function windowControls(page: Page) {
  return page.evaluate(() =>
    [".shell-window-close", ".shell-window-minimize", ".shell-window-fullscreen"].map((selector) => {
      const element = document.querySelector(selector);
      const rect = element!.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        selector,
        centre: { x, y },
        hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : null,
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


/* --------------------------------------------------------------- S6-003 */

interface Frame {
  /** How many `.shell-task` conversations are mounted. */
  panels: number;
  /** The docked column's laid-out width, mid-transition. */
  columnWidth: number;
  /** Whether that column currently holds a conversation. */
  columnFilled: boolean;
  /** Whether the floating panel is on screen. */
  floating: boolean;
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frames: unknown[] = [];
    (window as unknown as { __w1b: unknown[] }).__w1b = frames;
    const tick = () => {
      const column = document.querySelector(".shell-agent");
      frames.push({
        panels: document.querySelectorAll(".shell-task").length,
        columnWidth: column ? column.getBoundingClientRect().width : 0,
        columnFilled: !!column?.querySelector(".shell-task"),
        floating: !!document.querySelector(".shell-presence-panel"),
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
 * unfixed code the count is 1 in every frame too, because the docked
 * conversation unmounts in the same React commit that mounts the floating one.
 * What the audit actually saw was a 320px column that still had its width but
 * no longer had its contents, sitting next to a full floating panel. So the
 * shape of the assertion is: a column that is still taking up space must still
 * be showing the conversation.
 */
function assertOnePanelThroughout(frames: Frame[]): void {
  expect(frames.length, "the frame sampler never ran").toBeGreaterThan(10);

  const twoPanels = frames.filter((frame) => frame.panels > 1);
  const noPanel = frames.filter((frame) => frame.panels < 1);
  const emptyColumn = frames.filter((frame) => frame.columnWidth > 8 && !frame.columnFilled);
  const both = frames.filter((frame) => frame.columnWidth > 8 && frame.floating);

  expect(twoPanels, `two conversations mounted: ${JSON.stringify(twoPanels[0])}`).toHaveLength(0);
  expect(noPanel, "no conversation on screen at all").toHaveLength(0);
  expect(
    emptyColumn,
    `${emptyColumn.length}/${frames.length} frames showed an empty ${Math.round(
      emptyColumn[0]?.columnWidth ?? 0,
    )}px agent column: ${JSON.stringify(emptyColumn[0])}`,
  ).toHaveLength(0);
  expect(
    both,
    `${both.length}/${frames.length} frames showed the docked column and the floating panel together`,
  ).toHaveLength(0);
}

/* --------------------------------------------------------------- S4-001 */

test.describe("the presence cannot sit on the window controls", () => {
  /**
   * S4-001 (P0). `useDraggable.place()` clamped x to a floor of 12 on the top
   * edge; the self-drawn close / minimise / full-screen cluster occupies
   * 12–75px. `elementFromPoint` on all three centres returned
   * `header.shell-task-head is-grip` — the window could not be closed.
   */
  test("expanded panel tucked to the top leaves all three controls hittable", async ({ page }) => {
    await open(page, "C9");
    await drag(page, page.locator(GRIP), { x: 4, y: 2 });

    await expect(page.locator(".shell-presence")).toHaveAttribute("data-edge", "top");

    const controls = await windowControls(page);
    for (const control of controls) {
      expect(control.reachable, `${control.selector} is covered by ${control.hit}`).toBe(true);
    }

    // And the panel really is at the top edge, so this is not passing because
    // the drag did nothing.
    const panel = await rectOf(page, PANEL);
    expect(panel!.top).toBeLessThan(120);
  });

  /**
   * The collapsed mark is the object that could actually overlap the cluster:
   * it is 56px wide and, tucked to the top, its host box is pulled back to
   * y = 0 — straight over the controls. `CHROME_RESERVE` is what keeps it out.
   */
  test("collapsed mark tucked to the top leaves all three controls hittable", async ({ page }) => {
    await open(page, "C9");
    await collapse(page);

    await drag(page, page.locator(FACE), { x: 6, y: 2 });
    await expect(page.locator(".shell-presence")).toHaveAttribute("data-edge", "top");

    const face = await rectOf(page, ".shell-presence");
    expect(face!.top).toBeLessThan(40); // it really is in the window bar's band
    expect(face!.left).toBeGreaterThanOrEqual(132); // the reserved strip

    for (const control of await windowControls(page)) {
      expect(control.reachable, `${control.selector} is covered by ${control.hit}`).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- S6-011 */

test.describe("the presence is clamped to the box it actually has", () => {
  /**
   * S6-011. `PANEL_SIZE.height` was declared 520 and rendered 543, so every
   * vertical clamp left 23px too little and a panel dragged into the corner
   * hung out of the window with its composer cut off.
   */
  test("dragged into the bottom-right corner, the panel stays inside the window", async ({ page }) => {
    await open(page, "C9");
    await growConversation(page);

    // The premise: the panel is taller than the constant the old code clamped
    // against. Without this the test would pass on the broken code too.
    const grown = await rectOf(page, PANEL);
    expect(grown!.height, "the panel never grew past the declared 520").toBeGreaterThan(520);

    await drag(page, page.locator(GRIP), { x: 1270, y: 795 });

    const panel = await rectOf(page, PANEL);
    expect(panel).not.toBeNull();
    expect(panel!.bottom).toBeLessThanOrEqual(panel!.viewport.height + 0.5);
    expect(panel!.right).toBeLessThanOrEqual(panel!.viewport.width + 0.5);

    // The composer is the control the old clamp cut off. It has to be whole.
    const composer = await rectOf(page, `${PANEL} .shell-task-composer`);
    expect(composer).not.toBeNull();
    expect(composer!.bottom).toBeLessThanOrEqual(composer!.viewport.height + 0.5);
  });

  test("the same holds at every edge, not just the corner", async ({ page }) => {
    await open(page, "C9");
    await growConversation(page);
    for (const target of [
      { x: 2, y: 400 },
      { x: 1278, y: 400 },
      { x: 640, y: 798 },
      { x: 640, y: 2 },
    ]) {
      await drag(page, page.locator(GRIP), target);
      const panel = await rectOf(page, PANEL);
      expect(
        panel!.bottom <= panel!.viewport.height + 0.5 &&
          panel!.top >= -0.5 &&
          panel!.left >= -0.5 &&
          panel!.right <= panel!.viewport.width + 0.5,
        `panel escaped the viewport at ${JSON.stringify(target)}: ${JSON.stringify(panel)}`,
      ).toBe(true);
    }
  });
});

/* ------------------------------------------------------- S4-004 / S4-005 */

test.describe("tucking an expanded panel does not throw its avatars out", () => {
  /**
   * S4-005 / S6-012. The overhang transform was written on `.shell-face` as a
   * *descendant* of `.shell-presence[data-edge]`, and `.shell-face` is also
   * the panel header's avatar, the empty state's avatar and one per assistant
   * reply — an unbounded number. All of them were translated 312px and rotated
   * 90°, ending up 28px past the window edge.
   */
  test("every avatar inside a tucked panel stays in the viewport and untransformed", async ({ page }) => {
    await open(page, "C9");
    await growConversation(page);
    await drag(page, page.locator(GRIP), { x: 1278, y: 400 });
    await expect(page.locator(".shell-presence")).toHaveAttribute("data-edge", "right");

    const faces = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".shell-presence-panel .shell-face")).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          transform: getComputedStyle(element).transform,
        };
      }),
    );
    const viewport = page.viewportSize()!;

    // Header avatar plus one per assistant reply: the unbounded set the old
    // descendant selector matched.
    expect(faces.length, "the panel has no reply avatars to check").toBeGreaterThan(1);
    for (const face of faces) {
      expect(face.transform, `avatar is transformed: ${JSON.stringify(face)}`).toBe("none");
      expect(
        face.rect.left >= -0.5 &&
          face.rect.top >= -0.5 &&
          face.rect.right <= viewport.width + 0.5 &&
          face.rect.bottom <= viewport.height + 0.5,
        `avatar left the viewport: ${JSON.stringify(face.rect)}`,
      ).toBe(true);
    }
  });

  /**
   * S4-004. "Tucked" used to mean nothing for an expanded panel but
   * `opacity: .82`, so the document's text and the panel's text printed
   * through each other. A parked panel is opaque.
   */
  test("a parked panel is fully opaque, not a ghost over the document", async ({ page }) => {
    await open(page, "C9");
    await drag(page, page.locator(GRIP), { x: 1278, y: 400 });

    const opacity = await page.evaluate(
      () => getComputedStyle(document.querySelector(".shell-presence")!).opacity,
    );
    expect(Number(opacity)).toBe(1);
  });

  /** The collapsed mark keeps its overhang — the fix scopes it, it does not delete it. */
  test("the collapsed mark still hangs off the edge", async ({ page }) => {
    await open(page, "C9");
    await collapse(page);
    await drag(page, page.locator(FACE), { x: 1278, y: 400 });
    await expect(page.locator(".shell-presence")).toHaveAttribute("data-edge", "right");

    const transform = await page.evaluate(
      () => getComputedStyle(document.querySelector(".shell-presence .shell-face")!).transform,
    );
    expect(transform, "the tucked mark lost its overhang").not.toBe("none");
  });
});

/* --------------------------------------------------------------- S4-007 */

test.describe("the panel is not a scroll container", () => {
  /**
   * S4-007. `overflow: hidden` still makes a box programmatically scrollable —
   * it only removes the scrollbars. Focusing a control near the bottom pushed
   * the panel's header 36px out of view with no way to bring it back.
   */
  test("moving focus inside the panel never scrolls it", async ({ page }) => {
    await open(page, "C9");

    const before = await rectOf(page, `${PANEL} .shell-task-head`);

    const focused = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".shell-presence-panel")!;
      const controls = panel.querySelectorAll<HTMLElement>("button, input, textarea, [tabindex]");
      const last = controls[controls.length - 1];
      last.focus();
      last.scrollIntoView();
      return { count: controls.length, scrollTop: panel.scrollTop };
    });

    expect(focused.count).toBeGreaterThan(0);
    expect(focused.scrollTop).toBe(0);

    /*
     * The symptom to fence off is the header leaving the panel's box, which is
     * what the audit measured (`headTop 316 < panelTop 352`). An exact rect
     * match is the wrong assertion: focusing a control relayouts the composer
     * by a couple of pixels, and since the panel is measured and re-placed
     * from its own box, its top moves with it. 36px of lost header is the
     * defect; 3px of composer is not.
     */
    const after = await rectOf(page, `${PANEL} .shell-task-head`);
    const panel = await rectOf(page, PANEL);
    expect(after!.top).toBeGreaterThanOrEqual(panel!.top - 0.5);
    expect(Math.abs(after!.top - before!.top)).toBeLessThan(8);
  });

  /**
   * The direct statement of the fix: `overflow: clip` is not a scroll
   * container at all, so an assignment to `scrollTop` cannot take. With
   * `hidden` this assertion fails.
   */
  test("scrollTop cannot be written", async ({ page }) => {
    await open(page, "C9");
    const result = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".shell-presence-panel")!;
      panel.scrollTop = 240;
      return { scrollTop: panel.scrollTop, overflow: getComputedStyle(panel).overflowY };
    });
    expect(result.overflow).toBe("clip");
    expect(result.scrollTop).toBe(0);
  });
});

/* --------------------------------------------------------------- S6-003 */

test.describe("the conversation is handed over, never duplicated", () => {
  /**
   * S6-003. `{docked ? <TaskPanel/> : null}` unmounted the docked
   * conversation on the frame the mode changed, while its 320px column took
   * another 200ms to close and the floating panel appeared at full opacity in
   * the same frame — an empty column beside a full panel.
   *
   * Sampled every animation frame across the whole transition, because the
   * defect lasted 200ms and a single assertion after the fact would miss it.
   */
  test("agent → editor never shows two task panels, or none", async ({ page }) => {
    await open(page, "C6");
    await expect(page.locator(".shell-agent .shell-task")).toHaveCount(1);

    await startSampling(page);

    await page.getByRole("button", { name: /Switch mode/ }).click();
    await page.getByRole("menuitemradio", { name: "Editor" }).click();
    await page.waitForTimeout(700);

    const samples = await stopSampling(page);

    assertOnePanelThroughout(samples);

    await expect(page.locator(PANEL)).toHaveCount(1);
    await expect(page.locator("#shell")).toHaveAttribute("data-mode", "editor");
  });

  /** The same handover driven by the dock control, which is the flip itself. */
  test("undocking never shows two task panels, or none", async ({ page }) => {
    await open(page, "C6");

    await startSampling(page);

    await page.getByTitle("Float the Agent panel").click();
    await page.waitForTimeout(700);

    const samples = await stopSampling(page);

    assertOnePanelThroughout(samples);
  });
});

/* ------------------------------------------------- S4-011 / S4-012 / S4-015 */

test.describe("the panel's own layout follows the state it is in", () => {
  /** S4-011: a 46px slot was reserved for a dock button Editor mode never renders. */
  test("the collapse key only steps aside where a dock button exists", async ({ page }) => {
    await open(page, "C9"); // editor — canDock() is false
    await expect(page.locator(`${PANEL} .shell-icon-button[aria-pressed]`)).toHaveCount(0);
    const editorGap = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence-panel")!.getBoundingClientRect();
      const key = document.querySelector(".shell-presence-collapse")!.getBoundingClientRect();
      return panel.right - key.right;
    });
    expect(editorGap).toBeCloseTo(16, 0);

    await open(page, "C8"); // agent — the dock button is rendered
    await expect(page.locator(`${PANEL} .shell-icon-button[aria-pressed]`)).toHaveCount(1);
    const agentGap = await page.evaluate(() => {
      const panel = document.querySelector(".shell-presence-panel")!.getBoundingClientRect();
      const key = document.querySelector(".shell-presence-collapse")!.getBoundingClientRect();
      return panel.right - key.right;
    });
    expect(agentGap).toBeCloseTo(46, 0);
  });

  /**
   * S4-012: at 1024×700 a fixed 340px panel covered 32% of the canvas. It now
   * gives width back on a window that does not have it. This is a bound, not
   * the cure — the cure needs the editor's safe area (Wave 3-H).
   */
  test("a narrow window gets a narrower panel", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "C9");
    const wide = (await rectOf(page, PANEL))!.width;

    await page.setViewportSize({ width: 1024, height: 700 });
    await page.waitForTimeout(200);
    const narrow = (await rectOf(page, PANEL))!.width;

    expect(wide).toBeCloseTo(340, 0);
    expect(narrow).toBeLessThan(wide);
    // 32% of the canvas was the audit's reading at 1024 wide; the panel now
    // gives back 68px there.
    expect(narrow).toBeLessThanOrEqual(272);
  });

  /**
   * S4-015: the first window resize wrote the derived default into persisted
   * state, so "never placed" was gone forever and a grown window left the
   * panel stranded mid-canvas.
   */
  test("an unplaced panel follows the window instead of being written down", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await open(page, "C9");

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("officedex.shell.v1");
      return raw ? (JSON.parse(raw).presence as { x: number | null; y: number | null }) : null;
    });
    // Nothing persisted at all is also correct — the defect was a resize
    // *writing* the derived default down. What must never appear is a number.
    if (stored) {
      expect(stored.x, "a resize wrote the derived default into storage").toBeNull();
      expect(stored.y, "a resize wrote the derived default into storage").toBeNull();
    }

    // And it is in the corner the design asks for, not at the old coordinates.
    const panel = (await rectOf(page, PANEL))!;
    expect(panel.right).toBeCloseTo(1440 - 24, 0);
    expect(panel.bottom).toBeCloseTo(900 - 28, 0);
  });
});

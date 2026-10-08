/**
 * S3 — the two Homes and the composer (docs/ui-audit-2026-09-19/PLAN.md).
 *
 * Scope: AgentHome *and* EditorHome, which App.tsx:122 swaps wholesale, plus the
 * composer that only AgentHome carries. Combinations C1–C4.
 *
 * Every test prints its measurements as `S3 <name> <json>` so a finding can cite
 * a number rather than an impression, and screenshots land via `capture` so the
 * filename names the combination.
 *
 * Needs the shared fixture server on 3100. Read-only: nothing here writes to a
 * workspace, and the fixture never touches localStorage.
 */

import { expect, test, type Page } from "@playwright/test";

import { capture, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "S3" };

/** Prints a measurement block in one recognisable shape. */
function record(name: string, value: unknown): void {
  console.log(`S3 ${name} ${JSON.stringify(value)}`);
}

async function rect(page: Page, selector: string) {
  return page.evaluate((target: string) => {
    const element = document.querySelector(target);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      left: Math.round(box.left * 10) / 10,
      right: Math.round(box.right * 10) / 10,
      top: Math.round(box.top * 10) / 10,
      bottom: Math.round(box.bottom * 10) / 10,
      width: Math.round(box.width * 10) / 10,
      height: Math.round(box.height * 10) / 10,
    };
  }, selector);
}

/**
 * Goes to a combination *without* the fixture port.
 *
 * The three `ComfortableList` empty states and the empty task list are only
 * reachable on the bridge's empty preview workspace — the audit fixture has
 * files, pins and five tasks by design, so every one of those states is
 * unreachable with `?shellFixture=1`. `readDevFixture` still honours `?shell=`
 * on its own (fixture.ts:143), which is what makes this possible at all.
 */
async function openEmpty(page: Page, combination: Combination): Promise<void> {
  await page.goto(`/?shell=${combination}`);
  await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
}

/* ===================================================== AgentHome (C1/C2) */

test.describe("AgentHome", () => {
  for (const combination of ["C1", "C2"] as const) {
    test(`${combination}: bands, and whether the three of them share a column`, async ({ page }) => {
      await open(page, combination, SESSION);
      await expect(page.locator(".shell-home--agent")).toBeVisible();
      await capture(page, combination, "agenthome-full", SESSION);

      const bands = {
        home: await rect(page, ".shell-home--agent"),
        hero: await rect(page, ".shell-hero"),
        highlights: await rect(page, ".shell-highlights"),
        tasks: await rect(page, ".shell-hero-resume"),
        files: await rect(page, ".shell-home-list"),
      };
      record(`${combination}-band-rects`, bands);

      // What the three 1080-wide bands claim in highlights.css:12 ("Same column
      // the resume card and the file list sit in").
      record(`${combination}-band-left-edges`, {
        highlights: bands.highlights?.left,
        tasks: bands.tasks?.left,
        files: bands.files?.left,
        highlightsMinusTasks: (bands.highlights?.left ?? 0) - (bands.tasks?.left ?? 0),
      });

      const margins = await page.evaluate(() =>
        [".shell-highlights", ".shell-hero-resume", ".shell-home-list"].map((selector) => {
          const node = document.querySelector(selector);
          if (!node) return { selector, missing: true };
          const style = getComputedStyle(node);
          return {
            selector,
            maxWidth: style.maxWidth,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
          };
        }),
      );
      record(`${combination}-band-margins`, margins);
    });
  }

  test("C2: the hero's copy is hard-coded English, and so is every band heading", async ({ page }) => {
    await open(page, "C2", SESSION);
    const copy = await page.evaluate(() => ({
      heroTitle: document.querySelector(".shell-hero h1")?.textContent,
      heroLede: document.querySelector(".shell-hero-lede")?.textContent,
      placeholder: document.querySelector<HTMLTextAreaElement>(".shell-cx-input")?.placeholder,
      quickPrompts: [...document.querySelectorAll(".shell-hero-prompt")].map((n) => n.textContent),
      highlights: document.querySelector("#shell-highlights-title")?.textContent,
      highlightCaptions: [...document.querySelectorAll(".shell-highlight-caption")].map(
        (n) => n.textContent,
      ),
      tasks: document.querySelector(".shell-task-list-head h2")?.textContent,
      tasksHint: document.querySelector(".shell-task-list-hint")?.textContent,
      files: document.querySelector(".shell-home-subhead")?.textContent,
      // The file names beside them come from the workspace and are Chinese in
      // the fixture: this is the mixed-script row PLAN 2.2 asks about.
      fileNames: [...document.querySelectorAll(".shell-list-file > span")]
        .slice(0, 8)
        .map((n) => n.textContent),
      taskTitles: [...document.querySelectorAll(".shell-resume-title strong")].map(
        (n) => n.textContent,
      ),
    }));
    record("C2-copy", copy);
    // `t(` count in src/shell is 0 (PLAN 2.2); assert the shape rather than the grep.
    expect(copy.heroTitle).toBe("What would you like to get done?");
  });

  test("C2: highlights carousel, both boundary states", async ({ page }) => {
    await open(page, "C2", SESSION);
    const previous = page.getByRole("button", { name: "Previous highlight videos" });
    const next = page.getByRole("button", { name: "Next highlight videos" });

    const metrics = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>("#shell-highlights-track");
      if (!track) return null;
      const cards = [...track.querySelectorAll<HTMLElement>("[data-highlight]")];
      return {
        clientWidth: track.clientWidth,
        scrollWidth: track.scrollWidth,
        scrollLeft: track.scrollLeft,
        cardWidth: Math.round(cards[0].getBoundingClientRect().width * 10) / 10,
        cardCount: cards.length,
        gap: getComputedStyle(track).columnGap,
        lastCardRight: Math.round(cards[cards.length - 1].getBoundingClientRect().right * 10) / 10,
        trackRight: Math.round(track.getBoundingClientRect().right * 10) / 10,
      };
    });
    record("C2-carousel-first-screen", {
      ...metrics,
      previousDisabled: await previous.isDisabled(),
      nextDisabled: await next.isDisabled(),
    });
    await capture(page, "C2", "carousel-first-screen", SESSION);

    // Boundary: first screen must disable "previous" and enable "next".
    expect(await previous.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(false);

    await next.click();
    await page.waitForTimeout(700); // smooth scroll + the scroll listener
    const atEnd = await page.evaluate(() => {
      const track = document.querySelector<HTMLElement>("#shell-highlights-track");
      return track
        ? { scrollLeft: Math.round(track.scrollLeft), max: track.scrollWidth - track.clientWidth }
        : null;
    });
    record("C2-carousel-last-screen", {
      ...atEnd,
      previousDisabled: await previous.isDisabled(),
      nextDisabled: await next.isDisabled(),
    });
    await capture(page, "C2", "carousel-last-screen", SESSION);
    expect(await next.isDisabled()).toBe(true);
    expect(await previous.isDisabled()).toBe(false);

    // The focus ring the arrows inherit from the card rule (highlights.css:65).
    // Keyboard, not `focus()`: Chromium only matches `:focus-visible` after a
    // keyboard interaction, so a programmatic focus measures the wrong state.
    await page.locator("#shell-highlights-title").click();
    await page.keyboard.press("Tab");
    const arrowFocus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      return {
        activeLabel: active.getAttribute("aria-label") ?? active.className,
        focusVisible: active.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineOffset: style.outlineOffset,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        borderRadius: style.borderRadius,
        width: style.width,
        height: style.height,
      };
    });
    record("C2-carousel-arrow-focus", arrowFocus);
    await capture(page, "C2", "carousel-arrow-focus", SESSION);

    // And a card, which is what the -2px inset was written for.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const cardFocus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return null;
      const style = getComputedStyle(active);
      const track = document.querySelector<HTMLElement>("#shell-highlights-track")!;
      const box = active.getBoundingClientRect();
      const trackBox = track.getBoundingClientRect();
      return {
        activeLabel: active.getAttribute("aria-label") ?? active.className,
        focusVisible: active.matches(":focus-visible"),
        outlineOffset: style.outlineOffset,
        outlineWidth: style.outlineWidth,
        insideTrack: box.left >= trackBox.left - 0.5 && box.right <= trackBox.right + 0.5,
        trackOverflowX: getComputedStyle(track).overflowX,
        trackScrollLeft: Math.round(track.scrollLeft),
      };
    });
    record("C2-carousel-card-focus", cardFocus);
    await capture(page, "C2", "carousel-card-focus", SESSION);
  });

  test("C2: the five task states, and the long-title row", async ({ page }) => {
    await open(page, "C2", SESSION);
    const rows = page.locator(".shell-task-rows li");
    await expect(rows).toHaveCount(5);

    const states = await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLElement>(".shell-task-row")].map((row) => {
        const title = row.querySelector<HTMLElement>(".shell-resume-title strong")!;
        const status = row.querySelector<HTMLElement>(".shell-task-row-status")!;
        const dot = row.querySelector<HTMLElement>(".shell-task-row-dot")!;
        const meta = row.querySelector<HTMLElement>(".shell-resume-title small");
        return {
          title: title.textContent,
          titleClipped: title.scrollWidth > title.clientWidth + 1,
          titleScrollWidth: title.scrollWidth,
          titleClientWidth: title.clientWidth,
          metaText: meta?.textContent ?? null,
          metaClipped: meta ? meta.scrollWidth > meta.clientWidth + 1 : null,
          statusLabel: status.textContent?.trim(),
          dotState: status.dataset.state,
          dotBackground: getComputedStyle(dot).backgroundColor,
          dotAnimation: getComputedStyle(dot).animationName,
          rowHeight: Math.round(row.getBoundingClientRect().height),
        };
      });
    });
    record("C2-task-rows", states);
    await capture(page, "C2", "tasklist-five-states", SESSION);

    // PLAN 2.2.1: five statuses, no "failed". The order the fake yields is not
    // stable (tasks are keyed by folder), so assert the set.
    expect(new Set(states.map((row) => row.statusLabel))).toEqual(
      new Set([
        "Agent working",
        "Agent waiting for review",
        "Agent paused",
        "Agent finished",
        "Agent idle",
      ]),
    );

    // Why one row is taller than the other four: the title is clamped to a
    // single line and the line under it is not.
    const lines = await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLElement>(".shell-task-row")].map((row) => {
        const strong = row.querySelector<HTMLElement>(".shell-resume-title strong")!;
        const small = row.querySelector<HTMLElement>(".shell-resume-title small");
        const strongStyle = getComputedStyle(strong);
        const smallStyle = small ? getComputedStyle(small) : null;
        // Text width measured off a Range, because scrollWidth on an
        // ellipsised nowrap box is not dependable here.
        const measure = (node: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return Math.round(range.getBoundingClientRect().width);
        };
        return {
          title: strong.textContent?.slice(0, 22),
          titleBoxWidth: Math.round(strong.getBoundingClientRect().width),
          titleTextWidth: measure(strong),
          titleWhiteSpace: strongStyle.whiteSpace,
          titleOverflow: strongStyle.textOverflow,
          titleBoxHeight: Math.round(strong.getBoundingClientRect().height),
          smallBoxWidth: small ? Math.round(small.getBoundingClientRect().width) : null,
          smallTextWidth: small ? measure(small) : null,
          smallBoxHeight: small ? Math.round(small.getBoundingClientRect().height) : null,
          smallWhiteSpace: smallStyle?.whiteSpace ?? null,
          smallOverflow: smallStyle?.textOverflow ?? null,
          smallLineBoxes: small ? small.getClientRects().length : null,
          rowHeight: Math.round(row.getBoundingClientRect().height),
        };
      });
    });
    record("C2-task-row-lines", lines);
    const heights = [...new Set(lines.map((row) => row.rowHeight))];
    record("C2-task-row-heights", heights);
  });

  test("C1/C2: no tasks at all — the band is simply absent", async ({ page }) => {
    await openEmpty(page, "C1");
    const present = await page.evaluate(() => ({
      taskList: document.querySelectorAll(".shell-task-list").length,
      heading: [...document.querySelectorAll(".shell-home--agent h2")].map((n) => n.textContent),
      fileList: document.querySelectorAll(".shell-home-list").length,
      emptyState: document.querySelector(".shell-list-empty")?.textContent ?? null,
      homeHeight: Math.round(
        document.querySelector(".shell-home--agent")!.getBoundingClientRect().height,
      ),
      scrollHeight: (document.querySelector(".shell-home--agent") as HTMLElement).scrollHeight,
    }));
    record("C1-empty-tasklist", present);
    await capture(page, "C1", "agenthome-zero-tasks", SESSION);
    expect(present.taskList).toBe(0);
  });

  test("C2: quick prompts fill the composer rather than send", async ({ page }) => {
    await open(page, "C2", SESSION);
    const prompts = page.locator(".shell-hero-prompt");
    await expect(prompts).toHaveCount(3);
    await prompts.nth(0).click();
    const filled = await page.evaluate(() => {
      const input = document.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
      return {
        value: input.value,
        focused: document.activeElement === input,
        inlineHeight: input.style.height,
        caret: input.selectionStart,
      };
    });
    record("C2-quickprompt-fill", filled);
    await capture(page, "C2", "quickprompt-filled", SESSION);
    expect(filled.value.length).toBeGreaterThan(10);
  });
});

/* ====================================================== composer (C1/C2) */

test.describe("composer on AgentHome", () => {
  test("C2: auto-height floor, cap, and what happens when the width changes", async ({ page }) => {
    await open(page, "C2", SESSION);
    const input = page.locator(".shell-cx-input");

    const readInput = () =>
      page.evaluate(() => {
        const node = document.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
        const style = getComputedStyle(node);
        return {
          inlineHeight: node.style.height,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          overflowing: node.scrollHeight > node.clientHeight + 1,
          minHeight: style.minHeight,
          maxHeight: style.maxHeight,
          width: Math.round(node.getBoundingClientRect().width),
        };
      });

    record("C2-composer-empty", await readInput());
    await input.fill("One line.");
    record("C2-composer-one-line", await readInput());

    await input.fill(Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of the draft`).join("\n"));
    const capped = await readInput();
    record("C2-composer-capped", capped);
    await capture(page, "C2", "composer-height-capped", SESSION);
    // The cap is the design (220 on home); the point of the number is that a
    // long draft scrolls instead of eating Home.
    expect(capped.overflowing).toBe(true);

    // Width change with the same text: the auto-height effect depends on
    // [text, placement] only (Composer.tsx:229), so nothing re-measures.
    await input.fill(
      "A single long paragraph with no newlines at all, which is what people actually paste into a composer when they want the agent to do something specific with a document they are describing in prose rather than in bullet points.",
    );
    const wide = await readInput();
    await page.setViewportSize({ width: 760, height: 720 });
    await page.waitForTimeout(400);
    const narrow = await readInput();
    record("C2-composer-width-change", { wide, narrow });
    await capture(page, "C2", "composer-height-stale-after-resize", SESSION);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("C2: the scope chip, and a folder name long enough to test it", async ({ page }) => {
    await open(page, "C2", SESSION);
    const chipBefore = await page.evaluate(() => {
      const name = document.querySelector<HTMLElement>(".shell-cx-scope-name")!;
      return {
        text: name.textContent,
        maxWidth: getComputedStyle(name).maxWidth,
        clipped: name.scrollWidth > name.clientWidth + 1,
        scrollWidth: name.scrollWidth,
        clientWidth: name.clientWidth,
      };
    });
    record("C2-scope-chip-default", chipBefore);

    await page.locator(".shell-cx-scope").click();
    await expect(page.locator(".shell-menu")).toBeVisible();
    const menu = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".shell-menu")!;
      const box = panel.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        bottom: Math.round(box.bottom),
        width: Math.round(box.width),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        offViewport: box.left < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight,
        rows: [...panel.querySelectorAll(".shell-menu-item")].map((row) => {
          const label = row.querySelector<HTMLElement>("strong, span");
          return {
            text: row.textContent?.slice(0, 60),
            labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : null,
          };
        }),
      };
    });
    record("C2-scope-menu", menu);
    await capture(page, "C2", "composer-scope-menu", SESSION);

    // Pick the long-named folder and re-measure the chip.
    await page.locator(".shell-menu-item").nth(3).click();
    await page.waitForTimeout(250);
    const chipAfter = await page.evaluate(() => {
      const name = document.querySelector<HTMLElement>(".shell-cx-scope-name")!;
      const toolbar = document.querySelector<HTMLElement>(".shell-cx-toolbar")!;
      const left = document.querySelector<HTMLElement>(".shell-cx-left")!;
      const subhead = document.querySelector<HTMLElement>(".shell-home-subhead");
      return {
        text: name.textContent?.slice(0, 40),
        clipped: name.scrollWidth > name.clientWidth + 1,
        scrollWidth: name.scrollWidth,
        clientWidth: name.clientWidth,
        title: document.querySelector(".shell-cx-scope")?.getAttribute("title")?.slice(0, 50),
        toolbarWidth: Math.round(toolbar.getBoundingClientRect().width),
        leftWidth: Math.round(left.getBoundingClientRect().width),
        fileListSubhead: subhead?.textContent?.slice(0, 60) ?? null,
        subheadClipped: subhead ? subhead.scrollWidth > subhead.clientWidth + 1 : null,
      };
    });
    record("C2-scope-chip-long-folder", chipAfter);
    await capture(page, "C2", "composer-scope-long-folder", SESSION);
  });

  test("C2: permission menu and model menu", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.locator(".shell-cx-permission").click();
    await expect(page.locator(".shell-menu")).toBeVisible();
    const permission = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".shell-menu")!;
      const box = panel.getBoundingClientRect();
      return {
        rows: [...panel.querySelectorAll(".shell-menu-item")].map((r) => r.textContent),
        checkedRows: [...panel.querySelectorAll('[aria-checked="true"], .is-checked')].length,
        box: { left: Math.round(box.left), right: Math.round(box.right), bottom: Math.round(box.bottom) },
        offViewport: box.right > window.innerWidth || box.bottom > window.innerHeight,
        buttonLabel: document.querySelector(".shell-cx-permission-name")?.textContent,
      };
    });
    record("C2-permission-menu", permission);
    await capture(page, "C2", "composer-permission-menu", SESSION);

    await page.keyboard.press("Escape");
    await page.locator(".shell-cx-model").click().catch(() => undefined);
    const modelOpen = await page.locator(".shell-menu").count();
    if (modelOpen === 0) {
      // The trigger's class may differ; fall back to the accessible name.
      await page.getByRole("button", { name: /model/i }).first().click();
    }
    await expect(page.locator(".shell-menu")).toBeVisible();
    const model = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".shell-menu")!;
      const box = panel.getBoundingClientRect();
      return {
        rows: [...panel.querySelectorAll(".shell-menu-item")].map((r) => r.textContent?.slice(0, 70)),
        box: { left: Math.round(box.left), right: Math.round(box.right), bottom: Math.round(box.bottom) },
        offViewport: box.right > window.innerWidth || box.bottom > window.innerHeight,
      };
    });
    record("C2-model-menu", model);
    await capture(page, "C2", "composer-model-menu", SESSION);
  });

  test("C2: dropping local files on the composer", async ({ page }) => {
    await open(page, "C2", SESSION);

    // Build a real DataTransfer with files, so `types` contains "Files" the way
    // Composer.tsx:530 requires.
    const makeTransfer = async (count: number, nameLength = 12) =>
      page.evaluateHandle(
        ({ count: howMany, nameLength: length }) => {
          const transfer = new DataTransfer();
          for (let index = 0; index < howMany; index += 1) {
            const stem = `dropped-${String(index + 1).padStart(2, "0")}-${"x".repeat(length)}`;
            transfer.items.add(new File([`content ${index}`], `${stem}.docx`, {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            }));
          }
          return transfer;
        },
        { count, nameLength },
      );

    const transfer = await makeTransfer(1);
    await page.locator(".shell-cx").dispatchEvent("dragover", { dataTransfer: transfer });

    const dragging = await page.evaluate(() => {
      const composer = document.querySelector<HTMLElement>(".shell-cx")!;
      const overlay = document.querySelector<HTMLElement>(".shell-cx-drop");
      const composerBox = composer.getBoundingClientRect();
      const overlayBox = overlay?.getBoundingClientRect() ?? null;
      const overlayStyle = overlay ? getComputedStyle(overlay) : null;
      return {
        hasIsDragging: composer.classList.contains("is-dragging"),
        classList: composer.className,
        overlayPresent: Boolean(overlay),
        overlayText: overlay?.textContent ?? null,
        overlayZIndex: overlayStyle?.zIndex ?? null,
        overlayBackground: overlayStyle?.background.slice(0, 60) ?? null,
        overlayBorder: overlayStyle?.border ?? null,
        overlayPointerEvents: overlayStyle?.pointerEvents ?? null,
        covers:
          overlayBox
            ? Math.round(overlayBox.width) === Math.round(composerBox.width) &&
              Math.round(overlayBox.height) === Math.round(composerBox.height)
            : null,
        composerBox: {
          left: Math.round(composerBox.left),
          top: Math.round(composerBox.top),
          width: Math.round(composerBox.width),
          height: Math.round(composerBox.height),
          borderRadius: getComputedStyle(composer).borderRadius,
        },
        overlayBox: overlayBox
          ? {
              left: Math.round(overlayBox.left),
              top: Math.round(overlayBox.top),
              width: Math.round(overlayBox.width),
              height: Math.round(overlayBox.height),
              borderRadius: overlayStyle?.borderRadius ?? null,
            }
          : null,
        // Does `.is-dragging` change anything at all? Compare against the
        // resting values recorded in C2-composer-empty.
        composerBorderColor: getComputedStyle(composer).borderColor,
        composerBoxShadow: getComputedStyle(composer).boxShadow,
        composerBackground: getComputedStyle(composer).backgroundColor,
      };
    });
    record("C2-drag-over", dragging);
    await capture(page, "C2", "composer-dragging", SESSION);

    await page.locator(".shell-cx").dispatchEvent("drop", { dataTransfer: transfer });
    await page.waitForTimeout(200);
    const dropped = await page.evaluate(() => ({
      chips: [...document.querySelectorAll(".shell-cx-chip")].map((c) => c.textContent),
      overlayPresent: document.querySelectorAll(".shell-cx-drop").length,
      isDragging: document.querySelector(".shell-cx")!.classList.contains("is-dragging"),
    }));
    record("C2-drop-result", dropped);
    await capture(page, "C2", "composer-after-drop", SESSION);
    expect(dropped.chips.length).toBe(1);

    // Now overflow the chip bar: ten long names against `max-height: 112px`.
    const many = await makeTransfer(9, 34);
    await page.locator(".shell-cx").dispatchEvent("drop", { dataTransfer: many });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => {
      const chips = document.querySelector<HTMLElement>(".shell-cx-chips")!;
      const composer = document.querySelector<HTMLElement>(".shell-cx")!;
      const hero = document.querySelector<HTMLElement>(".shell-hero")!;
      const names = [...chips.querySelectorAll<HTMLElement>(".shell-cx-chip-name")];
      return {
        chipCount: chips.querySelectorAll(".shell-cx-chip").length,
        clientHeight: chips.clientHeight,
        scrollHeight: chips.scrollHeight,
        maxHeight: getComputedStyle(chips).maxHeight,
        scrolls: chips.scrollHeight > chips.clientHeight + 1,
        hiddenRows: Math.max(0, chips.scrollHeight - chips.clientHeight),
        nameClipped: names.filter((n) => n.scrollWidth > n.clientWidth + 1).length,
        nameMaxWidth: getComputedStyle(names[0]).maxWidth,
        composerHeight: Math.round(composer.getBoundingClientRect().height),
        heroHeight: Math.round(hero.getBoundingClientRect().height),
        // Anything telling the user there is more above/below the fold?
        overflowStyle: getComputedStyle(chips).overflow,
      };
    });
    record("C2-chip-overflow", overflow);
    await capture(page, "C2", "composer-chip-overflow", SESSION);

    // An eleventh item must be refused: MAX_ATTACHMENTS is 10.
    const eleventh = await makeTransfer(1, 8);
    await page.locator(".shell-cx").dispatchEvent("drop", { dataTransfer: eleventh });
    await page.waitForTimeout(400);
    const refused = await page.evaluate(() => ({
      chipCount: document.querySelectorAll(".shell-cx-chip").length,
      toast: [...document.querySelectorAll(".od-toast, [class*='toast']")].map((n) =>
        n.textContent?.slice(0, 80),
      ),
    }));
    record("C2-attachment-limit", refused);
    await capture(page, "C2", "composer-attachment-limit", SESSION);
  });

  test("C1/C2: what the hero's primary button says before anyone types", async ({ page }) => {
    // The fixture seeds a task in `working`, so `useAgentTask().busy` is true
    // the moment Home paints. Composer.tsx:193 turns an empty Send into Stop.
    await open(page, "C1", SESSION);
    const withRunningTask = await page.evaluate(() => {
      const send = document.querySelector<HTMLButtonElement>(".shell-cx-send")!;
      const input = document.querySelector<HTMLTextAreaElement>(".shell-cx-input")!;
      return {
        inputValue: input.value,
        ariaLabel: send.getAttribute("aria-label"),
        title: send.getAttribute("title"),
        disabled: send.disabled,
        glyph: send.querySelector("svg")?.getAttribute("class") ?? "svg",
        // A square, not an arrow, is what the user sees.
        svgPathCount: send.querySelectorAll("svg *").length,
        background: getComputedStyle(send).backgroundColor,
      };
    });
    record("C1-send-button-with-running-task", withRunningTask);
    await capture(page, "C1", "hero-send-is-stop", SESSION);

    // The same button on an empty workspace, where no run exists.
    await openEmpty(page, "C1");
    const withoutTask = await page.evaluate(() => {
      const send = document.querySelector<HTMLButtonElement>(".shell-cx-send")!;
      return {
        ariaLabel: send.getAttribute("aria-label"),
        disabled: send.disabled,
        background: getComputedStyle(send).backgroundColor,
      };
    });
    record("C1-send-button-no-task", withoutTask);
    expect(withRunningTask.ariaLabel).not.toBe(withoutTask.ariaLabel);
  });

  test("C1: the hero at the collapsed rail, and the composer's container queries", async ({ page }) => {
    await open(page, "C1", SESSION);
    const widths = await page.evaluate(() => {
      const composer = document.querySelector<HTMLElement>(".shell-cx")!;
      return {
        composerWidth: Math.round(composer.getBoundingClientRect().width),
        containerType: getComputedStyle(composer).containerType,
        permissionNameVisible:
          getComputedStyle(document.querySelector<HTMLElement>(".shell-cx-permission-name")!)
            .display !== "none",
        micVisible:
          getComputedStyle(document.querySelector<HTMLElement>(".shell-cx-mic")!).display !== "none",
        heroLeft: Math.round(document.querySelector(".shell-hero")!.getBoundingClientRect().left),
      };
    });
    record("C1-composer-widths", widths);
    await capture(page, "C1", "hero-collapsed-rail", SESSION);
  });
});

/* ===================================================== EditorHome (C3/C4) */

test.describe("EditorHome", () => {
  for (const combination of ["C3", "C4"] as const) {
    test(`${combination}: the whole page, and the legacy Select controls in its header`, async ({ page }) => {
      await open(page, combination, SESSION);
      await expect(page.locator(".shell-home--editor")).toBeVisible();
      await capture(page, combination, "editorhome-full", SESSION);

      const header = await page.evaluate(() => {
        const title = document.querySelector<HTMLElement>(".shell-home-head h1")!;
        const selects = [...document.querySelectorAll<HTMLElement>(".shell-home-controls *")]
          .filter((node) => node.matches("select, button, .od-select, [class*='select']"))
          .map((node) => {
            const style = getComputedStyle(node);
            const box = node.getBoundingClientRect();
            return {
              tag: node.tagName.toLowerCase(),
              className: node.className,
              height: Math.round(box.height),
              borderRadius: style.borderRadius,
              fontFamily: style.fontFamily.slice(0, 40),
              fontSize: style.fontSize,
              borderColor: style.borderColor,
              background: style.backgroundColor,
            };
          });
        const shellButton = document.querySelector<HTMLElement>(".shell-home-new");
        const shellStyle = shellButton ? getComputedStyle(shellButton) : null;
        return {
          title: title.textContent,
          selects,
          shellButton: shellStyle
            ? {
                height: Math.round(shellButton!.getBoundingClientRect().height),
                borderRadius: shellStyle.borderRadius,
                fontFamily: shellStyle.fontFamily.slice(0, 40),
                fontSize: shellStyle.fontSize,
                borderColor: shellStyle.borderColor,
              }
            : null,
          actionLabels: [...document.querySelectorAll(".shell-home-new")].map((n) => n.textContent),
        };
      });
      record(`${combination}-editorhome-header`, header);

      const bands = {
        head: await rect(page, ".shell-home-head"),
        actions: await rect(page, ".shell-home-actions"),
        list: await rect(page, ".shell-home-list"),
        table: await rect(page, ".shell-list"),
      };
      record(`${combination}-editorhome-rects`, bands);
    });
  }

  test("C4: Recent → Pinned, and back", async ({ page }) => {
    await open(page, "C4", SESSION);
    const recent = await page.evaluate(() => ({
      title: document.querySelector(".shell-home-head h1")?.textContent,
      rowCount: document.querySelectorAll(".shell-list tbody tr:not(.shell-list-group)").length,
      groups: [...document.querySelectorAll(".shell-list-group th")].map((n) =>
        n.textContent?.slice(0, 40),
      ),
      pinnedVisible: [...document.querySelectorAll(".shell-list-pin.is-pinned")].length,
      caption: document.querySelector(".shell-list caption")?.textContent,
    }));
    record("C4-recent-view", recent);
    await capture(page, "C4", "editorhome-recent", SESSION);

    await page.getByRole("button", { name: "Pinned", exact: true }).click();
    await page.waitForTimeout(250);
    const pinned = await page.evaluate(() => ({
      title: document.querySelector(".shell-home-head h1")?.textContent,
      rowCount: document.querySelectorAll(".shell-list tbody tr:not(.shell-list-group)").length,
      groups: [...document.querySelectorAll(".shell-list-group th")].map((n) =>
        n.textContent?.slice(0, 40),
      ),
      names: [...document.querySelectorAll(".shell-list-file > span")].map((n) => n.textContent),
      // Grouping is still "Last opened" but the heading now says Pinned; does
      // the group count agree with the rows shown?
      groupCounts: [...document.querySelectorAll(".shell-list-group th small")].map(
        (n) => n.textContent,
      ),
      emptyState: document.querySelector(".shell-list-empty")?.textContent ?? null,
    }));
    record("C4-pinned-view", pinned);
    await capture(page, "C4", "editorhome-pinned", SESSION);
    expect(pinned.title).toBe("Pinned");

    await page.getByRole("button", { name: "Recent", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await page.locator(".shell-home-head h1").textContent()).toBe("Recent");
  });

  test("C3: can the Recent/Pinned pair be reached from the collapsed rail at all", async ({ page }) => {
    await open(page, "C3", SESSION);
    const rail = await page.evaluate(() => {
      const views = document.querySelector<HTMLElement>(".shell-sidebar-views");
      if (!views) return { present: false };
      const buttons = [...views.querySelectorAll<HTMLElement>("button")].map((button) => {
        const box = button.getBoundingClientRect();
        const label = button.querySelector<HTMLElement>("span:not(.shell-visually-hidden)");
        return {
          accessibleName: button.getAttribute("aria-label") ?? button.textContent,
          width: Math.round(box.width),
          height: Math.round(box.height),
          labelDisplay: label ? getComputedStyle(label).display : null,
          labelText: label?.textContent ?? null,
          title: button.getAttribute("title"),
          visible: box.width > 0 && box.height > 0,
        };
      });
      return { present: true, display: getComputedStyle(views).display, buttons };
    });
    record("C3-views-rail", rail);
    await capture(page, "C3", "editorhome-collapsed-views", SESSION);

    const pinnedButton = page.locator(".shell-sidebar-views button").nth(1);
    await pinnedButton.click();
    await page.waitForTimeout(250);
    record("C3-after-pinned-click", {
      title: await page.locator(".shell-home-head h1").textContent(),
    });
    await capture(page, "C3", "editorhome-pinned-collapsed", SESSION);
  });

  test("C4: the three ComfortableList empty states", async ({ page }) => {
    // All three need an empty workspace; see openEmpty().
    await openEmpty(page, "C4");

    const noFiles = await page.evaluate(() => {
      const empty = document.querySelector<HTMLElement>(".shell-list-empty")!;
      const box = empty.getBoundingClientRect();
      const style = getComputedStyle(empty);
      return {
        heading: empty.querySelector("strong")?.textContent,
        body: empty.querySelector("p")?.textContent,
        padding: style.padding,
        textAlign: style.textAlign,
        height: Math.round(box.height),
        width: Math.round(box.width),
        left: Math.round(box.left),
        // Is a table header still drawn above an empty list?
        tableHeaders: document.querySelectorAll(".shell-list thead th").length,
      };
    });
    record("C4-empty-no-files-yet", noFiles);
    await capture(page, "C4", "empty-no-files-yet", SESSION);
    expect(noFiles.heading).toBe("No files yet");

    // "No files of this type": the type filter, still on Recent. The header's
    // control is the legacy `Select` (renderer/ui/components/Select.tsx) — a
    // `button.od-select` opening `.od-menu` with role=menuitemradio rows, not a
    // native <select>, so it has to be driven as a menu.
    await page.getByRole("button", { name: "File type" }).click();
    await expect(page.locator(".od-menu")).toBeVisible();
    const legacyMenu = await page.evaluate(() => {
      const menu = document.querySelector<HTMLElement>(".od-menu")!;
      const style = getComputedStyle(menu);
      const box = menu.getBoundingClientRect();
      return {
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow.slice(0, 50),
        background: style.backgroundColor,
        fontSize: style.fontSize,
        padding: style.padding,
        width: Math.round(box.width),
        rows: [...menu.querySelectorAll("button")].map((b) => b.textContent),
        // The rows themselves: `Select.tsx` renders bare <button> with no
        // `od-menu__item` class, so components.css:648 never applies.
        rowStyles: [...menu.querySelectorAll<HTMLElement>("button")].slice(0, 2).map((b) => {
          const rowStyle = getComputedStyle(b);
          const rowBox = b.getBoundingClientRect();
          return {
            className: b.className || "(none)",
            height: Math.round(rowBox.height),
            padding: rowStyle.padding,
            borderStyle: rowStyle.borderStyle,
            borderWidth: rowStyle.borderWidth,
            borderRadius: rowStyle.borderRadius,
            background: rowStyle.backgroundColor,
            backgroundImage: rowStyle.backgroundImage.slice(0, 40),
            fontFamily: rowStyle.fontFamily.slice(0, 30),
            fontSize: rowStyle.fontSize,
            textAlign: rowStyle.textAlign,
            appearance: rowStyle.appearance,
          };
        }),
      };
    });
    record("C4-legacy-select-menu", legacyMenu);
    await capture(page, "C4", "editorhome-legacy-select-menu", SESSION);
    await page.getByRole("menuitemradio", { name: "Documents" }).click();
    await page.waitForTimeout(250);
    const noType = await page.evaluate(() => ({
      heading: document.querySelector(".shell-list-empty strong")?.textContent,
      body: document.querySelector(".shell-list-empty p")?.textContent,
      typeButtonLabel: document.querySelectorAll<HTMLElement>(".od-select")[1]?.textContent,
    }));
    record("C4-empty-no-files-of-this-type", noType);
    await capture(page, "C4", "empty-no-files-of-this-type", SESSION);
    expect(noType.heading).toBe("No files of this type");

    // "No pinned files": the filter wins over the type branch.
    await page.getByRole("button", { name: "Pinned", exact: true }).click();
    await page.waitForTimeout(250);
    const noPinned = await page.evaluate(() => ({
      heading: document.querySelector(".shell-list-empty strong")?.textContent,
      body: document.querySelector(".shell-list-empty p")?.textContent,
      title: document.querySelector(".shell-home-head h1")?.textContent,
      // The type filter is still Documents; does the copy admit that two
      // filters are active?
      typeButtonLabel: document.querySelectorAll<HTMLElement>(".od-select")[1]?.textContent,
    }));
    record("C4-empty-no-pinned-files", noPinned);
    await capture(page, "C4", "empty-no-pinned-files", SESSION);
    expect(noPinned.heading).toBe("No pinned files");

    // Compare the legacy popup against the shell's own menu on the same screen.
    await page.getByRole("button", { name: "Group by" }).click();
    await expect(page.locator(".od-menu")).toBeVisible();
    const both = await page.evaluate(() => {
      const legacy = document.querySelector<HTMLElement>(".od-menu");
      const legacyStyle = legacy ? getComputedStyle(legacy) : null;
      return {
        odMenu: legacyStyle
          ? {
              borderRadius: legacyStyle.borderRadius,
              fontSize: legacyStyle.fontSize,
              boxShadow: legacyStyle.boxShadow.slice(0, 40),
              zIndex: legacyStyle.zIndex,
              position: legacyStyle.position,
            }
          : null,
      };
    });
    record("C4-od-menu-style", both);
  });

  test("C4: long names in the comfortable list, and the pin column", async ({ page }) => {
    await open(page, "C4", SESSION);
    const cells = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".shell-list tbody tr")].filter(
        (row) => !row.classList.contains("shell-list-group"),
      );
      const worst = rows
        .map((row) => {
          const name = row.querySelector<HTMLElement>(".shell-list-file > span");
          const folder = row.querySelectorAll("td")[1] as HTMLElement | undefined;
          return {
            name: name?.textContent?.slice(0, 30),
            nameScrollWidth: name?.scrollWidth,
            nameClientWidth: name?.clientWidth,
            nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null,
            folderText: folder?.textContent?.slice(0, 30),
            folderScrollWidth: folder?.scrollWidth,
            folderClientWidth: folder?.clientWidth,
            folderClipped: folder ? folder.scrollWidth > folder.clientWidth + 1 : null,
            rowHeight: Math.round(row.getBoundingClientRect().height),
          };
        })
        .filter((row) => row.nameClipped || row.folderClipped);
      const firstColumn = document.querySelector<HTMLElement>(".shell-list td");
      const pin = document.querySelector<HTMLElement>(".shell-list-pin");
      const pinStyle = pin ? getComputedStyle(pin) : null;
      return {
        rowCount: rows.length,
        clippedRows: worst.length,
        examples: worst.slice(0, 4),
        firstColumnWidth: firstColumn
          ? Math.round(firstColumn.getBoundingClientRect().width)
          : null,
        tableWidth: Math.round(document.querySelector(".shell-list")!.getBoundingClientRect().width),
        pinColorAtRest: pinStyle?.color ?? null,
        pinWidth: pinStyle?.width ?? null,
      };
    });
    record("C4-list-long-names", cells);
    await capture(page, "C4", "editorhome-long-names", SESSION);

    // The folder column with no wrap guard: does the Chinese folder name push
    // the table wider than its container?
    const overflow = await page.evaluate(() => {
      const wrapper = document.querySelector<HTMLElement>(".shell-home-list")!;
      const table = document.querySelector<HTMLElement>(".shell-list")!;
      return {
        wrapperWidth: Math.round(wrapper.getBoundingClientRect().width),
        wrapperMaxWidth: getComputedStyle(wrapper).maxWidth,
        tableScrollWidth: table.scrollWidth,
        wrapperScrollWidth: wrapper.scrollWidth,
        wrapperClientWidth: wrapper.clientWidth,
        homeScrollWidth: document.querySelector<HTMLElement>(".shell-home")!.scrollWidth,
        homeClientWidth: document.querySelector<HTMLElement>(".shell-home")!.clientWidth,
      };
    });
    record("C4-list-horizontal-overflow", overflow);

    // Column widths against what nav.css declares, and what the cells that have
    // no wrap guard do with what is left.
    const columns = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>(".shell-list")!;
      const headers = [...table.querySelectorAll<HTMLElement>("thead th")];
      const firstRow = [...table.querySelectorAll<HTMLElement>("tbody tr")].find(
        (row) => !row.classList.contains("shell-list-group"),
      )!;
      const cells = [...firstRow.querySelectorAll<HTMLElement>("td")];
      const tableWidth = table.getBoundingClientRect().width;
      const lineHeight = (node: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      };
      return {
        tableLayout: getComputedStyle(table).tableLayout,
        declaredFirstColumn: getComputedStyle(cells[0]).width,
        firstColumnRule: "nav.css:265 .shell-list td:first-child { width: 46% }",
        headerLineBoxes: headers.map((h) => ({
          text: h.textContent,
          lineBoxes: lineHeight(h),
          height: Math.round(h.getBoundingClientRect().height),
        })),
        columns: cells.map((cell, index) => ({
          column: headers[index]?.textContent,
          width: Math.round(cell.getBoundingClientRect().width),
          share: `${Math.round((cell.getBoundingClientRect().width / tableWidth) * 1000) / 10}%`,
          text: cell.textContent?.slice(0, 26),
          lineBoxes: lineHeight(cell),
          whiteSpace: getComputedStyle(cell).whiteSpace,
          textOverflow: getComputedStyle(cell).textOverflow,
        })),
        declaredRowHeight: getComputedStyle(cells[0]).height,
        actualRowHeights: [
          ...new Set(
            [...table.querySelectorAll<HTMLElement>("tbody tr")]
              .filter((row) => !row.classList.contains("shell-list-group"))
              .map((row) => Math.round(row.getBoundingClientRect().height)),
          ),
        ].sort((a, b) => a - b),
      };
    });
    record("C4-list-columns", columns);
    await capture(page, "C4", "list-column-collapse", SESSION);
  });

  test("C2/C3: does the column collapse reproduce at the other call site and the other width", async ({ page }) => {
    const measure = () =>
      page.evaluate(() => {
        const table = document.querySelector<HTMLTableElement>(".shell-list")!;
        const wrapper = document.querySelector<HTMLElement>(".shell-home-list")!;
        const headers = [...table.querySelectorAll<HTMLElement>("thead th")];
        const firstRow = [...table.querySelectorAll<HTMLElement>("tbody tr")].find(
          (row) => !row.classList.contains("shell-list-group"),
        )!;
        const cells = [...firstRow.querySelectorAll<HTMLElement>("td")];
        const tableWidth = table.getBoundingClientRect().width;
        return {
          wrapperWidth: Math.round(wrapper.getBoundingClientRect().width),
          tableWidth: Math.round(tableWidth),
          overflowsWrapper: table.scrollWidth > wrapper.clientWidth + 1,
          columns: cells.map((cell, index) => ({
            column: headers[index]?.textContent,
            width: Math.round(cell.getBoundingClientRect().width),
            share: `${Math.round((cell.getBoundingClientRect().width / tableWidth) * 1000) / 10}%`,
          })),
          rowHeights: [
            ...new Set(
              [...table.querySelectorAll<HTMLElement>("tbody tr")]
                .filter((row) => !row.classList.contains("shell-list-group"))
                .map((row) => Math.round(row.getBoundingClientRect().height)),
            ),
          ].sort((a, b) => a - b),
        };
      });

    // AgentHome's FileList — the other ComfortableList call site (FileList.tsx:24).
    await open(page, "C2", SESSION);
    record("C2-agenthome-list-columns", await measure());
    await capture(page, "C2", "agenthome-list-columns", SESSION);

    // EditorHome at the wider content box.
    await open(page, "C3", SESSION);
    record("C3-editorhome-list-columns", await measure());
    await capture(page, "C3", "editorhome-list-columns", SESSION);
  });

  test("C2 vs C4: the same ComfortableList, two call sites", async ({ page }) => {
    // AgentHome's FileList is grouping="folder" and no filter; EditorHome
    // defaults to grouping="time". Same component, two different pages.
    await open(page, "C2", SESSION);
    const agentSide = await page.evaluate(() => ({
      caption: document.querySelector(".shell-list caption")?.textContent,
      groups: [...document.querySelectorAll(".shell-list-group th")].map((n) =>
        n.textContent?.slice(0, 30),
      ),
      subhead: document.querySelector(".shell-home-subhead")?.textContent,
      rowCount: document.querySelectorAll(".shell-list tbody tr:not(.shell-list-group)").length,
      headerRow: [...document.querySelectorAll(".shell-list thead th")].map((n) => n.textContent),
    }));
    record("C2-filelist-agent-side", agentSide);

    await open(page, "C4", SESSION);
    const editorSide = await page.evaluate(() => ({
      caption: document.querySelector(".shell-list caption")?.textContent,
      groups: [...document.querySelectorAll(".shell-list-group th")].map((n) =>
        n.textContent?.slice(0, 30),
      ),
      rowCount: document.querySelectorAll(".shell-list tbody tr:not(.shell-list-group)").length,
      headerRow: [...document.querySelectorAll(".shell-list thead th")].map((n) => n.textContent),
    }));
    record("C4-filelist-editor-side", editorSide);
  });

  test("C4: the pin column at rest and under the keyboard", async ({ page }) => {
    await open(page, "C4", SESSION);
    const atRest = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>(".shell-list tbody tr")].filter(
        (row) => !row.classList.contains("shell-list-group"),
      );
      const unpinned = rows
        .map((row) => row.querySelector<HTMLElement>(".shell-list-pin"))
        .find((pin) => pin && !pin.classList.contains("is-pinned"))!;
      const pinned = rows
        .map((row) => row.querySelector<HTMLElement>(".shell-list-pin"))
        .find((pin) => pin?.classList.contains("is-pinned"))!;
      const read = (node: HTMLElement) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return {
          color: style.color,
          width: Math.round(box.width),
          height: Math.round(box.height),
          ariaPressed: node.getAttribute("aria-pressed"),
          ariaLabel: node.getAttribute("aria-label")?.slice(0, 40),
        };
      };
      return { unpinned: read(unpinned), pinned: read(pinned) };
    });
    record("C4-pin-at-rest", atRest);

    // Keyboard: reach a pin button with Tab and see whether it becomes visible.
    // Chromium only matches `:focus-visible` when the last interaction was a
    // keypress, so press Tab first to set that modality, then focus the target.
    await page.locator(".shell-home-head h1").click();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const pin = [...document.querySelectorAll<HTMLElement>(".shell-list-pin")].find(
        (node) => !node.classList.contains("is-pinned"),
      )!;
      pin.focus();
      const style = getComputedStyle(pin);
      return {
        focusVisible: pin.matches(":focus-visible"),
        color: style.color,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        // Any rule at all mentioning this control, so the report can say what
        // is missing rather than just that something looks wrong.
        rules: [...document.styleSheets]
          .flatMap((sheet) => {
            try {
              return [...sheet.cssRules];
            } catch {
              return [];
            }
          })
          .filter((rule) => "selectorText" in rule)
          .map((rule) => (rule as CSSStyleRule).selectorText)
          .filter((selector) => selector?.includes("shell-list-pin")),
      };
    });
    record("C4-pin-keyboard-focus", focused);
    await capture(page, "C4", "pin-column-keyboard-focus", SESSION);
    expect(atRest.unpinned.color).toBe("rgba(0, 0, 0, 0)");
  });

  test("C2: task rows at a narrower width — the subtitle has no guard", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(300);
    const narrow = await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLElement>(".shell-task-row")].map((row) => {
        const strong = row.querySelector<HTMLElement>(".shell-resume-title strong")!;
        const small = row.querySelector<HTMLElement>(".shell-resume-title small")!;
        const range = document.createRange();
        range.selectNodeContents(small);
        const lineBoxes = range.getClientRects().length;
        return {
          title: strong.textContent?.slice(0, 18),
          titleLineBoxes: (() => {
            const titleRange = document.createRange();
            titleRange.selectNodeContents(strong);
            return titleRange.getClientRects().length;
          })(),
          smallLineBoxes: lineBoxes,
          smallBoxHeight: Math.round(small.getBoundingClientRect().height),
          smallWhiteSpace: getComputedStyle(small).whiteSpace,
          rowHeight: Math.round(row.getBoundingClientRect().height),
        };
      });
    });
    record("C2-task-rows-narrow-900", narrow);
    record("C2-task-row-heights-narrow", [...new Set(narrow.map((r) => r.rowHeight))]);
    await capture(page, "C2", "tasklist-narrow-900", SESSION);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("C2: does the sidebar's compact tree reproduce what the comfortable list shows", async ({ page }) => {
    // PLAN 2.4 — the two densities share nav.css, so every finding has to say
    // whether the other half is affected. This is the shared-rule inventory.
    await open(page, "C2", SESSION);
    const shared = await page.evaluate(() => {
      const compactFile = document.querySelector<HTMLElement>(".shell-tree-file-open");
      const comfortableFile = document.querySelector<HTMLElement>(".shell-list-file");
      const read = (node: HTMLElement | null) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          padding: style.padding,
          gap: style.gap,
          color: style.color,
          height: Math.round(node.getBoundingClientRect().height),
        };
      };
      return {
        compactFileRow: read(compactFile),
        comfortableFileRow: read(comfortableFile),
        compactEmptyClass: document.querySelector(".shell-tree-empty")?.textContent ?? null,
        comfortableEmptyClass: document.querySelector(".shell-list-empty")?.textContent ?? null,
        // The only class names genuinely shared between the two branches.
        sharedSelectors: [
          ".shell-tree-empty",
          ".shell-list-empty",
          ".shell-list",
          ".shell-tree",
        ].map((selector) => ({ selector, count: document.querySelectorAll(selector).length })),
      };
    });
    record("C2-dual-render-inventory", shared);
  });
});

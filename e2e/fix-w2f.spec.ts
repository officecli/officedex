/**
 * W2-F regression gate: the top row's chrome and its keyboard order.
 *
 * Seven findings, each asserted in the combination it was measured in:
 *
 *   S6-006 (P0)  Home put no tab in the Tab order at all
 *   S6-005 / S1-005  `.shell-tab-close` had no focus ring, and it was stop 1–7
 *   S1-003 / S6-007  a strip that overflows in all ten combinations, silently
 *   S1-014 / S6-008 / S8-010  240.8px of Home's top row held for hidden controls
 *   S1-004  the status bar's ellipsis rule selected nothing
 *   S8-011  Share's failure path was an empty `catch`
 *   S1-013  `app.css`'s `.shell-windowbar` block lost every property to chrome.css
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server.
 *
 *   npx vite --port 3132 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3132 npx playwright test e2e/fix-w2f.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, capture, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W2-F" };

/** The four Home combinations — the ones S6-006 and S1-014 are about. */
const HOME: Combination[] = ["C1", "C2", "C3", "C4"];

/** Walks the Tab order from the top of the document, reporting where it lands. */
async function tabOrder(page: Page, steps: number) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const seen: { className: string; label: string; outlineStyle: string }[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null;
        if (!node) return { className: "", label: "", outlineStyle: "" };
        return {
          className: node.className,
          label: node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 40) ?? "",
          outlineStyle: getComputedStyle(node).outlineStyle,
        };
      }),
    );
  }
  return seen;
}

test.describe("W2-F chrome and keyboard", () => {
  /* ------------------------------------------------------- S6-006, the P0 */

  test("S6-006 the Tab order reaches a tab before it reaches a close button", async ({ page }) => {
    // The exact inversion of the defect. On C1–C4 the first seven Tab presses
    // landed on seven "Close <file>" buttons and the eighth on the brand menu:
    // a keyboard could close every open file and open none of them, because
    // `home` was used both for "nothing is selected" and for the roving
    // tabindex, leaving the tablist with no tab stop.
    for (const combination of HOME) {
      await open(page, combination, SESSION);
      const order = await tabOrder(page, 12);
      const firstSelect = order.findIndex((stop) => stop.className.includes("shell-tab-select"));
      const firstClose = order.findIndex((stop) => stop.className.includes("shell-tab-close"));

      // eslint-disable-next-line no-console
      console.log(
        `W2F-FIXED taborder ${combination} select@${firstSelect} close@${firstClose} ${JSON.stringify(
          order.slice(0, 7).map((stop) => stop.className),
        )}`,
      );

      expect(firstSelect, `${combination}: no .shell-tab-select in the Tab order`).toBeGreaterThanOrEqual(0);
      expect(firstClose, `${combination}: no .shell-tab-close in the Tab order`).toBeGreaterThanOrEqual(0);
      expect(firstSelect, `${combination}: close button reached before any tab`).toBeLessThan(firstClose);
      await capture(page, combination, "W2F-taborder", SESSION);
    }
  });

  test("S6-006 exactly one tab is the tab stop, on Home and off it", async ({ page }) => {
    // A tablist has one tab stop, not seven and not none. C7 (home=false) was
    // already correct and is the control: the fix must not change it.
    for (const combination of [...HOME, "C7"] as Combination[]) {
      await open(page, combination, SESSION);
      const tabIndexes = await page.locator(".shell-tab-select").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("tabindex")),
      );
      // eslint-disable-next-line no-console
      console.log(`W2F-FIXED tabstop ${combination} ${JSON.stringify(tabIndexes)}`);
      expect(tabIndexes.filter((value) => value === "0")).toHaveLength(1);
      expect(tabIndexes[0]).toBe("0");
    }
  });

  test("S6-006 the arrow keys reach the tabs the single tab stop does not", async ({ page }) => {
    // With one tab stop, the other six are reached with the arrow keys or not at
    // all. Manual activation: focus moves, the canvas does not change until the
    // tab is pressed, so arrowing past four files must not open four files.
    await open(page, "C2", SESSION);
    const modeBefore = await page.locator("#shell").getAttribute("data-home");

    await page.locator(".shell-tab-select").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const third = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(third).toContain("MO launch deck");

    await page.keyboard.press("End");
    const last = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(last).toContain("Scratch notes");

    await page.keyboard.press("Home");
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(first).toContain("MO launch plan");

    // Nothing was activated on the way.
    expect(await page.locator("#shell").getAttribute("data-home")).toBe(modeBefore);

    // And Enter still activates, which is what makes manual activation legal.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.locator("#shell")).toHaveAttribute("data-home", "false");
    await expect(page.locator(".shell-tab.is-current .shell-tab-select")).toHaveAttribute(
      "title",
      "MO sales forecast.xlsx",
    );
  });

  /* -------------------------------------------------- S6-005 / S1-005 */

  test("S6-005 the close button draws a focus ring", async ({ page }) => {
    // `outline-style`, not `outline-width`: a computed `outline-width` still
    // reports 3px while the style is `none`, which is how this was missed.
    for (const combination of ["C1", "C2", "C6", "C7"] as Combination[]) {
      await open(page, combination, SESSION);
      const ring = await page.locator(".shell-tab-close").first().evaluate((node) => {
        (node as HTMLElement).focus();
        const style = getComputedStyle(node);
        return {
          focused: document.activeElement === node,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F-FIXED closering ${combination} ${JSON.stringify(ring)}`);
      expect(ring.focused).toBe(true);
      expect(ring.outlineStyle).not.toBe("none");
    }
  });

  /* ------------------------------------------- S1-003 / S6-007 / S1-014 */

  test("S1-003 every combination either fits its tabs or says it does not", async ({ page }) => {
    // The strip overflowed in all ten and showed nothing about it: no scrollbar
    // (hidden by two rules), no arrows, no fade. Either outcome is acceptable
    // now; silence is not.
    for (const combination of COMBINATIONS) {
      await open(page, combination, SESSION);
      const measured = await page.evaluate(() => {
        const strip = document.querySelector<HTMLElement>(".shell-tabstrip")!;
        const bounds = strip.getBoundingClientRect();
        const tabs = Array.from(document.querySelectorAll<HTMLElement>(".shell-tab"));
        const cues = Array.from(document.querySelectorAll<HTMLElement>(".shell-tabstrip-scroll")).filter(
          (node) => node.getBoundingClientRect().width > 0,
        );
        return {
          overflow: strip.scrollWidth - strip.clientWidth,
          tabs: tabs.length,
          fullyVisible: tabs.filter((tab) => {
            const rect = tab.getBoundingClientRect();
            return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5;
          }).length,
          visibleCues: cues.length,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F-FIXED overflow ${combination} ${JSON.stringify(measured)}`);

      const allFit = measured.fullyVisible === measured.tabs;
      expect(
        allFit || measured.visibleCues > 0,
        `${combination}: ${measured.tabs - measured.fullyVisible} tabs cut off and no visible overflow control`,
      ).toBe(true);
      await capture(page, combination, "W2F-tabstrip", SESSION);
    }
  });

  test("S1-003 in C6 — the worst case — every close button can be brought into reach", async ({
    page,
  }) => {
    // C6 is the docked Agent column on an expanded rail: 469px of strip for
    // seven tabs. Four of them, and their close buttons, were outside the
    // visible box with no way to get at them. The route is the scroll control a
    // user can see and press, not `scrollIntoView` from the test.
    await open(page, "C6", SESSION);
    const total = await page.locator(".shell-tab").count();
    expect(total).toBe(7);

    const reachable = async () =>
      page.evaluate(() => {
        const strip = document.querySelector<HTMLElement>(".shell-tabstrip")!;
        const bounds = strip.getBoundingClientRect();
        return Array.from(document.querySelectorAll<HTMLElement>(".shell-tab")).map((tab, index) => {
          const close = tab.querySelector<HTMLElement>(".shell-tab-close")!;
          const box = close.getBoundingClientRect();
          const inside = box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5;
          // Inside the strip *and* the topmost thing at its own centre: a close
          // button under the file actions is not clickable either.
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { index, inside, hit: inside && close.contains(hit) };
        });
      });

    const everReached = new Set<number>();
    const next = page.getByRole("button", { name: "Scroll tabs right" });
    await expect(next).toBeVisible();
    for (const entry of await reachable()) if (entry.hit) everReached.add(entry.index);

    // Bounded: seven tabs cannot need more than seven presses.
    for (let press = 0; press < 8 && everReached.size < total; press += 1) {
      if (await next.isDisabled()) break;
      await next.click();
      await page.waitForTimeout(80);
      for (const entry of await reachable()) if (entry.hit) everReached.add(entry.index);
    }
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED C6-close-reachable ${everReached.size}/${total}`);
    await capture(page, "C6", "W2F-scrolled-to-end", SESSION);
    expect([...everReached].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // At the far end the forward control says so rather than doing nothing, and
    // the way back exists.
    await expect(next).toBeDisabled();
    const back = page.getByRole("button", { name: "Scroll tabs left" });
    await expect(back).toBeEnabled();
    await back.click();
    await expect(next).toBeEnabled();
  });

  test("S1-014 Home's file actions take no room at all", async ({ page }) => {
    // `visibility: hidden` kept a 240.8px box for four controls that were, as
    // measured, not focusable either — the comment claiming it preserved
    // keyboard access was describing something that never worked. `display:
    // none` gives the row back, and the seven tabs then fit.
    for (const combination of HOME) {
      await open(page, combination, SESSION);
      const measured = await page.evaluate(() => {
        const actions = document.querySelector<HTMLElement>(".shell-tabs-actions")!;
        const strip = document.querySelector<HTMLElement>(".shell-tabstrip")!;
        return {
          width: actions.getBoundingClientRect().width,
          display: getComputedStyle(actions).display,
          overflow: strip.scrollWidth - strip.clientWidth,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F-FIXED home-actions ${combination} ${JSON.stringify(measured)}`);
      expect(measured.width).toBe(0);
      expect(measured.overflow).toBeLessThanOrEqual(0);
    }

    // Off Home they are back, because there is a file for them to act on.
    await open(page, "C7", SESSION);
    expect(await page.locator(".shell-tabs-actions").evaluate((node) => node.getBoundingClientRect().width))
      .toBeGreaterThan(0);
  });

  /* ------------------------------------------------------------- S1-004 */

  test("S1-004 a long file name in the status bar ends in an ellipsis and keeps its full text", async ({
    page,
  }) => {
    await open(page, "C6", SESSION);
    // The 66-character Chinese name from the audit fixture; it was cut
    // mid-character at 497px with no "…" and no tooltip.
    await page.locator(".shell-tab-select[title^='二']").click();
    const facts = page.locator(".shell-statusbar-facts > span").first();
    const measured = await facts.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        title: node.getAttribute("title"),
        text: node.textContent ?? "",
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED statusbar ${JSON.stringify(measured)}`);

    // It is genuinely too long for the bar, so the ellipsis is doing work…
    expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
    expect(measured.textOverflow).toBe("ellipsis");
    // …and the whole name is still recoverable from the tooltip.
    expect(measured.title).toBe(measured.text);
    expect(measured.title).toContain("现场执行三个分册");

    // The rule that used to claim this job selected `.shell-statusbar > span`,
    // and the bar's direct children are two divs. It matched nothing.
    const dead = await page.evaluate(() => {
      let declared = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if ((rule as CSSStyleRule).selectorText === ".shell-statusbar > span") declared += 1;
        }
      }
      return { declared, matches: document.querySelectorAll(".shell-statusbar > span").length };
    });
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED dead-selector ${JSON.stringify(dead)}`);
    expect(dead.declared).toBe(0);
    await capture(page, "C6", "W2F-statusbar-longname", SESSION);
  });

  /* ------------------------------------------------------------- S8-011 */

  test("S8-011 Share reports a failure instead of swallowing it", async ({ page }) => {
    // The empty `catch` was written for "the user dismissed the native share
    // sheet" and went on to eat every other outcome. In a plain browser the
    // clipboard permission is what fails, and pressing Share with a file open
    // produced no toast at all. Forced here so the assertion is about the code
    // path rather than about this machine's permission prompt.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error("Write permission denied.")),
        },
      });
    });
    await open(page, "C6", SESSION);
    await expect(page.locator(".od-toast")).toHaveCount(0);

    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.locator(".od-toast")).not.toHaveCount(0);
    const text = await page.locator(".od-toast").first().innerText();
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED share-failure ${JSON.stringify(text)}`);
    expect(text).toContain("Write permission denied.");
    await capture(page, "C6", "W2F-share-failure", SESSION);
  });

  test("S8-011 with no file open, Share says what is missing and not that it does not exist", async ({
    page,
  }) => {
    // The old copy was "Sharing a file from OfficeDex is not built yet. Open a
    // local file first." — if it is not built, opening a file cannot help. It is
    // built; it needs a document.
    //
    // No `?shellFixture=1` here, on purpose: the fixture opens seven files, so
    // there is always an active one and this branch is unreachable. Without it
    // the port is the bridge's preview implementation — a genuinely empty
    // workspace, which is what a first run looks like. `C9` so the button is on
    // screen (Home takes the file actions out of the row now).
    await page.goto("/?shell=C9");
    await expect(page.locator("#shell")).toHaveAttribute("data-loaded", "true");
    await expect(page.locator(".shell-tab")).toHaveCount(0);

    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.locator(".od-toast")).not.toHaveCount(0);
    const text = await page.locator(".od-toast").first().innerText();
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED share-nofile ${JSON.stringify(text)}`);
    expect(text).toContain("Open a file to share it");
    expect(text.toLowerCase()).not.toContain("not built yet");
  });

  /* ------------------------------------------------------------- S1-013 */

  test("S1-013 the window bar is declared once, and the 132px clearance is where the comment says", async ({
    page,
  }) => {
    // Two rules, same selector, same specificity, different files: chrome.css
    // imported second and took `width`, `min-width` and the width transition.
    // `min-width` measured 0px in all ten combinations while app.css claimed
    // 132px next to a comment about the traffic lights always fitting.
    for (const combination of COMBINATIONS) {
      await open(page, combination, SESSION);
      const measured = await page.evaluate(() => {
        let declarations = 0;
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of Array.from(rules)) {
            if ((rule as CSSStyleRule).selectorText === ".shell-windowbar") declarations += 1;
          }
        }
        const bar = document.querySelector<HTMLElement>(".shell-windowbar")!;
        const controls = document.querySelector<HTMLElement>(".shell-window-controls")!;
        const toggle = document.querySelector<HTMLElement>(".shell-nav-toggle")!;
        const strip = document.querySelector<HTMLElement>(".shell-tabstrip")!;
        return {
          declarations,
          padding: getComputedStyle(bar).paddingLeft,
          controlsLeft: controls.getBoundingClientRect().left,
          toggleRight: Math.round(toggle.getBoundingClientRect().right),
          stripLeft: Math.round(strip.getBoundingClientRect().left),
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F-FIXED windowbar ${combination} ${JSON.stringify(measured)}`);

      // One rule, in chrome.css.
      expect(measured.declarations).toBe(1);
      // The live declarations survived the move.
      expect(measured.padding).toBe("12px");
      expect(measured.controlsLeft).toBeCloseTo(12, 0);
      // And the clearance the deleted comment described is real, wherever it is
      // declared: the strip never starts on top of the sidebar toggle.
      expect(measured.stripLeft).toBeGreaterThanOrEqual(measured.toggleRight);
    }
  });

  /* ------------------------------------------ S1-006 / S1-007, the small ones */

  test("S1-006 the current sidebar row answers the pointer", async ({ page }) => {
    // `.is-current` and `:hover` are both (0,2,0) and `.is-current` came second,
    // so the one row a user is most likely to aim at was the one that did not
    // react.
    await open(page, "C2", SESSION);
    const row = page.locator(".shell-sidebar-item.is-current").first();
    const rest = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
    await row.hover();
    const hovered = await row.evaluate((node) => getComputedStyle(node).backgroundColor);
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED current-hover rest=${rest} hover=${hovered}`);
    expect(hovered).not.toBe(rest);
  });

  test("S1-007 the chrome has press feedback", async ({ page }) => {
    // Of the 90 `:active` rules in the loaded stylesheets, two came from
    // `src/shell` and neither was in the chrome: in one window the legacy
    // controls acknowledged a press and the new shell's did not.
    await open(page, "C7", SESSION);
    const covered = await page.evaluate(() => {
      const wanted = [
        ".shell-icon-button",
        ".shell-tab-select",
        ".shell-tab-close",
        ".shell-sidebar-item",
        ".shell-share",
        ".shell-save-state",
      ];
      const found = new Set<string>();
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          const selector = (rule as CSSStyleRule).selectorText;
          if (!selector || !selector.includes(":active")) continue;
          for (const target of wanted) {
            if (selector.includes(`${target}:`) || selector.includes(`${target} `)) found.add(target);
          }
        }
      }
      return { missing: wanted.filter((target) => !found.has(target)) };
    });
    // eslint-disable-next-line no-console
    console.log(`W2F-FIXED active-rules ${JSON.stringify(covered)}`);
    expect(covered.missing).toEqual([]);
  });
});

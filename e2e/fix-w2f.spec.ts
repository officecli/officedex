/**
 * W2-F regression gate: the content region's top row and its keyboard order.
 *
 * Seven findings were recorded against the old chrome. r10 replaced that chrome
 * — there is no bar across the window, no status bar, no window bar and no
 * separate file-actions block on Home — so each one is asserted here against the
 * surface that inherited it:
 *
 *   S6-006 (P0)  a tablist with no tab stop, and seven close buttons instead
 *                → `.dx-document-tabs` / `.dx-tab-title` / `[data-act=close-file]`
 *   S6-005 / S1-005  the close button had no focus ring
 *   S1-003 / S6-007  a strip that overflows and shows nothing about it
 *                → r10's cue is a real scrollbar on `.dx-document-tabs`
 *   S1-014 / S6-008  240.8px of Home's top row held for hidden controls
 *                → r10's Home band is an empty 40px `.dx-home-top`
 *   S1-004  a long name cut mid-character with no ellipsis and no tooltip
 *                → the same job, now the document tab's
 *   S8-011  Share's failure path was an empty `catch`
 *                → Share no longer writes the clipboard; it must still not go silent
 *   S1-013  `.shell-windowbar` lost every property to a duplicate rule
 *                → what survives is the clearance the deleted comment described
 *
 * There is deliberately no `test.skip` anywhere in this file, conditional or
 * otherwise. `e2e/ui-audit-s4.spec.ts` is 30 cases of `test.skip(!BRIDGE)`,
 * which reports "30 skipped" and exit code 0 when its environment is absent —
 * indistinguishable from a pass in a CI summary line. Everything here runs
 * against the fixture server, which needs nothing but the dev server.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w2f.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, open, type Combination } from "./r10-b-helpers";

/**
 * The combinations whose content region shows document tabs and is reachable.
 *
 * `showsTabStrip` is false on Home, Local and Settings (C1, C2, C3, C10): those
 * draw an empty 40px band instead. C8 is left out of the keyboard cases on
 * purpose — its content region is closed, so `#dx-content` carries `inert` and
 * nothing inside it is in the tab order at all, which is the intent rather than
 * a missing tab stop.
 */
const WITH_TABS: Combination[] = ["C4", "C5", "C6", "C7", "C9"];

/** The combinations whose top row is the blank band. */
const BLANK_BAND: Combination[] = ["C1", "C2", "C3", "C10"];

/** §03: every column's own top row is 40px, and there is no bar across the window. */
const TOP_ROW = 40;

/** Walks the Tab order from the top of the document, reporting where it lands. */
async function tabOrder(page: Page, steps: number) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const seen: { act: string; className: string; label: string }[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null;
        if (!node) return { act: "", className: "", label: "" };
        return {
          act: node.getAttribute("data-act") ?? "",
          className: node.className,
          label: node.getAttribute("aria-label") ?? node.textContent?.trim().slice(0, 40) ?? "",
        };
      }),
    );
  }
  return seen;
}

test.describe("W2-F the top row and the keyboard", () => {
  /* ------------------------------------------------------- S6-006, the P0 */

  test("S6-006 the Tab order reaches a tab before it reaches a close button", async ({ page }) => {
    // The exact inversion of the defect. The first seven Tab presses used to
    // land on seven "Close <file>" buttons, because one flag was used both for
    // "nothing is selected" and for the roving tabindex, leaving the tablist
    // with no tab stop: a keyboard could close every open file and open none.
    for (const combination of WITH_TABS) {
      await open(page, combination);
      // Long enough to get past the sidebar: the global controls, New, Local,
      // the project group's two buttons and then a row per project and per
      // conversation all come before the content region.
      const order = await tabOrder(page, 80);
      const firstTab = order.findIndex((stop) => stop.act === "open-tab");
      const firstClose = order.findIndex((stop) => stop.act === "close-file");

      // eslint-disable-next-line no-console
      console.log(
        `W2F taborder ${combination} tab@${firstTab} close@${firstClose} ${JSON.stringify(
          order.filter((stop) => stop.act === "open-tab" || stop.act === "close-file").slice(0, 4),
        )}`,
      );

      expect(firstTab, `${combination}: no document tab in the Tab order`).toBeGreaterThanOrEqual(0);
      if (firstClose >= 0) {
        expect(firstTab, `${combination}: a close button is reached before any tab`).toBeLessThan(firstClose);
      }
    }
  });

  test("S6-006 exactly one tab is the tab stop, and exactly one is selected", async ({ page }) => {
    // A tablist has one tab stop, not seven and not none. C8's content region is
    // closed and is included on purpose: the roving index is a DOM property, and
    // it has to be right there too for the strip to be usable the moment the
    // region opens again.
    for (const combination of [...WITH_TABS, "C8"] as Combination[]) {
      await open(page, combination);
      const tabs = await page.locator(".dx-tab-title").evaluateAll((nodes) =>
        nodes.map((node) => ({
          tabIndex: node.getAttribute("tabindex"),
          selected: node.getAttribute("aria-selected"),
          role: node.getAttribute("role"),
        })),
      );
      // eslint-disable-next-line no-console
      console.log(`W2F tabstop ${combination} ${JSON.stringify(tabs)}`);

      expect(tabs.length, `${combination}: no tabs`).toBeGreaterThan(1);
      for (const tab of tabs) expect(tab.role).toBe("tab");
      expect(tabs.filter((tab) => tab.tabIndex === "0")).toHaveLength(1);
      // §r9: exactly one tab carries aria-selected=true. On a page that shows
      // the strip without a document (Assets) none is selected, and then the
      // tab stop is the first tab rather than nothing.
      const selected = tabs.filter((tab) => tab.selected === "true");
      expect(selected.length).toBeLessThanOrEqual(1);
      if (selected.length === 0) expect(tabs[0].tabIndex).toBe("0");
    }
  });

  test("S6-006 the arrow keys reach the tabs the single tab stop does not", async ({ page }) => {
    // With one tab stop, the other six are reached with the arrow keys or not at
    // all. r10 activates as it moves — "左右箭头 / Home / End 可切换" — so the
    // check is that focus and selection stay together, and that Home and End
    // reach the ends rather than stopping at the neighbour.
    await open(page, "C5");

    const focusedTab = () =>
      page.evaluate(() => {
        const node = document.activeElement as HTMLElement | null;
        return {
          id: node?.getAttribute("data-id") ?? null,
          selected: node?.getAttribute("aria-selected") ?? null,
          // The selection is the file on screen, not just an attribute.
          onScreen: document.querySelector(".dx-editor-wrapper")?.getAttribute("data-file-editor") ?? null,
          selectedCount: document.querySelectorAll('.dx-tab-title[aria-selected="true"]').length,
        };
      });

    const ids = await page.locator(".dx-tab-title").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-id")!),
    );
    expect(ids.length).toBeGreaterThan(2);

    await page.locator(".dx-tab-title").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await focusedTab()).toEqual({
      id: ids[2],
      selected: "true",
      onScreen: ids[2],
      selectedCount: 1,
    });

    await page.keyboard.press("End");
    expect(await focusedTab()).toMatchObject({ id: ids[ids.length - 1], selected: "true", selectedCount: 1 });

    await page.keyboard.press("Home");
    expect(await focusedTab()).toMatchObject({ id: ids[0], selected: "true", selectedCount: 1 });

    // And the roving index moved with the selection, so Tab does not put the
    // user back at a tab they have left.
    const stops = await page.locator(".dx-tab-title").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("tabindex")),
    );
    expect(stops.filter((value) => value === "0")).toHaveLength(1);
    expect(stops[0]).toBe("0");
  });

  /* -------------------------------------------------- S6-005 / S1-005 */

  test("S6-005 the close button draws a focus ring", async ({ page }) => {
    // `outline-style`, not `outline-width`: a computed `outline-width` still
    // reports 3px while the style is `none`, which is how this was missed.
    for (const combination of ["C5", "C6", "C7", "C9"] as Combination[]) {
      await open(page, combination);
      const ring = await page.locator("[data-act=close-file]").first().evaluate((node) => {
        (node as HTMLElement).focus();
        let ringOn: string | null = null;
        let outlineStyle = "none";
        for (let walk: HTMLElement | null = node as HTMLElement; walk; walk = walk.parentElement) {
          const style = getComputedStyle(walk);
          if (style.outlineStyle !== "none") {
            ringOn = walk.className;
            outlineStyle = style.outlineStyle;
            break;
          }
          if (walk.id === "dx-workspace") break;
        }
        return { focused: document.activeElement === node, ringOn, outlineStyle };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F closering ${combination} ${JSON.stringify(ring)}`);
      expect(ring.focused).toBe(true);
      expect(ring.outlineStyle, `${combination}: the close button draws nothing on focus`).not.toBe("none");
    }
  });

  /* ------------------------------------------- S1-003 / S6-007 / S1-014 */

  test("S1-003 every combination either fits its tabs or scrolls, visibly", async ({ page }) => {
    // The old strip overflowed in all ten and showed nothing about it: no
    // scrollbar (hidden by two rules), no arrows, no fade. Either outcome is
    // acceptable; silence is not. r10's answer is a real scrollbar, so
    // `scrollbar-width: none` would put the defect straight back.
    for (const combination of COMBINATIONS) {
      await open(page, combination);
      const measured = await page.evaluate(() => {
        const strip = document.querySelector<HTMLElement>(".dx-document-tabs");
        if (!strip) return null;
        const bounds = strip.getBoundingClientRect();
        const tabs = [...document.querySelectorAll<HTMLElement>(".dx-file-tab")];
        const style = getComputedStyle(strip);
        return {
          overflow: strip.scrollWidth - strip.clientWidth,
          tabs: tabs.length,
          fullyVisible: tabs.filter((tab) => {
            const rect = tab.getBoundingClientRect();
            return rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5;
          }).length,
          overflowX: style.overflowX,
          scrollbarWidth: style.scrollbarWidth,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F overflow ${combination} ${JSON.stringify(measured)}`);

      if (!measured) {
        // No strip at all is the answer on Home, Local and Settings.
        expect(BLANK_BAND, `${combination}: no tab strip and no reason for it`).toContain(combination);
        continue;
      }
      if (measured.fullyVisible === measured.tabs) continue;
      expect(
        measured.overflowX,
        `${combination}: ${measured.tabs - measured.fullyVisible} tabs cut off and the strip does not scroll`,
      ).toBe("auto");
      expect(measured.overflow, `${combination}: tabs cut off with nothing to scroll`).toBeGreaterThan(0);
      expect(
        measured.scrollbarWidth,
        `${combination}: the strip scrolls and its scrollbar is suppressed`,
      ).not.toBe("none");
    }
  });

  test("S1-003 in C6 — the worst case — every close button can be brought into reach", async ({ page }) => {
    // C6 is the conversation docked on the right with the sidebar hidden: the
    // narrowest strip any combination gives seven tabs. Four of them, and their
    // close buttons, were outside the visible box with no way to get at them.
    // The route is a gesture a user can make — the wheel over the strip — not
    // `scrollIntoView` from the test.
    await open(page, "C6");
    const total = await page.locator(".dx-file-tab").count();
    expect(total).toBe(7);

    const strip = page.locator(".dx-document-tabs");
    const stripBox = (await strip.boundingBox())!;
    await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);

    /** Which tabs are fully inside the strip right now. */
    const insideStrip = () =>
      page.evaluate(() => {
        const box = document.querySelector<HTMLElement>(".dx-document-tabs")!.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(".dx-file-tab")]
          .map((tab, index) => {
            const rect = tab.getBoundingClientRect();
            return { index, inside: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 };
          })
          .filter((entry) => entry.inside)
          .map((entry) => entry.index);
      });

    /**
     * Whether tab `index`'s close button can actually be clicked.
     *
     * The tab has to be hovered first: r10 keeps a non-current tab's close
     * button at `opacity: 0; pointer-events: none` and hands it back on the
     * tab's own `:hover`, so the question is not "is the button there" but
     * "does aiming at the tab put a usable button under the pointer".
     */
    const hittable = async (index: number) => {
      const tab = page.locator(".dx-file-tab").nth(index);
      await tab.hover();
      return page.evaluate((nth: number) => {
        const node = document.querySelectorAll<HTMLElement>(".dx-file-tab")[nth];
        const close = node.querySelector<HTMLElement>("[data-act=close-file]")!;
        const rect = close.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return close.contains(hit) && getComputedStyle(close).pointerEvents !== "none";
      }, index);
    };

    const everReached = new Set<number>();
    const sweep = async () => {
      for (const index of await insideStrip()) {
        if (!everReached.has(index) && (await hittable(index))) everReached.add(index);
      }
    };

    await sweep();
    expect(everReached.size, "every tab already fits, so this measures nothing").toBeLessThan(total);

    // Bounded: seven tabs cannot need more than eight scrolls of a whole tab.
    // The pointer goes back over the strip after each hover, which is where the
    // wheel has to be for the strip to be the thing that scrolls.
    for (let step = 0; step < 8 && everReached.size < total; step += 1) {
      await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
      await page.mouse.wheel(220, 0);
      await page.waitForTimeout(80);
      await sweep();
    }
    // eslint-disable-next-line no-console
    console.log(`W2F C6-close-reachable ${everReached.size}/${total}`);
    expect([...everReached].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // And the way back exists: the strip is at its end and scrolls home again.
    const atEnd = await strip.evaluate((node) => node.scrollLeft);
    expect(atEnd).toBeGreaterThan(0);
    await page.mouse.move(stripBox.x + stripBox.width / 2, stripBox.y + stripBox.height / 2);
    await page.mouse.wheel(-2000, 0);
    await page.waitForTimeout(80);
    expect(await strip.evaluate((node) => node.scrollLeft)).toBe(0);
  });

  test("S1-014 a page without documents keeps a 40px band and nothing in it", async ({ page }) => {
    // `visibility: hidden` used to keep a 240.8px box for four controls that
    // were, as measured, not focusable either. r10 does not render them at all
    // on a page that has no document — and the band it leaves is exactly the
    // 40px top row every column has, not a gap where something used to be.
    for (const combination of BLANK_BAND) {
      await open(page, combination);
      const band = await page.evaluate(() => {
        const top = document.querySelector<HTMLElement>("#dx-content > .dx-home-top");
        return top
          ? {
              height: Math.round(top.getBoundingClientRect().height),
              tabs: document.querySelectorAll(".dx-file-tab").length,
              actions: document.querySelectorAll(".dx-source-header-actions").length,
              children: top.children.length,
            }
          : null;
      });
      // eslint-disable-next-line no-console
      console.log(`W2F blank-band ${combination} ${JSON.stringify(band)}`);
      expect(band, `${combination}: no top band`).not.toBeNull();
      expect(band!.height).toBe(TOP_ROW);
      expect(band!.tabs).toBe(0);
      expect(band!.actions, `${combination}: file actions on a page with no file`).toBe(0);
      expect(band!.children, `${combination}: something is being held in the band`).toBe(0);
    }

    // With a document on screen they are back, because there is a file to act on.
    await open(page, "C5");
    const actions = page.locator(".dx-source-header-actions");
    await expect(actions).toHaveCount(1);
    expect(await actions.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(0);
    // Still one 40px row, not two.
    expect(await page.locator(".dx-tabs-strip").evaluate((node) => Math.round(node.getBoundingClientRect().height))).toBe(TOP_ROW);
  });

  /* ------------------------------------------------------------- S1-004 */

  test("S1-004 a long file name is cut with an ellipsis and stays recoverable", async ({ page }) => {
    // The 66-character Chinese name from the audit fixture was cut
    // mid-character at 497px with no "…" and no tooltip. The status bar it was
    // measured in is gone; the document tab does the same job in the same row,
    // and it is the place a name this long is most likely to be destroyed.
    await open(page, "C5");
    const tab = page.locator(".dx-tab-title[data-id=file-long-cn]");
    await expect(tab).toHaveCount(1);

    const measured = await tab.evaluate((node) => {
      const label = node.querySelector<HTMLElement>(".dx-ellipsis")!;
      const style = getComputedStyle(label);
      return {
        title: node.getAttribute("title"),
        text: label.textContent ?? "",
        textOverflow: style.textOverflow,
        overflow: style.overflow,
        whiteSpace: style.whiteSpace,
        scrollWidth: label.scrollWidth,
        clientWidth: label.clientWidth,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`W2F long-tab ${JSON.stringify(measured)}`);

    // It is genuinely too long for the tab, so the ellipsis is doing work…
    expect(measured.scrollWidth).toBeGreaterThan(measured.clientWidth);
    expect(measured.textOverflow).toBe("ellipsis");
    expect(measured.overflow).toBe("hidden");
    expect(measured.whiteSpace).toBe("nowrap");
    // …and the whole name is still recoverable without opening anything.
    expect(measured.title).toContain("现场执行三个分册");
    expect(measured.title).toContain(measured.text);
  });

  /* ------------------------------------------------------------- S8-011 */

  test("S8-011 Share reports what it did instead of swallowing it", async ({ page }) => {
    // The empty `catch` was written for "the user dismissed the native share
    // sheet" and went on to eat every other outcome, so pressing Share with a
    // file open produced nothing at all. r10 shares a local file as a copy and
    // never touches the clipboard — but the route still has an end that is not
    // built, and that end has to say so rather than go quiet.
    await open(page, "C5");
    await expect(page.locator("#dx-notice.dx-visible")).toHaveCount(0);

    await page.locator("[data-act=share]").click();
    const dialog = page.locator("dialog#dx-modal");
    await expect(dialog).toHaveAttribute("open", "");
    await expect(dialog.locator("[data-act=export]")).toBeVisible();

    await dialog.locator("[data-act=export]").click();
    // The dialog gets out of the way first: a notice drawn under a modal is the
    // same silence with extra steps.
    await expect(dialog).toHaveCount(0);
    const notice = page.locator("#dx-notice.dx-visible");
    await expect(notice).toHaveCount(1);
    const text = await notice.innerText();
    // eslint-disable-next-line no-console
    console.log(`W2F share-export ${JSON.stringify(text)}`);
    expect(text.trim().length).toBeGreaterThan(0);
    // And it says what is missing, not that sharing does not exist: the other
    // route out of the same dialog explains what a local file can be shared as.
    expect(text.toLowerCase()).not.toContain("open a local file first");
  });

  /* ------------------------------------------------------------- S1-013 */

  test("S1-013 the tab strip never starts on top of the global controls band", async ({ page }) => {
    // The window bar is gone, and with it the two rules that fought over its
    // width. What the deleted comment described is still real: the top-left band
    // — traffic lights, sidebar switch, Logo tab — is 244px and stays put whether
    // or not the sidebar is showing, so whatever is in the content region's own
    // top row has to start clear of it.
    for (const combination of COMBINATIONS) {
      await open(page, combination);
      const measured = await page.evaluate(() => {
        const controls = document.querySelector<HTMLElement>("#dx-global-controls")!;
        const band = controls.getBoundingClientRect();
        const top = document.querySelector<HTMLElement>("#dx-content > .dx-tabs-strip, #dx-content > .dx-home-top");
        const firstTab = document.querySelector<HTMLElement>(".dx-file-tab");
        return {
          bandWidth: Math.round(band.width),
          bandBottom: Math.round(band.bottom),
          controlsRight: Math.round(
            document.querySelector<HTMLElement>("#dx-global-controls [data-act=home]")!.getBoundingClientRect().right,
          ),
          // Closed, the content region is not laid out at all, so it has no row
          // to measure — which is the intent rather than a missing row.
          closed: document.querySelector("#dx-workspace")!.classList.contains("dx-workspace-closed"),
          topRowHeight: top ? Math.round(top.getBoundingClientRect().height) : null,
          firstTabLeft: firstTab ? Math.round(firstTab.getBoundingClientRect().left) : null,
          firstTabWidth: firstTab ? Math.round(firstTab.getBoundingClientRect().width) : null,
        };
      });
      // eslint-disable-next-line no-console
      console.log(`W2F band ${combination} ${JSON.stringify(measured)}`);

      // §03: 244 × 40, in every combination, sidebar or no sidebar.
      expect(measured.bandWidth, `${combination}: the band is not 244px`).toBe(244);
      expect(measured.bandBottom).toBe(TOP_ROW);
      if (measured.closed) {
        expect(measured.topRowHeight, `${combination}: a closed region still takes a row`).toBe(0);
        continue;
      }
      expect(measured.topRowHeight, `${combination}: the content region has no 40px top row`).toBe(TOP_ROW);
      if (measured.firstTabWidth) {
        expect(
          measured.firstTabLeft,
          `${combination}: the first tab starts at ${measured.firstTabLeft}, inside the ${measured.controlsRight}px band`,
        ).toBeGreaterThanOrEqual(measured.controlsRight);
      }
    }
  });

  /* --------------------------------------------------- S1-007, the small one */

  test("S1-007 the chrome acknowledges a press", async ({ page }) => {
    // Of the 90 `:active` rules in the loaded stylesheets, two came from
    // `src/shell` and neither was in the chrome: in one window the legacy
    // controls acknowledged a press and the new shell's did not. Measured here
    // rather than read out of the stylesheets, and measured against the *hover*
    // state, so a control whose only feedback is hover cannot pass.
    //
    // §r9: a compound click area has one state layer, so a press on a tab is
    // answered by the tab and not by the title button inside it.
    //
    // The page is reloaded for each control because the release completes a
    // click: pressing the sidebar switch and letting go hides the sidebar, and
    // the next control in the list is then not on screen to be pressed.
    const press = async (selector: string, layer: string) => {
      await open(page, "C5");
      const target = page.locator(selector).first();
      await target.hover();
      const box = (await target.boundingBox())!;
      const read = () =>
        page.locator(layer).first().evaluate((node) => getComputedStyle(node).backgroundColor);
      const hovered = await read();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const pressed = await read();
      await page.mouse.up();
      return { hovered, pressed };
    };

    const report: Record<string, { hovered: string; pressed: string }> = {};
    for (const [selector, layer] of [
      ["#dx-global-controls [data-act=toggle-sidebar]", "#dx-global-controls [data-act=toggle-sidebar]"],
      ["#dx-global-controls [data-act=home]", "#dx-global-controls [data-act=home]"],
      ["#dx-sidebar [data-act=local]", "#dx-sidebar [data-act=local]"],
      ["#dx-sidebar [data-act=open-chat]", "#dx-sidebar .dx-chat-tree"],
      [".dx-file-tab:not(.dx-active) .dx-tab-title", ".dx-file-tab:not(.dx-active)"],
      ["[data-act=share]", "[data-act=share]"],
      ["[data-act=save]", "[data-act=save]"],
    ] as const) {
      report[selector] = await press(selector, layer);
    }

    // eslint-disable-next-line no-console
    console.log("W2F press feedback:\n" + JSON.stringify(report, null, 2));
    const silent = Object.entries(report)
      .filter(([, states]) => states.hovered === states.pressed)
      .map(([selector]) => selector);
    expect(silent, "these controls look exactly the same pressed as hovered").toEqual([]);
  });
});

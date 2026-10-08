/**
 * W2-E — the file lists and the project tree, after the r10 rebuild.
 *
 * The four findings this file was written for were R5 (a list table with no
 * `table-layout`, so no column got the width it declared), R6 (a drop target on
 * the wrong node), R16 (an inline row action resolving against a 0×0 anchor
 * instead of its row) and the `nav.css` half of R8 (no `:focus-visible`
 * anywhere). Three of the four are about classes of defect that r10 can still
 * have, and they are asserted here against r10's own surfaces:
 *
 *   R5   Local's My Files table (`dx-local-page`) declares 64/12/18/6% and is
 *        `table-layout: fixed`; Home's Recent is the second list.
 *   R6   the only drag left in the shell is reordering document tabs, so the
 *        guarantee shrinks to "every draggable thing has somewhere to drop it".
 *   R16  the project row's and the conversation row's trailing ⋯ buttons.
 *   R8   the tree controls and the list rows.
 *
 * What is gone: the sidebar no longer holds files, so there is no file tree, no
 * "Show N more" pagination, no empty-folder line and no dragging a file into a
 * folder; and Home's list has no density switch and no time buckets. The ledger
 * in the session report says which tests went with them.
 *
 * There is no `test.skip` in this file, conditional or otherwise, and there is
 * not going to be one: `e2e/ui-audit-s4.spec.ts` is 30 cases that are all
 * `test.skip(!BRIDGE)`, which prints "30 skipped", exits 0, and was read as a
 * pass. Everything here runs against the fixture server, which always exists.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 \
 *   npx playwright test e2e/fix-w2e.spec.ts
 */

import { expect, test } from "@playwright/test";

import { DRAG_HARNESS, focusRing, open } from "./r10-b-helpers";

/** The column split Local's table declares, as `workspace-structure.css` states it. */
const LOCAL_COLUMNS = [
  { label: "Name", share: 0.64 },
  { label: "Size", share: 0.12 },
  { label: "Modified", share: 0.18 },
  { label: "actions", share: 0.06 },
];

/** The cell heights the two lists declare, from the same stylesheets. */
const ROW_HEIGHT = { local: 52, home: 48 };

test.describe("W2-E R5 — the file list tables", () => {
  test("Local gives every column the width it declares, and no header wraps", async ({ page }) => {
    await open(page, "C3");
    await expect(page.locator(".dx-local-page table")).toBeVisible();

    const measured = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>(".dx-local-page table");
      if (!table) return null;
      const headers = [...table.querySelectorAll("thead th")];
      const first = table.querySelector<HTMLTableRowElement>("tbody tr");
      const name = first?.querySelector<HTMLElement>(".dx-local-file-name .dx-ellipsis");
      return {
        tableLayout: getComputedStyle(table).tableLayout,
        tableWidth: table.getBoundingClientRect().width,
        headerWidths: headers.map((th) => th.getBoundingClientRect().width),
        // More than one client rect means the header broke over two lines.
        headerLineBoxes: headers.map((th) => th.getClientRects().length),
        nameTruncation: name
          ? {
              overflow: getComputedStyle(name).overflow,
              whiteSpace: getComputedStyle(name).whiteSpace,
              textOverflow: getComputedStyle(name).textOverflow,
            }
          : null,
      };
    });

    expect(measured, "no table on Local").not.toBeNull();
    const report = measured!;
    expect(report.tableLayout).toBe("fixed");
    expect(report.headerWidths).toHaveLength(4);

    LOCAL_COLUMNS.forEach((column, index) => {
      const share = report.headerWidths[index] / report.tableWidth;
      expect(
        share,
        `${column.label} is ${(share * 100).toFixed(1)}% of the table, declared ${column.share * 100}%`,
      ).toBeCloseTo(column.share, 2);
      expect(report.headerLineBoxes[index], `${column.label} broke over two lines`).toBe(1);
    });

    // The name is the only column whose content can be long, and it is the one
    // that has to give way rather than push the others out.
    expect(report.nameTruncation).toEqual({
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
    });
  });

  test("the long Chinese file name does not make its row five lines tall", async ({ page }) => {
    // The 201px row in S3-003 was one whose cell held the 100-character CJK
    // name and wrapped. Both lists carry that file, and both declare one line.
    for (const [combination, selector, declared] of [
      ["C3", ".dx-local-page table", ROW_HEIGHT.local],
      ["C1", ".dx-home-recent table", ROW_HEIGHT.home],
    ] as const) {
      await open(page, combination);
      await expect(page.locator(selector)).toBeVisible();

      const rows = await page.evaluate((target: string) => {
        const table = document.querySelector(target);
        if (!table) return null;
        const measured = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((row) => ({
          name: (row.querySelector(".dx-ellipsis")?.textContent ?? "").trim(),
          height: Math.round(row.getBoundingClientRect().height),
        }));
        return {
          tallest: Math.max(...measured.map((row) => row.height)),
          longNameRows: measured.filter((row) => row.name.length > 30),
        };
      }, selector);

      expect(rows, `${combination}: no rows`).not.toBeNull();
      expect(rows!.longNameRows.length, `${combination}: no long name in the list`).toBeGreaterThan(0);
      for (const row of rows!.longNameRows) {
        expect(row.height, `${combination}: long-name row is ${row.height}px, declared ${declared}px`).toBeLessThanOrEqual(declared + 2);
      }
      expect(rows!.tallest).toBeLessThanOrEqual(declared + 2);
    }
  });

  test("neither list makes its page scroll sideways at 1024", async ({ page }) => {
    // S3 measured a table 277px wider than its container, which turned into a
    // horizontal scrollbar on the whole page. A table wider than the space it
    // has is allowed now — `.dx-table-wrap` scrolls — but the page is not.
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const [combination, selector] of [
      ["C3", ".dx-local-page table"],
      ["C1", ".dx-home-recent table"],
    ] as const) {
      await open(page, combination);
      await expect(page.locator(selector)).toBeVisible();

      const fit = await page.evaluate((target: string) => {
        const table = document.querySelector<HTMLTableElement>(target);
        const wrap = table?.closest<HTMLElement>(".dx-table-wrap");
        const scroller = document.querySelector<HTMLElement>(".dx-page-scroll");
        if (!table || !wrap || !scroller) return null;
        return {
          wrapOverflowX: getComputedStyle(wrap).overflowX,
          tableScrollWidth: table.scrollWidth,
          wrapClientWidth: wrap.clientWidth,
          pageScrollWidth: scroller.scrollWidth,
          pageClientWidth: scroller.clientWidth,
          // Whatever the table does, it must not stick out of the region.
          overhang: Math.round(table.getBoundingClientRect().right - wrap.getBoundingClientRect().right),
        };
      }, selector);

      expect(fit, `${combination}: no table at 1024`).not.toBeNull();
      expect(fit!.overhang).toBeLessThanOrEqual(1);
      if (fit!.tableScrollWidth > fit!.wrapClientWidth + 1) {
        expect(fit!.wrapOverflowX, `${combination}: the table overflows and its wrapper does not scroll`).toBe("auto");
      }
      expect(fit!.pageScrollWidth).toBeLessThanOrEqual(fit!.pageClientWidth + 1);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});

test.describe("W2-E R6 — the one drag that is left", () => {
  test("every draggable tab has somewhere to drop it, and the drop reorders", async ({ page }) => {
    // R6's guarantee was that a surface does not advertise a drag it cannot
    // accept. Files no longer move between folders by dragging; the tabs do
    // move, so the same rule applies to them — and to all of them, not to the
    // first one somebody tried.
    await open(page, "C5");
    await page.addScriptTag({ content: DRAG_HARNESS });

    const tabs = await page.locator(".dx-file-tab").evaluateAll((nodes) =>
      nodes.map((node) => ({ id: node.getAttribute("data-tab"), draggable: (node as HTMLElement).draggable })),
    );
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) expect(tab.draggable, `${tab.id} is not draggable`).toBe(true);

    const before = tabs.map((tab) => tab.id);
    const started = await page.evaluate(() => window.__r10drag.start(".dx-file-tab:first-child"));
    expect(started.ok).toBe(true);
    // It carries the file it is a tab for, not an empty string: a drag whose
    // payload is blank reorders nothing however well the drop target behaves.
    expect(started.payload).toBe(before[0]);

    // Every other tab has to accept it, not just the neighbour.
    for (let index = 2; index <= tabs.length; index += 1) {
      const hovered = await page.evaluate(
        (nth: number) => window.__r10drag.over(`.dx-file-tab:nth-child(${nth})`),
        index,
      );
      expect(hovered.defaultPrevented, `tab ${index} refuses the drop`).toBe(true);
    }

    const dropped = await page.evaluate(() => window.__r10drag.drop(".dx-file-tab:nth-child(3)"));
    expect(dropped.ok).toBe(true);
    const after = await page.locator(".dx-file-tab").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tab")),
    );
    expect(after, "the drop landed and the strip did not reorder").not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
  });
});

test.describe("W2-E R16 — the inline row actions", () => {
  test("the project row's ⋯ button stays inside its own row and off the name", async ({ page }) => {
    await open(page, "C1");

    const row = page.locator("#dx-sidebar .dx-project-row").first();
    await row.hover();
    await expect(row.locator("[data-act=project-menu]")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rowNode = document.querySelector<HTMLElement>("#dx-sidebar .dx-project-row");
      const more = rowNode?.querySelector<HTMLElement>("[data-act=project-menu]");
      const label = rowNode?.querySelector<HTMLElement>("[data-act=toggle-project] .dx-ellipsis");
      if (!rowNode || !more || !label) return null;
      const rowBox = rowNode.getBoundingClientRect();
      const moreBox = more.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      // One pixel inside the button's own bottom edge: the strip that used to
      // hang over the row below and hand its clicks to the next row's control.
      const probe = document.elementFromPoint(moreBox.left + moreBox.width / 2, moreBox.bottom - 1);
      return {
        overflowTop: Math.round(rowBox.top - moreBox.top),
        overflowBottom: Math.round(moreBox.bottom - rowBox.bottom),
        horizontalOverlap: Math.round(labelBox.right - moreBox.left),
        atBottomEdge: probe ? probe.closest("[data-act]")?.getAttribute("data-act") ?? null : null,
      };
    });

    expect(geometry).not.toBeNull();
    const box = geometry!;
    expect(box.overflowTop, "the ⋯ button hangs above its row").toBeLessThanOrEqual(0);
    expect(box.overflowBottom, "the ⋯ button hangs below its row").toBeLessThanOrEqual(0);
    expect(box.atBottomEdge, "the button's own bottom edge belongs to something else").toBe("project-menu");
    expect(box.horizontalOverlap, "the ⋯ button still covers the project name").toBeLessThanOrEqual(0);
  });

  test("the conversation row's ⋯ button stays inside its own row too", async ({ page }) => {
    await open(page, "C1");

    const row = page.locator("#dx-sidebar .dx-chat-tree").first();
    await expect(row).toBeAttached();
    await row.hover();
    await expect(row.locator("[data-act=chat-menu]")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rowNode = document.querySelector<HTMLElement>("#dx-sidebar .dx-chat-tree");
      const more = rowNode?.querySelector<HTMLElement>("[data-act=chat-menu]");
      const label = rowNode?.querySelector<HTMLElement>("[data-act=open-chat] .dx-ellipsis");
      if (!rowNode || !more || !label) return null;
      const rowBox = rowNode.getBoundingClientRect();
      const moreBox = more.getBoundingClientRect();
      const probe = document.elementFromPoint(moreBox.left + moreBox.width / 2, moreBox.bottom - 1);
      return {
        overflowTop: Math.round(rowBox.top - moreBox.top),
        overflowBottom: Math.round(moreBox.bottom - rowBox.bottom),
        horizontalOverlap: Math.round(label.getBoundingClientRect().right - moreBox.left),
        atBottomEdge: probe ? probe.closest("[data-act]")?.getAttribute("data-act") ?? null : null,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.overflowTop).toBeLessThanOrEqual(0);
    expect(geometry!.overflowBottom).toBeLessThanOrEqual(0);
    expect(geometry!.atBottomEdge).toBe("chat-menu");
    expect(geometry!.horizontalOverlap).toBeLessThanOrEqual(0);
  });
});

test.describe("W2-E R8 — focus is visible in the tree and the lists", () => {
  test("every control in the project tree draws a focus ring", async ({ page }) => {
    await open(page, "C1");

    const report: Record<string, unknown> = {};
    for (const selector of [
      "#dx-sidebar [data-act=new-file]",
      "#dx-sidebar [data-act=local]",
      "#dx-sidebar [data-act=project-library]",
      "#dx-sidebar [data-act=new-project]",
      "#dx-sidebar [data-act=toggle-project]",
      "#dx-sidebar [data-act=project-menu]",
      "#dx-sidebar [data-act=open-chat]",
      "#dx-sidebar [data-act=chat-menu]",
      "#dx-sidebar [data-act=settings]",
    ]) {
      const ring = await focusRing(page, selector);
      report[selector] = ring;
      expect(ring, `${selector} is not in the DOM`).not.toBeNull();
      expect(ring!.focused).toBe(true);
      expect(ring!.outlineStyle, `${selector} draws nothing on focus`).not.toBe("none");
    }

    // eslint-disable-next-line no-console
    console.log("W2E tree focus rings:\n" + JSON.stringify(report, null, 2));
  });

  test("a tab's close button becomes visible as well as ringed when focus reaches it", async ({ page }) => {
    // The other half of S3-012: a ring around an invisible control is half an
    // answer. The close button is `opacity: 0` at rest and is revealed by the
    // tab's `:focus-within`, which is the state a keyboard user is actually in.
    await open(page, "C5");
    // A tab that is *not* the current one: the current tab shows its close
    // button at rest by design, so it cannot show whether focus reveals one.
    const tab = ".dx-file-tab:not(.dx-active)";
    await expect(page.locator(`${tab} [data-act=close-file]`).first()).toBeAttached();

    const atRest = await page.evaluate(
      (selector: string) => getComputedStyle(document.querySelector(selector)!).opacity,
      `${tab} [data-act=close-file]`,
    );
    expect(atRest, "the close button is already visible, so focus cannot reveal it").toBe("0");

    // Reached the way a keyboard reaches it: focus the tab's title, then Tab.
    await page.locator(`${tab} .dx-tab-title`).first().focus();
    await page.keyboard.press("Tab");

    const focused = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return null;
      let ringOn: string | null = null;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).outlineStyle !== "none") {
          ringOn = node.className;
          break;
        }
        if (node.id === "dx-workspace") break;
      }
      return { act: element.getAttribute("data-act"), opacity: getComputedStyle(element).opacity, ringOn };
    });

    // eslint-disable-next-line no-console
    console.log("W2E tab close focus:\n" + JSON.stringify({ atRest, focused }, null, 2));
    expect(focused).not.toBeNull();
    expect(focused!.act, "Tab from the tab title did not land on its close button").toBe("close-file");
    expect(focused!.opacity, "the focused close button is still invisible").not.toBe("0");
    expect(focused!.ringOn, "nothing draws a ring for the focused close button").not.toBeNull();
  });

  test("a file row in each list draws a focus ring", async ({ page }) => {
    for (const [combination, selector] of [
      ["C3", ".dx-local-open-row"],
      ["C1", ".dx-home-recent .dx-open-row"],
    ] as const) {
      await open(page, combination);
      const ring = await focusRing(page, selector);
      expect(ring, `${combination}: ${selector} is not in the DOM`).not.toBeNull();
      expect(ring!.focused).toBe(true);
      expect(ring!.outlineStyle, `${combination}: the row draws nothing on focus`).not.toBe("none");
    }
  });
});

test.describe("W2-E odds and ends", () => {
  test("a project's accessible name is its name, with nothing glued on to it", async ({ page }) => {
    // The defect was an `aria-label` that ran the folder's name straight into
    // its file count — "MO product launch3 files" to a screen reader. r10 has no
    // counts, so the name must be the name, and the disclosure state must be an
    // attribute rather than more words.
    await open(page, "C1");
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#dx-sidebar [role=treeitem][data-project]")].map((item) => ({
        ariaLabel: item.getAttribute("aria-label"),
        ariaExpanded: item.getAttribute("aria-expanded"),
        toggleLabel: (item.querySelector("[data-act=toggle-project] .dx-ellipsis")?.textContent ?? "").trim(),
        toggleExpanded: item.querySelector("[data-act=toggle-project]")?.getAttribute("aria-expanded"),
      })),
    );

    // eslint-disable-next-line no-console
    console.log("W2E project names:\n" + JSON.stringify(rows, null, 2));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.ariaLabel, "no accessible name at all").toBeTruthy();
      // The visible name and the accessible name are the same string; nothing
      // numeric has been appended to either.
      expect(row.ariaLabel).toBe(row.toggleLabel);
      expect(row.ariaLabel).not.toMatch(/\d+\s*(files?|conversations?)$/);
      expect(row.ariaExpanded).toMatch(/^(true|false)$/);
      expect(row.toggleExpanded).toBe(row.ariaExpanded);
    }
  });
});

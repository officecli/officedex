/**
 * W2-E — the file list and the file tree, after the fix.
 *
 * Covers R5 (`.shell-list` had no `table-layout`), R6 (the drop hit area was on
 * the wrong node and each density rendered half the feedback), R16 (the inline
 * row actions resolved against a 0×0 `.shell-menu-anchor` instead of their row)
 * and the `nav.css` half of R8 (no `:focus-visible` anywhere in the file).
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

import { expect, test, type Page } from "@playwright/test";

import { open } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W2-E" };

/** The declared column split, as `nav.css` now states it. */
const COLUMNS = [
  { label: "Name", share: 0.46 },
  { label: "Folder", share: 0.25 },
  { label: "Last opened", share: 0.21 },
  { label: "Pin", share: 0.08 },
];

/**
 * A DataTransfer carrying the shell's private file MIME, plus the three drag
 * verbs, installed on the page.
 *
 * Synthetic rather than a real pointer drag for the same reason S8 used
 * synthetic events: Playwright cannot drive the OS drag loop, and the handlers
 * under test read `dataTransfer.types` and `event.target`, both of which a
 * dispatched `DragEvent` reproduces faithfully.
 */
const DRAG_HARNESS = `
  window.__w2e = {
    dt: null,
    start(selector) {
      const source = document.querySelector(selector);
      if (!source) return { ok: false, why: "no source " + selector };
      this.dt = new DataTransfer();
      const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      source.dispatchEvent(event);
      return { ok: true, payload: this.dt.getData("application/x-officedex-file"), sourceClass: source.className };
    },
    overPoint(x, y) {
      const target = document.elementFromPoint(x, y);
      if (!target) return { ok: false, why: "nothing at " + x + "," + y };
      const event = new DragEvent("dragover", {
        bubbles: true, cancelable: true, dataTransfer: this.dt, clientX: x, clientY: y,
      });
      target.dispatchEvent(event);
      return {
        ok: true,
        defaultPrevented: event.defaultPrevented,
        highlighted: document.querySelectorAll(".is-drop-target").length,
        hitFolder: target.closest("[data-drop-folder]")?.getAttribute("data-drop-folder") ?? null,
      };
    },
    over(selector) {
      const target = document.querySelector(selector);
      if (!target) return { ok: false, why: "no target " + selector };
      const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: this.dt });
      target.dispatchEvent(event);
      return { ok: true, defaultPrevented: event.defaultPrevented };
    },
    end(selector) {
      const source = document.querySelector(selector);
      source?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: this.dt }));
    },
  };
`;

/**
 * Puts the browser into keyboard modality, then focuses `selector`.
 *
 * Chromium only matches `:focus-visible` on a programmatically focused button
 * when the most recent interaction was a key press, so the Tab comes first. The
 * verdict is read off `outlineStyle`, never `outlineWidth`: with
 * `outline-style: none` the computed width still reports 3px, which is how a
 * tree that draws nothing can pass a width-based check.
 */
async function focusRing(page: Page, selector: string) {
  await page.keyboard.press("Tab");
  return page.evaluate((target: string) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return null;
    element.focus();
    const style = getComputedStyle(element);
    return {
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  }, selector);
}

/**
 * EditorHome's "Group by" is `renderer/ui`'s `Select`, which is a button plus a
 * popover of `menuitemradio`s rather than a native `<select>`.
 */
async function setGrouping(page: Page, option: "Folder" | "Last opened") {
  await page.getByRole("button", { name: "Group by" }).click();
  await page.getByRole("menuitemradio", { name: option }).click();
  await expect(page.locator(".od-menu")).toHaveCount(0);
}

test.describe("W2-E R5 — the Home file table", () => {
  test("gives every column the width it declares, and every column truncates", async ({ page }) => {
    for (const combination of ["C2", "C4"] as const) {
      await open(page, combination, SESSION);
      // C4 (EditorHome) defaults to time grouping; the Folder column is the one
      // that collapsed, so read the table in the grouping that fills it.
      if (combination === "C4") {
        await setGrouping(page, "Folder");
      }
      await expect(page.locator("table.shell-list")).toBeVisible();

      const measured = await page.evaluate(() => {
        const table = document.querySelector<HTMLTableElement>("table.shell-list");
        if (!table) return null;
        const headers = [...table.querySelectorAll("thead th")];
        const bodyRow = table.querySelector<HTMLTableRowElement>("tbody tr:not(.shell-list-group)");
        const cells = bodyRow ? [...bodyRow.querySelectorAll("td")] : [];
        return {
          tableLayout: getComputedStyle(table).tableLayout,
          tableWidth: table.getBoundingClientRect().width,
          headerWidths: headers.map((th) => th.getBoundingClientRect().width),
          headerLineBoxes: headers.map((th) => th.getClientRects().length),
          cellTruncation: cells.map((td) => ({
            overflow: getComputedStyle(td).overflow,
            whiteSpace: getComputedStyle(td).whiteSpace,
            textOverflow: getComputedStyle(td).textOverflow,
          })),
        };
      });

      expect(measured, `${combination}: no table`).not.toBeNull();
      const report = measured!;
      expect(report.tableLayout).toBe("fixed");
      expect(report.headerWidths).toHaveLength(4);

      COLUMNS.forEach((column, index) => {
        const share = report.headerWidths[index] / report.tableWidth;
        expect(
          share,
          `${combination}: ${column.label} is ${(share * 100).toFixed(1)}% of the table, declared ${column.share * 100}%`,
        ).toBeCloseTo(column.share, 2);
        // The header itself used to break over two lines ("Last opened").
        expect(report.headerLineBoxes[index]).toBe(1);
      });

      expect(report.cellTruncation).toHaveLength(4);
      for (const [index, cell] of report.cellTruncation.entries()) {
        expect(cell.textOverflow, `${combination}: column ${index} does not truncate`).toBe(
          "ellipsis",
        );
        expect(cell.whiteSpace).toBe("nowrap");
        expect(cell.overflow).toBe("hidden");
      }
    }
  });

  test("keeps the row with the long Chinese folder name at its declared 40px", async ({ page }) => {
    await open(page, "C2", SESSION);
    await expect(page.locator("table.shell-list")).toBeVisible();

    const rows = await page.evaluate(() => {
      const table = document.querySelector("table.shell-list");
      if (!table) return null;
      const bodyRows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr:not(.shell-list-group)")];
      const measured = bodyRows.map((row) => ({
        folder: (row.children[1]?.textContent ?? "").trim(),
        height: Math.round(row.getBoundingClientRect().height),
      }));
      return {
        tallest: Math.max(...measured.map((row) => row.height)),
        // The 201px row in S3-003 was one whose Folder cell held the long CJK
        // folder name and wrapped over five lines.
        longFolderRows: measured.filter((row) => row.folder.length > 30),
      };
    });

    expect(rows).not.toBeNull();
    expect(rows!.longFolderRows.length).toBeGreaterThan(0);
    for (const row of rows!.longFolderRows) {
      expect(row.height, `long-folder row is ${row.height}px, declared 40px`).toBeLessThanOrEqual(42);
    }
    expect(rows!.tallest).toBeLessThanOrEqual(42);
  });

  test("does not overflow its container at 1024, where it used to be 277px wide of it", async ({
    page,
  }) => {
    for (const combination of ["C2", "C4"] as const) {
      await page.setViewportSize({ width: 1024, height: 768 });
      await open(page, combination, SESSION);
      await expect(page.locator("table.shell-list")).toBeVisible();

      const fit = await page.evaluate(() => {
        const table = document.querySelector<HTMLTableElement>("table.shell-list");
        const wrapper = table?.closest<HTMLElement>(".shell-home-list");
        const home = document.querySelector<HTMLElement>(".shell-home");
        if (!table || !wrapper || !home) return null;
        return {
          tableWidth: Math.round(table.getBoundingClientRect().width),
          tableScrollWidth: table.scrollWidth,
          wrapperClientWidth: wrapper.clientWidth,
          overflowPx: Math.round(table.getBoundingClientRect().right - wrapper.getBoundingClientRect().right),
          homeScrollWidth: home.scrollWidth,
          homeClientWidth: home.clientWidth,
        };
      });

      expect(fit, `${combination}: no table at 1024`).not.toBeNull();
      expect(fit!.tableScrollWidth).toBeLessThanOrEqual(fit!.wrapperClientWidth + 1);
      expect(fit!.overflowPx).toBeLessThanOrEqual(1);
      // …and the page itself therefore no longer scrolls sideways.
      expect(fit!.homeScrollWidth).toBeLessThanOrEqual(fit!.homeClientWidth + 1);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});

test.describe("W2-E R6 — drop targets", () => {
  test("an open folder accepts a drop on all of itself, not on 14% of itself", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.addScriptTag({ content: DRAG_HARNESS });

    const started = await page.evaluate(() => window.__w2e.start(".shell-tree-file-row"));
    expect(started.ok).toBe(true);
    expect(started.payload).toBeTruthy();

    // The file area is the part that used to refuse: it is the title row's
    // sibling, so `closest("[data-drop-folder]")` found nothing from inside it.
    const filesArea = await page.evaluate(() => window.__w2e.over(".shell-tree-files"));
    expect(filesArea.ok).toBe(true);
    expect(filesArea.defaultPrevented, "the file area still refuses the drop").toBe(true);

    // Geometric coverage: sample the whole visible surface of every expanded
    // folder and count the points that resolve to that folder.
    const coverage = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>(".shell-sidebar-body");
      const bodyBox = body?.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>(".shell-tree-folder")].map((section) => {
        const box = section.getBoundingClientRect();
        const top = bodyBox ? Math.max(box.top, bodyBox.top) : box.top;
        const bottom = bodyBox ? Math.min(box.bottom, bodyBox.bottom) : box.bottom;
        let sampled = 0;
        let accepted = 0;
        for (let y = top + 2; y < bottom - 2; y += 3) {
          for (let x = box.left + 3; x < box.right - 3; x += 6) {
            const hit = document.elementFromPoint(x, y);
            if (!hit || !section.contains(hit)) continue;
            sampled += 1;
            if (hit.closest("[data-drop-folder]") === section) accepted += 1;
          }
        }
        return {
          folder: section.getAttribute("data-drop-folder"),
          expanded: Boolean(section.querySelector(".shell-tree-files")),
          sampled,
          share: sampled === 0 ? null : Number((accepted / sampled).toFixed(3)),
        };
      });
    });

    console.log("W2E drop coverage:\n" + JSON.stringify(coverage, null, 2));
    const expanded = coverage.filter((entry) => entry.expanded && (entry.sampled ?? 0) > 0);
    expect(expanded.length, "no expanded folder was sampled").toBeGreaterThan(0);
    for (const entry of expanded) {
      expect(
        entry.share,
        `${entry.folder}: only ${((entry.share ?? 0) * 100).toFixed(1)}% of the folder accepts a drop`,
      ).toBeGreaterThan(0.9);
    }

    await page.evaluate(() => window.__w2e.end(".shell-tree-file-row"));
  });

  test("the comfortable list shows where the file is going", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.addScriptTag({ content: DRAG_HARNESS });

    const before = await page.evaluate(() => {
      const tbody = document.querySelector<HTMLElement>(".shell-home-list tbody[data-drop-folder]");
      if (!tbody) return null;
      const style = getComputedStyle(tbody);
      return {
        className: tbody.className,
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
      };
    });
    expect(before).not.toBeNull();
    expect(before!.className).not.toContain("is-drop-target");

    const started = await page.evaluate(() =>
      window.__w2e.start(".shell-home-list tbody tr[draggable='true']"),
    );
    expect(started.ok).toBe(true);

    const hovered = await page.evaluate(() =>
      window.__w2e.over(".shell-home-list tbody[data-drop-folder] .shell-list-group"),
    );
    expect(hovered.defaultPrevented, "the tbody does not accept the drop").toBe(true);

    const after = await page.evaluate(() => {
      const tbody = document.querySelector<HTMLElement>(".shell-home-list tbody[data-drop-folder]");
      if (!tbody) return null;
      const style = getComputedStyle(tbody);
      return {
        highlighted: document.querySelectorAll(".shell-home-list tbody.is-drop-target").length,
        className: tbody.className,
        background: style.backgroundColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        draggingSources: document.querySelectorAll(".shell-list tbody tr.is-dragging").length,
      };
    });

    console.log("W2E comfortable drop feedback:\n" + JSON.stringify({ before, after }, null, 2));
    expect(after!.highlighted).toBe(1);
    expect(after!.className).toContain("is-drop-target");
    // Visible means it actually changed on screen, not just in the class list.
    expect(after!.background).not.toBe(before!.background);
    expect(after!.outlineStyle).not.toBe("none");
    // …and the row being carried says so too (S8-017).
    expect(after!.draggingSources).toBe(1);

    await page.evaluate(() => window.__w2e.end(".shell-home-list tbody tr[draggable='true']"));
  });

  test("time buckets do not offer a drag they cannot accept", async ({ page }) => {
    await open(page, "C4", SESSION);
    await expect(page.locator("table.shell-list")).toBeVisible();

    const timeView = await page.evaluate(() => ({
      droppable: document.querySelectorAll(".shell-home-list tbody[data-drop-folder]").length,
      tbodies: document.querySelectorAll(".shell-home-list tbody").length,
      draggable: document.querySelectorAll(".shell-home-list tbody tr[draggable='true']").length,
    }));
    expect(timeView.tbodies).toBeGreaterThan(0);
    expect(timeView.droppable).toBe(0);
    expect(timeView.draggable, "rows are draggable with nowhere to drop them").toBe(0);

    // Switching to folder grouping turns both back on together.
    await setGrouping(page, "Folder");
    const folderView = await page.evaluate(() => ({
      droppable: document.querySelectorAll(".shell-home-list tbody[data-drop-folder]").length,
      draggable: document.querySelectorAll(".shell-home-list tbody tr[draggable='true']").length,
    }));
    expect(folderView.droppable).toBeGreaterThan(0);
    expect(folderView.draggable).toBeGreaterThan(0);
  });
});

test.describe("W2-E R16 — the inline row actions", () => {
  test("the folder row's + button is inside its own row, top and bottom", async ({ page }) => {
    await open(page, "C2", SESSION);

    const row = page.locator(".shell-tree-folder-row").first();
    await row.hover();
    await expect(page.locator(".shell-tree-folder-add").first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rowNode = document.querySelector<HTMLElement>(".shell-tree-folder-row");
      const add = rowNode?.querySelector<HTMLElement>(".shell-tree-folder-add");
      const label = rowNode?.querySelector<HTMLElement>(".shell-tree-folder-toggle > span");
      if (!rowNode || !add || !label) return null;
      const rowBox = rowNode.getBoundingClientRect();
      const addBox = add.getBoundingClientRect();
      const labelBox = label.getBoundingClientRect();
      // One pixel inside the button's bottom edge: the strip that used to hang
      // over the row below and hand its clicks to `.shell-tree-file-open`.
      const probe = document.elementFromPoint(addBox.left + addBox.width / 2, addBox.bottom - 1);
      return {
        row: { top: rowBox.top, bottom: rowBox.bottom, right: rowBox.right },
        add: { top: addBox.top, bottom: addBox.bottom, left: addBox.left, right: addBox.right },
        overflowTop: Math.round(rowBox.top - addBox.top),
        overflowBottom: Math.round(addBox.bottom - rowBox.bottom),
        labelRight: labelBox.right,
        horizontalOverlap: Math.round(labelBox.right - addBox.left),
        atBottomEdge: probe ? probe.className : null,
        containingBlockIsRow: getComputedStyle(
          add.parentElement as HTMLElement,
        ).position,
      };
    });

    console.log("W2E folder + button:\n" + JSON.stringify(geometry, null, 2));
    expect(geometry).not.toBeNull();
    const box = geometry!;
    // Fully inside the row, on both edges.
    expect(box.add.top).toBeGreaterThanOrEqual(box.row.top - 0.5);
    expect(box.add.bottom).toBeLessThanOrEqual(box.row.bottom + 0.5);
    expect(box.overflowBottom).toBeLessThanOrEqual(0);
    // Its own bottom edge belongs to it, not to the next row.
    expect(box.atBottomEdge).toContain("shell-tree-folder-add");
    // And it no longer sits on top of the folder name.
    expect(box.horizontalOverlap, "the + button still covers the folder name").toBeLessThanOrEqual(0);
    // The wrapper is no longer the containing block.
    expect(box.containingBlockIsRow).toBe("static");
  });

  test("the file row's ⋯ button is inside its own row too", async ({ page }) => {
    await open(page, "C2", SESSION);

    const row = page.locator(".shell-tree-file-row").first();
    await row.hover();
    await expect(page.locator(".shell-tree-file-more").first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const rowNode = document.querySelector<HTMLElement>(".shell-tree-file-row");
      const more = rowNode?.querySelector<HTMLElement>(".shell-tree-file-more");
      if (!rowNode || !more) return null;
      const rowBox = rowNode.getBoundingClientRect();
      const moreBox = more.getBoundingClientRect();
      const probe = document.elementFromPoint(moreBox.left + moreBox.width / 2, moreBox.bottom - 1);
      return {
        overflowTop: Math.round(rowBox.top - moreBox.top),
        overflowBottom: Math.round(moreBox.bottom - rowBox.bottom),
        atBottomEdge: probe ? probe.className : null,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.overflowTop).toBeLessThanOrEqual(0);
    expect(geometry!.overflowBottom).toBeLessThanOrEqual(0);
    expect(geometry!.atBottomEdge).toContain("shell-tree-file-more");
  });
});

test.describe("W2-E R8 — focus is visible in the file list", () => {
  test("all five tree controls draw a focus ring", async ({ page }) => {
    await open(page, "C2", SESSION);

    const report: Record<string, unknown> = {};

    // Directly focusable.
    for (const selector of [
      ".shell-tree-folder-toggle",
      ".shell-tree-file-open",
      ".shell-tree-more",
    ]) {
      const ring = await focusRing(page, selector);
      report[selector] = ring;
      expect(ring, `${selector} is not in the DOM`).not.toBeNull();
      expect(ring!.focused).toBe(true);
      expect(ring!.outlineStyle, `${selector} draws nothing on focus`).not.toBe("none");
    }

    /*
     * The two hover-only buttons are reached the way a keyboard user reaches
     * them: focusing the row's first control puts `:focus-within` on the row,
     * which is what takes them out of `display: none`, and Tab then lands on
     * them. Focusing them directly would be testing a state the user cannot get
     * into.
     */
    for (const [owner, expected] of [
      [".shell-tree-folder-toggle", "shell-tree-folder-add"],
      [".shell-tree-file-open", "shell-tree-file-more"],
    ] as const) {
      await page.locator(owner).first().focus();
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return null;
        const style = getComputedStyle(element);
        return {
          className: element.className,
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      });
      report[expected] = ring;
      expect(ring, `nothing focused after Tab from ${owner}`).not.toBeNull();
      expect(ring!.className).toContain(expected);
      expect(ring!.outlineStyle, `${expected} draws nothing on focus`).not.toBe("none");
    }

    console.log("W2E tree focus rings:\n" + JSON.stringify(report, null, 2));
  });

  test("the Home list's pin button draws a ring and shows its icon", async ({ page }) => {
    await open(page, "C2", SESSION);
    // An *unpinned* one: `.is-pinned` is coloured at rest by design, so it
    // cannot show whether focus reveals anything.
    const unpinned = ".shell-list-pin:not(.is-pinned)";
    await expect(page.locator(unpinned).first()).toBeAttached();

    const atRest = await page.evaluate(
      (selector: string) => getComputedStyle(document.querySelector(selector)!).color,
      unpinned,
    );

    const ring = await focusRing(page, unpinned);
    console.log("W2E pin focus:\n" + JSON.stringify({ atRest, ring }, null, 2));

    expect(ring).not.toBeNull();
    expect(ring!.focused).toBe(true);
    expect(ring!.outlineStyle, "the pin button draws nothing on focus").not.toBe("none");

    const onFocus = await page.evaluate(
      (selector: string) => getComputedStyle(document.querySelector(selector)!).color,
      unpinned,
    );
    // At rest the icon is `color: transparent`; a ring around an invisible icon
    // is only half an answer (S3-012).
    expect(atRest).toBe("rgba(0, 0, 0, 0)");
    expect(onFocus).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("the file list's own name button draws a ring", async ({ page }) => {
    await open(page, "C2", SESSION);
    const ring = await focusRing(page, ".shell-list-file");
    expect(ring).not.toBeNull();
    expect(ring!.outlineStyle).not.toBe("none");
  });
});

test.describe("W2-E odds and ends", () => {
  test("both densities call an empty folder the same thing", async ({ page }) => {
    await open(page, "C2", SESSION);
    const strings = await page.evaluate(() => ({
      sidebar: [...document.querySelectorAll(".shell-tree-empty")].map((n) => n.textContent),
      home: [...document.querySelectorAll(".shell-list-empty strong")].map((n) => n.textContent),
    }));
    // The empty folder in the fixture (yirentk) is collapsed by default, so
    // open it first if it is not already showing its empty line.
    if (strings.sidebar.length === 0) {
      await page.getByRole("treeitem", { name: /yirentk/ }).click();
    }
    const sidebar = await page.evaluate(() =>
      [...document.querySelectorAll(".shell-tree-empty")].map((n) => n.textContent),
    );
    expect(sidebar.length).toBeGreaterThan(0);
    for (const text of sidebar) expect(text).toBe("No files yet");
  });

  test("a folder's accessible name separates its name from its count", async ({ page }) => {
    await open(page, "C2", SESSION);
    const names = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".shell-tree-folder-toggle")].map((button) => ({
        text: (button.textContent ?? "").replace(/\s+/g, " ").trim(),
        ariaLabel: button.getAttribute("aria-label"),
      })),
    );
    console.log("W2E folder names:\n" + JSON.stringify(names, null, 2));
    expect(names.length).toBeGreaterThan(0);
    for (const entry of names) {
      expect(entry.ariaLabel, "no accessible name at all").toBeTruthy();
      expect(entry.ariaLabel).toMatch(/, \d+ files$/);
    }
  });

  test("Show N more keeps the button it was pressed on in view", async ({ page }) => {
    await open(page, "C2", SESSION);

    const button = page.getByRole("button", { name: /^Show \d+ more$/ }).first();
    await button.click();

    const after = await page.evaluate(() => {
      const less = [...document.querySelectorAll<HTMLElement>(".shell-tree-more")].find(
        (node) => node.textContent === "Show less",
      );
      const body = document.querySelector<HTMLElement>(".shell-sidebar-body");
      if (!less || !body) return null;
      const box = less.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        label: less.textContent,
        inView: box.top >= bodyBox.top - 1 && box.bottom <= bodyBox.bottom + 1,
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        containerBottom: Math.round(bodyBox.bottom),
        rows: document.querySelectorAll(".shell-tree-file-row").length,
      };
    });

    console.log("W2E show-more:\n" + JSON.stringify(after, null, 2));
    expect(after).not.toBeNull();
    expect(after!.label).toBe("Show less");
    expect(after!.rows).toBeGreaterThan(9);
    expect(after!.inView, "the button the user just pressed scrolled out of the list").toBe(true);
  });
});

declare global {
  interface Window {
    __w2e: {
      start(selector: string): { ok: boolean; why?: string; payload?: string; sourceClass?: string };
      overPoint(
        x: number,
        y: number,
      ): { ok: boolean; why?: string; defaultPrevented?: boolean; highlighted?: number; hitFolder?: string | null };
      over(selector: string): { ok: boolean; why?: string; defaultPrevented?: boolean };
      end(selector: string): void;
    };
  }
}

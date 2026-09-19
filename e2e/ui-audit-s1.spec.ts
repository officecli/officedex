/**
 * S1 — window chrome & navigation (docs/ui-audit-2026-09-19/PLAN.md, section 3).
 *
 * Surfaces: WindowBar, FileTabs, Sidebar, StatusBar, FileTree(compact).
 * Must pass all ten shell combinations; the sidebar is where the mode fork is
 * densest, so every measurement is taken per combination rather than once.
 *
 * Read-only: this spec measures and screenshots, it never asserts a fix.
 * Numbers land in docs/ui-audit-2026-09-19/S1/measurements.json so every
 * finding in findings.md can cite a rect somebody else can re-check.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 \
 *   OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s1 \
 *   npx playwright test e2e/ui-audit-s1.spec.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { COMBINATIONS, capture, open, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "S1" };
const OUT = "docs/ui-audit-2026-09-19/S1";

const record: Record<string, unknown> = {};

/**
 * Merges into the file on disk rather than replacing it.
 *
 * Running a single test with `-g` would otherwise publish a measurements.json
 * containing only that test's keys, and the findings that cite the others would
 * point at numbers nobody can re-check.
 */
function save(key: string, value: unknown): void {
  record[key] = value;
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/measurements.json`;
  const existing: Record<string, unknown> = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {};
  writeFileSync(path, JSON.stringify({ ...existing, ...record }, null, 2));
}

/** rect + a handful of computed properties for one selector, or null. */
async function probe(page: Page, selector: string, props: string[] = []) {
  return page.evaluate(
    ({ target, wanted }) => {
      const element = document.querySelector(target);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const styles: Record<string, string> = {};
      for (const name of wanted) styles[name] = style.getPropertyValue(name);
      return {
        rect: {
          left: +rect.left.toFixed(1),
          top: +rect.top.toFixed(1),
          right: +rect.right.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
        },
        scrollWidth: (element as HTMLElement).scrollWidth,
        clientWidth: (element as HTMLElement).clientWidth,
        scrollHeight: (element as HTMLElement).scrollHeight,
        clientHeight: (element as HTMLElement).clientHeight,
        text: (element.textContent ?? "").trim().slice(0, 160),
        styles,
      };
    },
    { target: selector, wanted: props },
  );
}

test.describe("S1 window chrome & navigation", () => {
  test("C1-C10 sweep: chrome geometry in every shell combination", async ({ page }) => {
    for (const combination of COMBINATIONS) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(350); // let the width transition settle

      const shot = await capture(page, combination, "chrome", SESSION);

      const data = await page.evaluate(() => {
        const q = (s: string) => document.querySelector(s) as HTMLElement | null;
        const r = (element: Element | null) => {
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: +box.left.toFixed(1),
            top: +box.top.toFixed(1),
            right: +box.right.toFixed(1),
            bottom: +box.bottom.toFixed(1),
            width: +box.width.toFixed(1),
            height: +box.height.toFixed(1),
          };
        };
        const shell = q("#shell")!;
        const strip = q(".shell-tabstrip");
        const tabs = Array.from(document.querySelectorAll(".shell-tab"));
        const sidebarItems = Array.from(document.querySelectorAll(".shell-sidebar-item"));
        const statusbar = q(".shell-statusbar");

        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          shellAttrs: {
            mode: shell.dataset.mode,
            home: shell.dataset.home,
            navCollapsed: shell.dataset.navCollapsed,
            presence: shell.dataset.presence,
          },
          navWidthVar: getComputedStyle(shell).getPropertyValue("--shell-nav-w").trim(),
          taskWidthVar: getComputedStyle(shell).getPropertyValue("--shell-task-w").trim(),

          windowbar: {
            rect: r(q(".shell-windowbar")),
            controls: r(q(".shell-window-controls")),
            controlOrder: Array.from(document.querySelectorAll(".shell-window-controls button")).map(
              (button) => ({
                className: button.className,
                label: button.getAttribute("aria-label"),
                rect: r(button),
              }),
            ),
            navToggle: r(q(".shell-nav-toggle")),
            minWidth: q(".shell-windowbar")
              ? getComputedStyle(q(".shell-windowbar")!).minWidth
              : null,
          },

          tabs: {
            paddingLeft: q(".shell-tabs") ? getComputedStyle(q(".shell-tabs")!).paddingLeft : null,
            stripRect: r(strip),
            scrollWidth: strip?.scrollWidth ?? null,
            clientWidth: strip?.clientWidth ?? null,
            overflowPx: strip ? strip.scrollWidth - strip.clientWidth : null,
            count: tabs.length,
            firstTab: r(tabs[0] ?? null),
            lastTab: r(tabs[tabs.length - 1] ?? null),
            tabsFullyVisible: tabs.filter((tab) => {
              const box = tab.getBoundingClientRect();
              const bounds = strip!.getBoundingClientRect();
              return box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5;
            }).length,
            closeButtons: document.querySelectorAll(".shell-tab-close").length,
            bookmarkButtons: document.querySelectorAll(".shell-tab-bookmark").length,
            actionsVisibility: q(".shell-tabs-actions")
              ? getComputedStyle(q(".shell-tabs-actions")!).visibility
              : null,
          },

          sidebar: {
            rect: r(q(".shell-sidebar")),
            width: q(".shell-sidebar") ? getComputedStyle(q(".shell-sidebar")!).width : null,
            hasTree: Boolean(q(".shell-sidebar-tree")),
            hasViews: Boolean(q(".shell-sidebar-views")),
            items: sidebarItems.map((item) => ({
              label: (item.getAttribute("title") ?? "").trim(),
              visibleText: (item.textContent ?? "").trim(),
              ariaLabel: item.getAttribute("aria-label"),
              rect: r(item),
            })),
            folderRows: document.querySelectorAll(".shell-tree-folder-row").length,
            fileRows: document.querySelectorAll(".shell-tree-file-row").length,
            bodyScroll: q(".shell-sidebar-body")
              ? {
                  scrollHeight: q(".shell-sidebar-body")!.scrollHeight,
                  clientHeight: q(".shell-sidebar-body")!.clientHeight,
                }
              : null,
            footerRect: r(q(".shell-sidebar-footer")),
            brandRect: r(q(".shell-brand")),
          },

          statusbar: {
            rect: r(statusbar),
            text: (statusbar?.textContent ?? "").trim(),
            scrollWidth: statusbar?.scrollWidth ?? null,
            clientWidth: statusbar?.clientWidth ?? null,
            visible: statusbar ? getComputedStyle(statusbar).display !== "none" : false,
            workspaceHidden: q(".shell-workspace")?.hasAttribute("hidden") ?? null,
          },
        };
      });

      save(combination, { screenshot: shot, ...data });
    }
  });

  test("window controls: macOS traffic lights, hover/focus states", async ({ page }) => {
    await open(page, "C1", SESSION);

    const before = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".shell-window-close .shell-window-glyph")!).opacity,
    );
    await page.locator(".shell-window-controls").hover();
    await page.waitForTimeout(120);
    const afterHover = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".shell-window-close .shell-window-glyph")!).opacity,
    );
    await capture(page, "C1", "windowcontrols-hover", SESSION);

    // Focus: the glyph is meant to show on :focus-visible too.
    await page.locator(".shell-window-close").focus();
    await page.waitForTimeout(80);
    const afterFocus = await page.evaluate(() => {
      const glyph = document.querySelector(".shell-window-close .shell-window-glyph")!;
      const button = document.querySelector(".shell-window-close")!;
      return {
        glyphOpacity: getComputedStyle(glyph).opacity,
        outline: getComputedStyle(button).outline,
        matchesFocusVisible: button.matches(":focus-visible"),
      };
    });
    await capture(page, "C1", "windowcontrols-focus", SESSION);

    const colours = await page.evaluate(() =>
      [".shell-window-close", ".shell-window-minimize", ".shell-window-fullscreen"].map((sel) => ({
        selector: sel,
        background: getComputedStyle(document.querySelector(sel)!, "::before").backgroundColor,
        rect: (() => {
          const box = document.querySelector(sel)!.getBoundingClientRect();
          return { left: +box.left.toFixed(1), width: +box.width.toFixed(1) };
        })(),
      })),
    );

    save("windowControls", { before, afterHover, afterFocus, colours });
  });

  test("tab strip overflow and close affordance", async ({ page }) => {
    for (const combination of ["C5", "C6", "C7", "C8", "C9", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(300);
      const strip = page.locator(".shell-tabstrip");
      const data = await page.evaluate(() => {
        const element = document.querySelector(".shell-tabstrip") as HTMLElement;
        const bounds = element.getBoundingClientRect();
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollLeft: element.scrollLeft,
          scrollbarWidth: getComputedStyle(element).scrollbarWidth,
          overflowX: getComputedStyle(element).overflowX,
          hidden: Array.from(document.querySelectorAll(".shell-tab"))
            .map((tab) => {
              const box = tab.getBoundingClientRect();
              return {
                name: (tab.querySelector(".shell-tab-name")?.textContent ?? "").slice(0, 28),
                left: +box.left.toFixed(1),
                right: +box.right.toFixed(1),
                clipped: box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5,
                closeVisible: (() => {
                  const close = tab.querySelector(".shell-tab-close");
                  if (!close) return null;
                  const cb = close.getBoundingClientRect();
                  return cb.left >= bounds.left - 0.5 && cb.right <= bounds.right + 0.5;
                })(),
              };
            }),
        };
      });
      save(`tabstrip-${combination}`, data);
      await capture(page, combination, "tabstrip", SESSION);
      void strip;
    }

    // Does the active tab get scrolled into view when activated from elsewhere?
    await open(page, "C6", SESSION);
    await page.waitForTimeout(250);
    const scrollBehaviour = await page.evaluate(() => {
      const element = document.querySelector(".shell-tabstrip") as HTMLElement;
      const start = element.scrollLeft;
      const current = document.querySelector(".shell-tab.is-current");
      return {
        scrollLeft: start,
        currentTabInView: current
          ? (() => {
              const box = current.getBoundingClientRect();
              const bounds = element.getBoundingClientRect();
              return box.left >= bounds.left - 0.5 && box.right <= bounds.right + 0.5;
            })()
          : null,
      };
    });
    save("tabstrip-active-in-view", scrollBehaviour);
  });

  test("file tree: folder + button and file more button escape their rows", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.waitForTimeout(250);

    // The inline actions are display:none until hover/focus-within.
    const folderRow = page.locator(".shell-tree-folder-row").first();
    await folderRow.hover();
    await page.waitForTimeout(120);
    await capture(page, "C2", "folderrow-hover", SESSION);

    const folder = await page.evaluate(() => {
      const row = document.querySelector(".shell-tree-folder-row") as HTMLElement;
      const add = row.querySelector(".shell-tree-folder-add") as HTMLElement;
      const anchor = add.parentElement as HTMLElement;
      const toggle = row.querySelector(".shell-tree-folder-toggle") as HTMLElement;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: +rect.left.toFixed(1),
          top: +rect.top.toFixed(1),
          right: +rect.right.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
        };
      };
      const rowBox = box(row);
      const addBox = box(add);
      return {
        row: rowBox,
        add: addBox,
        anchor: box(anchor),
        toggle: box(toggle),
        anchorPosition: getComputedStyle(anchor).position,
        anchorClass: anchor.className,
        addPosition: getComputedStyle(add).position,
        addTop: getComputedStyle(add).top,
        addRight: getComputedStyle(add).right,
        togglePaddingRight: getComputedStyle(toggle).paddingRight,
        // The numbers the finding turns on:
        overflowBottomPx: +(addBox.bottom - rowBox.bottom).toFixed(1),
        overflowTopPx: +(rowBox.top - addBox.top).toFixed(1),
        overflowRightPx: +(addBox.right - rowBox.right).toFixed(1),
        // Which element is actually at the point just below the row?
        elementBelowRow: (() => {
          const hit = document.elementFromPoint(addBox.left + 12, rowBox.bottom + 3);
          return hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : null;
        })(),
        // Does the + overlap the folder label's text box?
        labelRect: box(toggle.querySelector("span")!),
      };
    });
    save("folderAddButton", folder);

    // Same shape one level down: the file row's "more" button.
    const fileRow = page.locator(".shell-tree-file-row").first();
    await fileRow.hover();
    await page.waitForTimeout(120);
    await capture(page, "C2", "filerow-hover", SESSION);
    const file = await page.evaluate(() => {
      const row = document.querySelector(".shell-tree-file-row") as HTMLElement;
      const more = row.querySelector(".shell-tree-file-more") as HTMLElement;
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: +rect.left.toFixed(1),
          top: +rect.top.toFixed(1),
          right: +rect.right.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
        };
      };
      const rowBox = box(row);
      const moreBox = box(more);
      return {
        row: rowBox,
        more: moreBox,
        anchorPosition: getComputedStyle(more.parentElement!).position,
        overflowBottomPx: +(moreBox.bottom - rowBox.bottom).toFixed(1),
        overflowRightPx: +(moreBox.right - rowBox.right).toFixed(1),
        nextRowTop: (() => {
          const rows = Array.from(document.querySelectorAll(".shell-tree-file-row"));
          const next = rows[1];
          return next ? +next.getBoundingClientRect().top.toFixed(1) : null;
        })(),
      };
    });
    save("fileMoreButton", file);

    // Keyboard reachability of the same control (focus-within shows it).
    await page.locator(".shell-tree-folder-toggle").first().focus();
    await page.waitForTimeout(80);
    const focusState = await page.evaluate(() => {
      const toggle = document.querySelector(".shell-tree-folder-toggle") as HTMLElement;
      const add = document.querySelector(".shell-tree-folder-add") as HTMLElement;
      return {
        toggleOutline: getComputedStyle(toggle).outline,
        toggleMatchesFocusVisible: toggle.matches(":focus-visible"),
        addDisplay: getComputedStyle(add).display,
        // The count badge hides on hover but not on focus — does the + now
        // sit on top of it?
        countOpacity: getComputedStyle(toggle.querySelector("small")!).opacity,
        countRect: (() => {
          const rect = toggle.querySelector("small")!.getBoundingClientRect();
          return { left: +rect.left.toFixed(1), right: +rect.right.toFixed(1) };
        })(),
        addRect: (() => {
          const rect = add.getBoundingClientRect();
          return { left: +rect.left.toFixed(1), right: +rect.right.toFixed(1) };
        })(),
      };
    });
    save("folderFocusWithin", focusState);
    await capture(page, "C2", "folderrow-focus", SESSION);
  });

  test("long folder name: label runs under the inline action", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.waitForTimeout(250);

    const longRow = page.locator(".shell-tree-folder-row", { hasText: "二〇二六年第三季度" }).first();
    await longRow.hover();
    await page.waitForTimeout(120);
    await capture(page, "C2", "folderrow-longname", SESSION);

    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".shell-tree-folder-row"));
      const row = rows.find((candidate) => candidate.textContent?.includes("二〇二六年第三季度"))!;
      const label = row.querySelector(".shell-tree-folder-toggle > span") as HTMLElement;
      const add = row.querySelector(".shell-tree-folder-add") as HTMLElement;
      const labelBox = label.getBoundingClientRect();
      const addBox = add.getBoundingClientRect();
      return {
        labelRight: +labelBox.right.toFixed(1),
        addLeft: +addBox.left.toFixed(1),
        overlapPx: +(labelBox.right - addBox.left).toFixed(1),
        labelTruncated: label.scrollWidth > label.clientWidth,
        labelScrollWidth: label.scrollWidth,
        labelClientWidth: label.clientWidth,
        titleAttr: (row.querySelector(".shell-tree-folder-toggle") as HTMLElement).title.slice(0, 40),
        textOverflow: getComputedStyle(label).textOverflow,
      };
    });
    save("longFolderName", data);
  });

  test("SIDEBAR_PAGE: Show 40 more before and after", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.waitForTimeout(250);

    const before = await page.evaluate(() => {
      const more = Array.from(document.querySelectorAll(".shell-tree-more")).find((button) =>
        button.textContent?.includes("more"),
      ) as HTMLElement | undefined;
      const body = document.querySelector(".shell-sidebar-body") as HTMLElement;
      return {
        label: more?.textContent?.trim() ?? null,
        fileRows: document.querySelectorAll(".shell-tree-file-row").length,
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        moreRect: more
          ? (() => {
              const rect = more.getBoundingClientRect();
              return {
                left: +rect.left.toFixed(1),
                top: +rect.top.toFixed(1),
                height: +rect.height.toFixed(1),
              };
            })()
          : null,
        moreIsButton: more?.tagName.toLowerCase() ?? null,
        moreHasFocusRing: more ? getComputedStyle(more).outlineWidth : null,
      };
    });
    await capture(page, "C2", "showmore-before", SESSION);

    await page.getByRole("button", { name: /Show 40 more/ }).click();
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => {
      const body = document.querySelector(".shell-sidebar-body") as HTMLElement;
      const less = Array.from(document.querySelectorAll(".shell-tree-more")).find((button) =>
        button.textContent?.includes("less"),
      ) as HTMLElement | undefined;
      return {
        label: less?.textContent?.trim() ?? null,
        fileRows: document.querySelectorAll(".shell-tree-file-row").length,
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        bodyScrollTop: body.scrollTop,
        // Did the control the user just pressed stay on screen?
        lessInView: less
          ? (() => {
              const rect = less.getBoundingClientRect();
              const bounds = body.getBoundingClientRect();
              return rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5;
            })()
          : null,
        focusedAfterClick: document.activeElement
          ? `${document.activeElement.tagName.toLowerCase()}.${document.activeElement.className}`
          : null,
      };
    });
    await capture(page, "C2", "showmore-after", SESSION);
    save("showMore", { before, after });
  });

  test("collapsed rail (C1/C3): icons, tooltips, hit areas", async ({ page }) => {
    for (const combination of ["C1", "C3"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(300);

      const data = await page.evaluate(() => {
        const sidebar = document.querySelector(".shell-sidebar") as HTMLElement;
        const items = Array.from(document.querySelectorAll(".shell-sidebar-item"));
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: +rect.left.toFixed(1),
            width: +rect.width.toFixed(1),
            height: +rect.height.toFixed(1),
          };
        };
        return {
          sidebarWidth: +sidebar.getBoundingClientRect().width.toFixed(1),
          sidebarPadding: getComputedStyle(sidebar).padding,
          items: items.map((item) => ({
            title: item.getAttribute("title"),
            ariaLabel: item.getAttribute("aria-label"),
            textNode: (item.textContent ?? "").trim(),
            ...box(item),
          })),
          // Every rail affordance is a native `title`; there is no tooltip
          // component in the shell at all.
          customTooltips: document.querySelectorAll("[role='tooltip']").length,
          titleAttributes: document.querySelectorAll(".shell-sidebar [title]").length,
          treeFolderToggles: Array.from(
            document.querySelectorAll(".shell-tree-folder-toggle"),
          ).map((toggle) => ({
            title: toggle.getAttribute("title")?.slice(0, 24),
            ...box(toggle),
          })),
          treeChevronDisplay: document.querySelector(".shell-tree-chevron")
            ? getComputedStyle(document.querySelector(".shell-tree-chevron")!).display
            : null,
          folderAddDisplay: document.querySelector(".shell-tree-folder-add")
            ? getComputedStyle(document.querySelector(".shell-tree-folder-add")!).display
            : null,
          sectionHeadDisplay: document.querySelector(".shell-tree-section-head")
            ? getComputedStyle(document.querySelector(".shell-tree-section-head")!).display
            : null,
          // The "New folder" button lives inside that hidden section head.
          newFolderReachable: (() => {
            const button = document.querySelector(
              ".shell-tree-section-head .shell-icon-button",
            ) as HTMLElement | null;
            if (!button) return "absent";
            const rect = button.getBoundingClientRect();
            return rect.width === 0 && rect.height === 0 ? "zero-size" : "visible";
          })(),
          footerDirection: getComputedStyle(
            document.querySelector(".shell-sidebar-footer")!,
          ).flexDirection,
        };
      });
      save(`rail-${combination}`, data);
      await capture(page, combination, "rail", SESSION);
    }
  });

  test("sidebar mode fork: agent vs editor button sets", async ({ page }) => {
    const byMode: Record<string, unknown> = {};
    for (const combination of ["C2", "C4"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(250);
      byMode[combination] = await page.evaluate(() => ({
        mode: (document.querySelector("#shell") as HTMLElement).dataset.mode,
        navLabel: document.querySelector(".shell-sidebar-top")?.getAttribute("aria-label"),
        topButtons: Array.from(document.querySelectorAll(".shell-sidebar-top .shell-sidebar-item")).map(
          (item) => (item.textContent ?? "").trim(),
        ),
        viewButtons: Array.from(
          document.querySelectorAll(".shell-sidebar-views .shell-sidebar-item"),
        ).map((item) => (item.textContent ?? "").trim()),
        hasTree: Boolean(document.querySelector(".shell-sidebar-tree")),
        bodyHeight: +(
          document.querySelector(".shell-sidebar-body") as HTMLElement
        ).getBoundingClientRect().height.toFixed(1),
        bodyChildren: (document.querySelector(".shell-sidebar-body") as HTMLElement).children.length,
        tabOrder: Array.from(
          document.querySelectorAll(
            ".shell-sidebar button, .shell-sidebar [tabindex]:not([tabindex='-1'])",
          ),
        ).map((element) => element.getAttribute("aria-label") ?? (element.textContent ?? "").trim()),
      }));
      await capture(page, combination, "sidebar-fork", SESSION);
    }
    save("sidebarFork", byMode);
  });

  test("status bar in every combination that renders it", async ({ page }) => {
    const rows: Record<string, unknown> = {};
    for (const combination of COMBINATIONS) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(250);
      rows[combination] = await page.evaluate(() => {
        const bar = document.querySelector(".shell-statusbar") as HTMLElement | null;
        const workspace = document.querySelector(".shell-workspace") as HTMLElement | null;
        if (!bar) return { present: false };
        const rect = bar.getBoundingClientRect();
        return {
          present: true,
          workspaceHidden: workspace?.hasAttribute("hidden") ?? null,
          renderedHeight: +rect.height.toFixed(1),
          rectWidth: +rect.width.toFixed(1),
          text: (bar.textContent ?? "").trim(),
          facts: (bar.querySelector(".shell-statusbar-facts")?.textContent ?? "").trim(),
          end: (bar.querySelector(".shell-statusbar-end")?.textContent ?? "").trim(),
          overflowPx: bar.scrollWidth - bar.clientWidth,
          factsOverflowPx: (() => {
            const facts = bar.querySelector(".shell-statusbar-facts") as HTMLElement | null;
            return facts ? facts.scrollWidth - facts.clientWidth : null;
          })(),
          // app.css:152 targets `.shell-statusbar > span`, but StatusBar renders
          // two <div> wrappers — does the ellipsis rule reach anything?
          directSpanChildren: bar.querySelectorAll(":scope > span").length,
          directDivChildren: bar.querySelectorAll(":scope > div").length,
          factsSpanTextOverflow: (() => {
            const span = bar.querySelector(".shell-statusbar-facts > span");
            return span ? getComputedStyle(span).textOverflow : null;
          })(),
        };
      });
    }
    save("statusbar", rows);
  });

  test("status bar with the longest file name active", async ({ page }) => {
    await open(page, "C6", SESSION, );
    await page.waitForTimeout(250);
    // Activate the long-CJK tab so the status bar has to survive it.
    await page.locator(".shell-tab-select", { hasText: "二〇二六年" }).first().click();
    await page.waitForTimeout(250);
    await capture(page, "C6", "statusbar-longname", SESSION);
    const data = await page.evaluate(() => {
      const bar = document.querySelector(".shell-statusbar") as HTMLElement;
      const facts = bar.querySelector(".shell-statusbar-facts") as HTMLElement;
      const span = facts.querySelector("span") as HTMLElement;
      const end = bar.querySelector(".shell-statusbar-end") as HTMLElement;
      return {
        text: (bar.textContent ?? "").trim().slice(0, 80),
        factsScroll: facts.scrollWidth,
        factsClient: facts.clientWidth,
        spanScroll: span.scrollWidth,
        spanClient: span.clientWidth,
        spanTextOverflow: getComputedStyle(span).textOverflow,
        spanOverflow: getComputedStyle(span).overflow,
        spanWhiteSpace: getComputedStyle(span).whiteSpace,
        endRect: (() => {
          const rect = end.getBoundingClientRect();
          return { left: +rect.left.toFixed(1), right: +rect.right.toFixed(1) };
        })(),
        barRight: +bar.getBoundingClientRect().right.toFixed(1),
        title: span.getAttribute("title"),
      };
    });
    save("statusbarLongName", data);
  });

  test("hover / focus / active on the chrome controls", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.waitForTimeout(250);

    const targets = [
      { name: "sidebar-home", selector: ".shell-sidebar-top .shell-sidebar-item" },
      { name: "sidebar-settings", selector: ".shell-sidebar-footer .shell-icon-button" },
      { name: "brand", selector: ".shell-brand" },
      { name: "tab-close", selector: ".shell-tab-close" },
      { name: "tab-bookmark", selector: ".shell-tab-bookmark" },
      { name: "nav-toggle", selector: ".shell-nav-toggle" },
      { name: "new-folder", selector: ".shell-tree-section-head .shell-icon-button" },
      { name: "tree-more", selector: ".shell-tree-more" },
    ];

    const states: Record<string, unknown> = {};
    for (const target of targets) {
      const locator = page.locator(target.selector).first();
      if ((await locator.count()) === 0) {
        states[target.name] = { missing: true };
        continue;
      }
      const read = async () =>
        page.evaluate((selector: string) => {
          const element = document.querySelector(selector) as HTMLElement;
          const style = getComputedStyle(element);
          return {
            background: style.backgroundColor,
            color: style.color,
            opacity: style.opacity,
            outline: style.outline,
            outlineWidth: style.outlineWidth,
            boxShadow: style.boxShadow,
          };
        }, target.selector);

      const rest = await read();
      await locator.hover();
      await page.waitForTimeout(90);
      const hover = await read();
      await locator.focus();
      await page.waitForTimeout(90);
      const focus = await read();
      const focusVisible = await page.evaluate(
        (selector: string) => document.querySelector(selector)!.matches(":focus-visible"),
        target.selector,
      );
      // :active — hold the button down, read, then release without committing
      // anywhere destructive by moving off first.
      await page.mouse.move(0, 0);
      const boundingBox = await locator.boundingBox();
      let active: unknown = null;
      if (boundingBox) {
        await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(60);
        active = await read();
        await page.mouse.move(0, 0);
        await page.mouse.up();
        await page.waitForTimeout(60);
      }
      states[target.name] = {
        rest,
        hover,
        focus,
        focusVisible,
        active,
        hoverDiffers: JSON.stringify(rest) !== JSON.stringify(hover),
        focusRing: focus.outlineWidth !== "0px" || focus.boxShadow !== "none",
        activeDiffers: active ? JSON.stringify(hover) !== JSON.stringify(active) : null,
      };
      await open(page, "C2", SESSION); // reset after any accidental state change
      await page.waitForTimeout(150);
    }
    save("controlStates", states);
  });

  test("hardcoded English: every string this session's surfaces render", async ({ page }) => {
    const strings: Record<string, string[]> = {};
    for (const combination of ["C2", "C4", "C6", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(250);
      strings[combination] = await page.evaluate(() => {
        const roots = [
          ".shell-windowbar",
          ".shell-tabs",
          ".shell-sidebar",
          ".shell-statusbar",
        ];
        const found = new Set<string>();
        for (const root of roots) {
          const element = document.querySelector(root);
          if (!element) continue;
          element.querySelectorAll("*").forEach((node) => {
            const title = node.getAttribute("title");
            const label = node.getAttribute("aria-label");
            if (title) found.add(`title:${title}`);
            if (label) found.add(`aria-label:${label}`);
          });
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode.textContent?.trim();
            if (text) found.add(`text:${text}`);
          }
        }
        return Array.from(found).sort();
      });
    }
    save("visibleStrings", strings);
  });

  test("focus indicator audit: which controls draw an outline at all", async ({ page }) => {
    // chrome.css:25-35 lists eight selectors that get `outline: 2px solid`.
    // Anything focusable but absent from that list is keyboard-reachable with
    // nothing on screen to say so. `outline-style` is the fact, not
    // `outline-width` — the shorthand still reports a width when style is none.
    await open(page, "C6", SESSION);
    await page.waitForTimeout(300);

    const selectors = [
      ".shell-sidebar-item",
      ".shell-icon-button",
      ".shell-brand",
      ".shell-tab-select",
      ".shell-tab-close",
      ".shell-tab-bookmark",
      ".shell-save-state",
      ".shell-share",
      ".shell-window-close",
      ".shell-tree-folder-toggle",
      ".shell-tree-file-open",
      ".shell-tree-more",
    ];

    const results: Record<string, unknown> = {};
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        results[selector] = { missing: true };
        continue;
      }
      await locator.focus();
      await page.waitForTimeout(60);
      results[selector] = await page.evaluate((target: string) => {
        const element = document.querySelector(target) as HTMLElement;
        const style = getComputedStyle(element);
        return {
          focusVisible: element.matches(":focus-visible"),
          isActiveElement: document.activeElement === element,
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          boxShadow: style.boxShadow,
          // The only honest verdict: something is painted, or nothing is.
          drawsAnything: style.outlineStyle !== "none" || style.boxShadow !== "none",
        };
      }, selector);
    }
    save("focusIndicators", results);

    // The inline tree actions are display:none until focus-within — measure
    // them through the row rather than directly.
    await page.locator(".shell-tree-folder-toggle").first().focus();
    await page.keyboard.press("Tab");
    await page.waitForTimeout(80);
    const afterTab = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return {
        className: element.className,
        ariaLabel: element.getAttribute("aria-label"),
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
        display: style.display,
        rect: (() => {
          const rect = element.getBoundingClientRect();
          return { top: +rect.top.toFixed(1), bottom: +rect.bottom.toFixed(1), width: +rect.width.toFixed(1) };
        })(),
      };
    });
    save("focusAfterTabIntoTree", afterTab);
    await capture(page, "C6", "focus-tree-add", SESSION);
  });

  test("collapsed rail: folder context menu has a 0-width anchor in a 52px rail", async ({ page }) => {
    // C1 is the default shell. The folder rows keep their right-click handler
    // even though the trigger button is display:none there (nav.css:203).
    await open(page, "C1", SESSION);
    await page.waitForTimeout(300);

    const railState = await page.evaluate(() => ({
      sidebarOverflow: getComputedStyle(document.querySelector(".shell-sidebar")!).overflow,
      sectionHeadDisplay: getComputedStyle(document.querySelector(".shell-tree-section-head")!).display,
      newFolderButtonBox: (() => {
        const rect = document
          .querySelector(".shell-tree-section-head .shell-icon-button")!
          .getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })(),
      newFolderFocusable: (() => {
        const button = document.querySelector(
          ".shell-tree-section-head .shell-icon-button",
        ) as HTMLElement;
        button.focus();
        return document.activeElement === button;
      })(),
      filesHiddenInRail: getComputedStyle(document.querySelector(".shell-tree-files")!).display,
      folderToggleStillClickable: true,
    }));

    await page.locator(".shell-tree-folder-row").first().click({ button: "right" });
    await page.waitForTimeout(200);
    await capture(page, "C1", "rail-folder-contextmenu", SESSION);

    const menu = await page.evaluate(() => {
      const panel = document.querySelector(".shell-menu") as HTMLElement | null;
      if (!panel) return { open: false };
      const rect = panel.getBoundingClientRect();
      const sidebar = document.querySelector(".shell-sidebar")!.getBoundingClientRect();
      let clippedBy: string | null = null;
      for (let node = panel.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible")
          continue;
        const bounds = node.getBoundingClientRect();
        if (
          rect.left < bounds.left - 0.5 ||
          rect.right > bounds.right + 0.5 ||
          rect.top < bounds.top - 0.5 ||
          rect.bottom > bounds.bottom + 0.5
        ) {
          clippedBy = node.className || node.tagName.toLowerCase();
          break;
        }
      }
      return {
        open: true,
        rect: {
          left: +rect.left.toFixed(1),
          right: +rect.right.toFixed(1),
          top: +rect.top.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          width: +rect.width.toFixed(1),
        },
        sidebarRight: +sidebar.right.toFixed(1),
        overhangPx: +(rect.right - sidebar.right).toFixed(1),
        clippedBy,
        zIndex: getComputedStyle(panel).zIndex,
        visibleWidth: +(Math.min(rect.right, sidebar.right) - rect.left).toFixed(1),
      };
    });
    save("railContextMenu", { railState, menu });
  });

  test("press (:active) feedback across the chrome", async ({ page }) => {
    await open(page, "C6", SESSION);
    await page.waitForTimeout(300);
    const data = await page.evaluate(() => {
      // Does any stylesheet in the shell define :active for these at all?
      const wanted = [
        ".shell-icon-button",
        ".shell-sidebar-item",
        ".shell-tab-close",
        ".shell-tab-select",
        ".shell-share",
        ".shell-save-state",
        ".shell-tree-folder-toggle",
        ".shell-tree-file-open",
      ];
      const hits: Record<string, string[]> = {};
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          const text = (rule as CSSStyleRule).selectorText;
          if (!text || !text.includes(":active")) continue;
          for (const name of wanted) {
            if (text.includes(name)) (hits[name] ??= []).push(text);
          }
          (hits["__all_active_rules"] ??= []).push(text);
        }
      }
      return hits;
    });
    save("activeRules", data);
  });

  test("editor mode: the empty sidebar middle", async ({ page }) => {
    for (const combination of ["C4", "C10"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(300);
      const data = await page.evaluate(() => {
        const body = document.querySelector(".shell-sidebar-body") as HTMLElement;
        const rect = body.getBoundingClientRect();
        const views = document.querySelector(".shell-sidebar-views")!.getBoundingClientRect();
        const top = document.querySelector(".shell-sidebar-top")!.getBoundingClientRect();
        return {
          bodyChildren: body.children.length,
          bodyText: (body.textContent ?? "").trim(),
          bodyRect: {
            top: +rect.top.toFixed(1),
            bottom: +rect.bottom.toFixed(1),
            height: +rect.height.toFixed(1),
          },
          gapBetweenTopNavAndViews: +(views.top - top.bottom).toFixed(1),
          bodyMarginTop: getComputedStyle(body).marginTop,
          bodyFlex: getComputedStyle(body).flex,
        };
      });
      save(`editorEmptyBody-${combination}`, data);
      await capture(page, combination, "sidebar-empty-middle", SESSION);
    }
  });

  test("accessible names in the tree glue label and count together", async ({ page }) => {
    await open(page, "C2", SESSION);
    await page.waitForTimeout(250);
    const data = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".shell-tree-folder-toggle")).map((toggle) => ({
        computedName: (toggle.textContent ?? "").trim().slice(0, 40),
        title: toggle.getAttribute("title")?.slice(0, 30) ?? null,
        ariaLabel: toggle.getAttribute("aria-label"),
        labelSpan: toggle.querySelector("span")?.textContent?.slice(0, 30) ?? null,
        countSmall: toggle.querySelector("small")?.textContent ?? null,
        separator: (() => {
          const span = toggle.querySelector("span");
          const small = toggle.querySelector("small");
          if (!span || !small) return null;
          // Is there any whitespace text node between them?
          return span.nextSibling === small ? "none" : "something";
        })(),
      })),
    );
    save("treeAccessibleNames", data);
  });

  test("Home reserves space for invisible file actions", async ({ page }) => {
    // chrome.css:334-337 hides the actions with `visibility`, which keeps their
    // box. On Home the strip is therefore narrower than the window allows, and
    // the tabs overflow into space nothing is drawing in.
    for (const combination of ["C1", "C2", "C3", "C4"] as Combination[]) {
      await open(page, combination, SESSION);
      await page.waitForTimeout(300);
      const data = await page.evaluate(() => {
        const actions = document.querySelector(".shell-tabs-actions") as HTMLElement;
        const strip = document.querySelector(".shell-tabstrip") as HTMLElement;
        const row = document.querySelector(".shell-row--top") as HTMLElement;
        const actionsBox = actions.getBoundingClientRect();
        return {
          actionsVisibility: getComputedStyle(actions).visibility,
          actionsWidth: +actionsBox.width.toFixed(1),
          reservedPx: +(row.getBoundingClientRect().right - strip.getBoundingClientRect().right).toFixed(1),
          stripClientWidth: strip.clientWidth,
          stripScrollWidth: strip.scrollWidth,
          overflowPx: strip.scrollWidth - strip.clientWidth,
          // Would the tabs fit if the hidden actions gave their box back?
          wouldFit:
            strip.scrollWidth -
              (strip.clientWidth +
                (row.getBoundingClientRect().right - strip.getBoundingClientRect().right)) <=
            0,
        };
      });
      save(`homeReservedActions-${combination}`, data);
    }
  });

  test("comfortable list cross-check for nav.css findings", async ({ page }) => {
    // PLAN 2.4: the two densities share nav.css. Every S1 finding has to say
    // whether the Home list reproduces it, so measure the counterpart controls.
    await open(page, "C4", SESSION);
    await page.waitForTimeout(350);
    await capture(page, "C4", "comfortable-list", SESSION);
    const data = await page.evaluate(() => {
      const table = document.querySelector(".shell-list") as HTMLElement | null;
      if (!table) return { present: false };
      const pin = table.querySelector(".shell-list-pin") as HTMLElement | null;
      const cell = pin?.closest("td") as HTMLElement | null;
      const box = (element: Element | null) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: +rect.left.toFixed(1),
          top: +rect.top.toFixed(1),
          right: +rect.right.toFixed(1),
          bottom: +rect.bottom.toFixed(1),
          height: +rect.height.toFixed(1),
        };
      };
      return {
        present: true,
        rowCount: table.querySelectorAll("tbody tr:not(.shell-list-group)").length,
        pinPosition: pin ? getComputedStyle(pin).position : null,
        pinRect: box(pin),
        cellRect: box(cell),
        pinOverflowPx: pin && cell
          ? +(pin.getBoundingClientRect().bottom - cell.getBoundingClientRect().bottom).toFixed(1)
          : null,
        // No shell-tree-* class is used by the comfortable branch at all.
        treeClassesPresent: document.querySelectorAll("[class*='shell-tree-']").length,
      };
    });
    save("comfortableCrossCheck", data);
  });
});

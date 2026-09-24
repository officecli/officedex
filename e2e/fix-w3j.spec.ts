/**
 * W3-J — the shell speaks the reader's language, and only the reader's.
 *
 * Two questions, and they are not the same one:
 *
 *   1. Under `zh-CN`, do the surfaces this track covered actually render
 *      Chinese? A key that was added to the dictionary but never wired into
 *      the component looks exactly like a translation that was never written.
 *   2. Under `en-US`, is every one of those surfaces still the *same English
 *      byte* it was before? Six fix specs (W1-A … W2-G) select elements by
 *      their English `title` / `aria-label` / text. Rewording one while
 *      "adding i18n" would take the regression gates down with it, which is a
 *      worse outcome than the English-only shell this track set out to fix.
 *
 * The third question is layout: Chinese is denser per character but the
 * strings are not uniformly shorter, and `nav.css`'s truncation (repaired by
 * W2-E) is the thing most likely to be undone by a longer label. Those checks
 * assert the ellipsis machinery is still in place and that no covered row has
 * grown a second line.
 *
 * There is no `test.skip` in this file, conditional or otherwise — everything
 * here runs against the fixture server, which needs nothing but the dev server.
 *
 * Run:
 *   npx vite --port 3152 --strictPort
 *   PLAYWRIGHT_BASE_URL=http://localhost:3152 npx playwright test e2e/fix-w3j.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { open, settle, type Combination } from "./ui-audit-helpers";

const SESSION = { session: "fixes/W3-J" };

/** Any CJK ideograph. The cheapest honest answer to "is this Chinese?". */
const HAN = /[一-鿿]/;

async function attr(page: Page, selector: string, name: string): Promise<string> {
  return (await page.locator(selector).first().getAttribute(name)) ?? "";
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).first().textContent()) ?? "").trim();
}

/**
 * Opens the settings page, which is the sidebar footer's gear and the shell's
 * only settings door.
 *
 * It used to open a three-row `.shell-menu` dropdown. That menu's two real
 * preferences moved onto the page (under Appearance) and the third was a
 * switch that only ever reported that it was not available, so the gear now
 * opens the page directly — see `chrome/Sidebar.tsx`.
 */
async function openSettingsPage(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.locator(".shell-settings")).toBeVisible();
}

/**
 * A row is one line tall, and its text is either short enough or clipped.
 *
 * Measured rather than eyeballed: `scrollWidth > clientWidth` with an ellipsis
 * is the *working* state — the label is longer than the box and the box says
 * so. The failure this guards against is the opposite, a box that grew to fit
 * (wrapping) and pushed the rows below it out of alignment.
 */
async function expectSingleLine(locator: Locator, label: string): Promise<void> {
  const box = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    return {
      height: node.getBoundingClientRect().height,
      lineHeight,
      overflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  // Two lines or more would be at least 1.8 line-heights of text box; the row
  // itself carries padding, so the comparison is against the text metric.
  expect(box.height, `${label} grew past one line: ${JSON.stringify(box)}`).toBeLessThan(
    box.lineHeight * 2.6,
  );
  expect(box.whiteSpace, `${label} is allowed to wrap: ${JSON.stringify(box)}`).toMatch(/nowrap/);
  expect(box.overflow, `${label} lost its ellipsis: ${JSON.stringify(box)}`).toBe("ellipsis");
}

/* =========================================================== zh-CN */

test.describe("zh-CN renders the shell in Chinese", () => {
  test.use({ locale: "zh-CN" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  });

  test("window bar, sidebar and mode switch", async ({ page }) => {
    await open(page, "C2" as Combination, SESSION);

    // WindowBar: the two entries that were already in the dictionary, unused.
    expect(await attr(page, ".shell-nav-toggle", "aria-label")).toBe("折叠侧栏");
    expect(await attr(page, ".shell-window-close", "title")).toBe("关闭窗口");
    expect(await attr(page, ".shell-window-controls", "aria-label")).toBe("窗口控件");

    // ModeMenu: brand button label and the menu rows behind it.
    expect(await attr(page, ".shell-brand", "aria-label")).toContain("切换模式");
    await page.locator(".shell-brand").click();
    await expect(page.getByRole("menuitemradio", { name: /Agent 模式/ })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: /编辑器模式/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // Sidebar rows.
    const items = await page.locator(".shell-sidebar-item span").allTextContents();
    expect(items).toContain("首页");
    expect(items).toContain("新建任务");
    expect(await attr(page, "#shell-sidebar", "aria-label")).toBe("工作区导航");

    // Folder section head and its "new folder" button.
    expect(await text(page, ".shell-tree-section-head span")).toBe("文件夹");
    await expect(page.getByRole("button", { name: "新建文件夹" })).toBeVisible();
  });

  test("the settings page behind the sidebar footer's gear", async ({ page }) => {
    await open(page, "C2" as Combination, SESSION);
    await openSettingsPage(page, "设置");

    // The page's own copy, in the reader's language.
    await expect(page.getByRole("heading", { name: "应用设置" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "设置分区" })).toBeVisible();

    const nav = (await page.locator(".shell-settings-nav-label").allTextContents()).join(" | ");
    expect(nav).toContain("生成");
    expect(nav).toContain("外观");
    expect(nav).toContain("活动记录");
    expect(nav).toContain("高级与支持");

    /*
     * The two preferences that used to be rows in the footer dropdown, now on
     * the page under Appearance, with the same words they had in the menu.
     */
    await page.getByRole("button", { name: "外观" }).click();
    await expect(page.getByRole("switch", { name: "减弱动效" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "回车发送" })).toBeVisible();

    // The page replaces the shell frame rather than sitting inside it, so the
    // footer menu it was opened from is gone while it is up.
    await expect(page.locator(".shell-menu")).toHaveCount(0);
  });

  test("file tree rows, folder menu and the file list header", async ({ page }) => {
    await open(page, "C6" as Combination, SESSION);

    // A folder's inline "+" opens the create/rename/remove menu. It is hidden
    // until the row is hovered or focused (`nav.css:150`), so the hover is part
    // of the control, not test noise.
    const folderRow = page.locator(".shell-tree-folder-row").first();
    await folderRow.hover();
    const folderAdd = folderRow.locator(".shell-tree-folder-add");
    await expect(folderAdd).toBeVisible();
    expect(await folderAdd.getAttribute("title")).toBe("在这个文件夹里新建文件");
    await folderAdd.click();
    const menu = page.locator(".shell-menu");
    await expect(menu).toBeVisible();
    const items = (await menu.locator("[role^='menuitem']").allTextContents()).join(" | ");
    expect(items).toContain("新建文档");
    expect(items).toContain("新建表格");
    expect(items).toContain("新建演示");
    await page.keyboard.press("Escape");

    // The folder toggle's accessible name is the interpolated one, in Chinese
    // order: "<name>，N 个文件" rather than "<name>, N files".
    const folderAria = await attr(page, ".shell-tree-folder-toggle", "aria-label");
    expect(folderAria).toMatch(/，\d+ 个文件$/);
  });

  test("status bar, tab strip and the agent panel", async ({ page }) => {
    await open(page, "C6" as Combination, SESSION);

    expect(await text(page, ".shell-device")).toContain("在这台电脑上");
    expect(await attr(page, ".shell-tabstrip", "aria-label")).toBe("已打开的文件");
    expect(await attr(page, ".shell-tab-close", "title")).toBe("关闭");
    expect(await attr(page, ".shell-tab-close", "aria-label")).toMatch(/^关闭 /);

    // The save chip reads one of the two states, both translated.
    expect(await text(page, ".shell-save-state")).toMatch(/^(已保存|未保存)$/);
    expect(await text(page, ".shell-share")).toBe("分享");

    // Docked agent column: header, empty state, and the status live region.
    expect(await attr(page, ".shell-agent", "aria-label")).toBe("Agent 对话");
    const live = await text(page, "[role='status']");
    expect(live, `agent status live region: ${live}`).toMatch(HAN);
  });

  test("Editor Home: headings, type filter and the blank-document buttons", async ({ page }) => {
    await open(page, "C4" as Combination, SESSION);

    expect(await text(page, ".shell-home-head h1")).toMatch(/^(最近|已固定)$/);
    const actions = await page.locator(".shell-home-new").allTextContents();
    expect(actions.map((entry) => entry.trim())).toEqual([
      "空白文档",
      "空白表格",
      "空白演示",
      "从这台电脑打开",
    ]);

    // Column headers of the comfortable list.
    const headers = await page.locator(".shell-list thead th").allTextContents();
    expect(headers.map((entry) => entry.trim()).filter(Boolean)).toEqual([
      "名称",
      "所在文件夹",
      "最近打开",
      "固定",
    ]);

    // The time buckets come from `fileTreeModel`, which is not a component —
    // this is the check that the model went through `translate()` too.
    const groups = (await page.locator(".shell-list-group th").allTextContents()).join(" | ");
    expect(groups, `time buckets: ${groups}`).toMatch(/今天|过去 7 天|过去 30 天|更早/);
  });

  test("Agent Home: the highlights shelf and the file band", async ({ page }) => {
    await open(page, "C2" as Combination, SESSION);

    expect(await text(page, "#shell-highlights-title")).toBe("功能亮点");
    const captions = await page.locator(".shell-highlight-caption strong").allTextContents();
    expect(captions.join(" | ")).toMatch(HAN);
    expect(await attr(page, ".shell-highlight-card", "aria-label")).toMatch(/^播放 /);

    expect(await text(page, ".shell-home-subhead")).toMatch(HAN);
  });
});

/* =========================================================== en-US */

test.describe("en-US is byte-for-byte what it was", () => {
  test.use({ locale: "en-US" });

  /**
   * Every string the six earlier fix specs select on, plus the ones S5 listed
   * as the shell's largest surfaces. If this block goes red, a translation
   * changed an English value and W1-A … W2-G are about to go red with it.
   */
  test("the selectors the other fix specs depend on", async ({ page }) => {
    await open(page, "C2" as Combination, SESSION);

    expect(await attr(page, ".shell-nav-toggle", "aria-label")).toBe("Collapse sidebar");
    expect(await attr(page, ".shell-window-close", "title")).toBe("Close window");

    // fix-w1a / fix-w1b select the mode menu by these two names.
    await page.locator(".shell-brand").click();
    await expect(page.getByRole("menuitemradio", { name: "Agent" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Editor" })).toBeVisible();
    await page.keyboard.press("Escape");

    // fix-w1c selects "New folder" and "Settings" by accessible name.
    await expect(page.getByRole("button", { name: "New folder" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" }).first()).toBeVisible();

    const items = await page.locator(".shell-sidebar-item span").allTextContents();
    expect(items).toContain("Home");
    expect(items).toContain("New task");
    expect(await text(page, ".shell-tree-section-head span")).toBe("Folders");
    expect(await text(page, "#shell-highlights-title")).toBe("Feature highlights");
  });

  test("tab strip, status bar and the list header keep their English", async ({ page }) => {
    await open(page, "C6" as Combination, SESSION);

    expect(await attr(page, ".shell-tabstrip", "aria-label")).toBe("Open files");
    expect(await attr(page, ".shell-tab-close", "title")).toBe("Close");
    expect(await text(page, ".shell-share")).toBe("Share");
    expect(await text(page, ".shell-device")).toContain("On this computer");
    expect(await attr(page, ".shell-agent", "aria-label")).toBe("Agent conversation");

    // fix-w2f selects both of these by name when the strip overflows.
    for (const name of ["Scroll tabs left", "Scroll tabs right"]) {
      const control = page.getByRole("button", { name });
      if (await control.count()) await expect(control.first()).toBeAttached();
    }
  });

  test("Editor Home still reads the four English column headers", async ({ page }) => {
    await open(page, "C4" as Combination, SESSION);

    // fix-w2e asserts the column split against exactly these labels.
    const headers = (await page.locator(".shell-list thead th").allTextContents()).map((entry) =>
      entry.trim(),
    );
    expect(headers.filter(Boolean)).toEqual(["Name", "Folder", "Last opened", "Pin"]);

    // fix-w2e also clicks `getByRole("button", { name: "Group by" })`.
    await expect(page.getByRole("button", { name: "Group by" })).toBeVisible();

    const groups = (await page.locator(".shell-list-group th").allTextContents()).join(" | ");
    expect(groups).toMatch(/Today|Previous 7 days|Previous 30 days|Earlier/);
  });
});

/* =========================================================== layout */

test.describe("Chinese copy does not break the rows it sits in", () => {
  test.use({ locale: "zh-CN" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  });

  test("sidebar rows and tree rows stay on one line and keep W2-E's truncation", async ({
    page,
  }) => {
    await open(page, "C6" as Combination, SESSION);
    await settle(page);

    await expectSingleLine(page.locator(".shell-tree-folder-toggle span").first(), "folder name");
    await expectSingleLine(page.locator(".shell-tree-file-open span").first(), "file name");

    // The status bar is the narrowest strip in the shell and the one S1 found
    // mixing a clipped Chinese file name with English on the right.
    await expectSingleLine(page.locator(".shell-statusbar-facts span").first(), "status file name");
  });

  test("no covered row overflows its own box horizontally without clipping", async ({ page }) => {
    await open(page, "C4" as Combination, SESSION);
    await settle(page);

    // Home's list is a table with a declared column split (W2-E). A wider
    // Chinese header must not push the table past its container.
    const spill = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>(".shell-list");
      const host = table?.parentElement;
      if (!table || !host) return null;
      return {
        table: table.getBoundingClientRect().width,
        host: host.clientWidth,
      };
    });
    expect(spill, "the file list is on the page").not.toBeNull();
    expect(spill!.table).toBeLessThanOrEqual(spill!.host + 1);
  });

  test("the sidebar's buttons stay inside the rail", async ({ page }) => {
    await open(page, "C2" as Combination, SESSION);
    await settle(page);

    const overflow = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("#shell-sidebar");
      if (!sidebar) return null;
      const bounds = sidebar.getBoundingClientRect();
      return [...sidebar.querySelectorAll<HTMLElement>(".shell-sidebar-item")]
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { text: node.textContent?.trim() ?? "", spill: rect.right - bounds.right };
        })
        .filter((entry) => entry.spill > 1);
    });
    expect(overflow, "sidebar rows inside the rail").toEqual([]);
  });
});

/**
 * W3-J — the shell speaks the reader's language, and only the reader's.
 *
 * Three questions, and they are not the same one:
 *
 *   1. Under `zh-CN`, do the r10 surfaces actually render Chinese? A key added to
 *      `shellWorkspace.ts` / `shellSettingsPage.ts` but never wired into the
 *      component looks exactly like a translation nobody wrote.
 *   2. Under `en-US`, is every one of those surfaces still the English the
 *      prototype wrote? The other fix specs select elements by their English
 *      `title` / `aria-label` / text, so rewording one while "adding i18n" takes
 *      the regression gates down with it — a worse outcome than the English-only
 *      shell this track set out to fix.
 *   3. Does the Chinese fit? §04's truncation rule is that navigation rows, tree
 *      nodes, tabs and file names each clip on one line while body copy wraps, and
 *      a longer label is the thing most likely to undo that.
 *
 * What changed from the pre-r10 version of this file: the surfaces. There is no
 * window bar (each column has its own 40px row), no mode menu, no status bar, no
 * folder tree of files, no `.shell-*` anything. The Chinese claims moved to the
 * r10 equivalents — the 244px band, the sidebar's New / Local / Projects, Home,
 * Local, the document tabs, the Settings page — and the settings dropdown's two
 * preferences are now rows under General rather than under Appearance.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w3j.spec.ts
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

import { open, settle } from "./r10-c-helpers";

/** Any CJK ideograph. The cheapest honest answer to "is this Chinese?". */
const HAN = /[一-鿿]/;

async function attr(page: Page, selector: string, name: string): Promise<string> {
  return (await page.locator(selector).first().getAttribute(name)) ?? "";
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).first().textContent()) ?? "").trim();
}

/**
 * A row is one line tall, and its text is either short enough or clipped.
 *
 * Measured rather than eyeballed: `scrollWidth > clientWidth` with an ellipsis is
 * the *working* state — the label is longer than the box and the box says so. The
 * failure this guards against is the opposite, a box that grew to fit (wrapping)
 * and pushed the rows below it out of alignment.
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
  // Two lines would be at least 1.8 line-heights of text box; the row itself
  // carries padding, so the comparison is against the text metric.
  expect(box.height, `${label} grew past one line: ${JSON.stringify(box)}`).toBeLessThan(box.lineHeight * 2.6);
  expect(box.whiteSpace, `${label} is allowed to wrap: ${JSON.stringify(box)}`).toMatch(/nowrap/);
  expect(box.overflow, `${label} lost its ellipsis: ${JSON.stringify(box)}`).toBe("ellipsis");
}

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

/* =========================================================== zh-CN */

test.describe("zh-CN renders the shell in Chinese", () => {
  test.use({ locale: "zh-CN" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  });

  test("the 244px band and the sidebar", async ({ page }) => {
    await open(page, "C1");

    // The band: traffic lights, the sidebar switch, the Logo Home tab (§02).
    expect(await attr(page, "#dx-global-controls [data-act=toggle-sidebar]", "aria-label")).toBe("隐藏侧栏");
    expect(await attr(page, "[data-act=window-close]", "title")).toBe("关闭窗口");
    expect(await attr(page, "[data-act=home]", "aria-label")).toBe("OfficeDex 首页");
    expect(await attr(page, "[data-act=home]", "data-tooltip")).toBe("首页");

    // The sidebar's two fixed rows, its Projects group and the tree itself.
    const rows = await page.locator("#dx-sidebar .dx-sidebar-main .dx-nav-item span").allTextContents();
    expect(rows.map((row) => row.trim())).toEqual(["新建", "本地文件"]);
    expect(await text(page, "#dx-project-group .dx-group-heading span")).toBe("项目");
    expect(await attr(page, "#dx-sidebar [role=tree]", "aria-label")).toBe("项目与对话");
    await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
    await expect(page.getByRole("button", { name: "项目库" })).toBeVisible();

    // The footer: an account row and a wordless settings button (§03).
    expect(await attr(page, "#dx-sidebar [data-act=account]", "aria-label")).toBe("账户");
    expect(await text(page, "#dx-sidebar [data-act=account] .dx-footer-label")).toBe("访客");
    expect(await attr(page, "#dx-sidebar [data-act=settings]", "aria-label")).toBe("设置");
  });

  test("Home: the one heading, Quick start, features and the Recent columns", async ({ page }) => {
    await open(page, "C1");

    expect(await text(page, ".dx-home h1")).toBe("今天想处理什么？");
    expect(await text(page, ".dx-quick-start-label")).toBe("快速启动");
    expect(await text(page, ".dx-feature-highlights .dx-section-heading h2")).toBe("新功能速览");
    expect(await text(page, ".dx-home-section:not(.dx-feature-highlights) .dx-section-heading h2")).toBe("最近打开");

    // The composer is the one input on Home, and its placeholder is the reader's.
    const placeholder = await attr(page, ".dx-composer textarea", "placeholder");
    expect(placeholder, `composer placeholder: ${placeholder}`).toMatch(HAN);

    // Recent's column headers, including "状态" — Home's list has five columns.
    const headers = (await page.locator(".dx-home-recent thead th").allTextContents()).map((entry) => entry.trim());
    expect(headers.filter(Boolean)).toEqual(["名称", "类型", "最近打开", "状态"]);
    expect(await attr(page, ".dx-home-recent table", "aria-label")).toBe("最近打开的文件");

    /*
     * The per-row status cell and the row's accessible name are both translated.
     * The fixture carries one dirty file and seven clean ones, so both states are
     * on screen at once and the check is that each renders as its own Chinese
     * phrase rather than one of them falling through to the key.
     */
    const statuses = (await page.locator(".dx-home-recent tbody tr td:nth-child(4)").allTextContents()).map((entry) =>
      entry.trim(),
    );
    expect(new Set(statuses)).toEqual(new Set(["已保存", "有未保存的修改"]));
    expect(await attr(page, ".dx-home-recent tbody tr", "aria-label")).toMatch(/^打开 /);

    // Quick start's icons are labelled "新建<类型>", with the type translated.
    const quick = await page.locator("[data-act=create-local]").first().getAttribute("aria-label");
    expect(quick, `quick start label: ${quick}`).toMatch(/^新建/);
    expect(quick).toMatch(HAN);
  });

  test("Local: the page header, search, Recent and My Files", async ({ page }) => {
    await open(page, "C3");

    expect(await text(page, ".dx-local-page > .dx-page-header h1")).toBe("本地文件");
    expect(await attr(page, "[data-local-search]", "placeholder")).toBe("搜索文件和文件夹");
    expect(await attr(page, "[data-local-search]", "aria-label")).toBe("搜索文件和文件夹");
    expect(await text(page, ".dx-local-recent h2")).toBe("最近打开");
    expect(await text(page, ".dx-local-breadcrumb h2")).toBe("我的文件");
    await expect(page.getByRole("button", { name: "打开" }).first()).toBeVisible();

    // The sort control, whose option list is the only place a "↓" is written.
    expect(await text(page, ".dx-local-sort span")).toBe("排序");
    expect(await attr(page, "[data-local-sort]", "aria-label")).toBe("排序本地文件");
    const headers = (await page.locator("#dx-local-results thead th").allTextContents()).map((entry) => entry.trim());
    expect(headers.filter(Boolean).map((entry) => entry.replace(/\s*↓$/, ""))).toEqual(["名称", "大小", "修改时间"]);

    // The two view buttons, which carry no text of their own.
    expect(await attr(page, "[data-act=local-layout][data-id=list]", "aria-label")).toBe("列表视图");
    expect(await attr(page, "[data-act=local-layout][data-id=grid]", "aria-label")).toBe("网格视图");
  });

  test("the document tabs and the save / share row", async ({ page }) => {
    await open(page, "C5");

    expect(await attr(page, ".dx-document-tabs", "aria-label")).toBe("已打开的文档");
    expect(await attr(page, "[data-act=close-file]", "aria-label")).toMatch(/^关闭 /);
    expect(await attr(page, "[data-act=close-file]", "title")).toMatch(/^关闭 /);
    // A tab's tooltip says which context it belongs to (§18), in Chinese.
    expect(await attr(page, ".dx-tab-title", "title")).toMatch(/本地文件|对话 · /);

    // The save chip reads one of the two states, both translated.
    expect(await text(page, "[data-act=save]")).toMatch(/^(已保存|未保存)$/);
    expect(await attr(page, "[data-act=save]", "aria-label")).toMatch(/^保存 /);
    expect(await text(page, "[data-act=share]")).toBe("分享");
    expect(await attr(page, "[data-act=editor-command][data-id=present]", "aria-label")).toBe("放映");
    expect(await attr(page, "[data-act=editor-command][data-id=fullscreen]", "aria-label")).toBe("全屏");

    // The conversation column beside it, and the divider between the two.
    expect(await attr(page, "#dx-splitter [role=separator]", "aria-label")).toBe("调整对话栏宽度");
    expect(await attr(page, "#dx-workspace-toggle", "aria-label")).toMatch(/^(打开|关闭)工作区$/);
  });

  test("the project and chat menus behind the sidebar's ⋯", async ({ page }) => {
    await open(page, "C1");

    const project = page.locator("#dx-sidebar [data-project]").first();
    const manage = project.locator("[data-act=project-menu]");
    // The ⋯ is `opacity: 0` until its row is hovered or focused, so the hover is
    // part of the control rather than test noise.
    await project.locator(".dx-project-row").hover();
    await expect(manage).toBeVisible();
    // The control names the project it manages: "管理 <名称>".
    expect(await manage.getAttribute("aria-label")).toMatch(/^管理 /);
    await manage.click();
    const menu = page.locator("#dx-layers .dx-menu");
    await expect(menu).toBeVisible();
    const items = (await menu.locator("button").allTextContents()).map((entry) => entry.trim());
    expect(items).toEqual(["新对话", "重命名", "归档", "删除"]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    const chatRow = page.locator(".dx-chat-tree").first();
    const chat = chatRow.locator("[data-act=chat-menu]");
    // Same again: the row's ⋯ takes no pointer until the row is hovered.
    await chatRow.hover();
    await expect(chat).toBeVisible();
    expect(await chat.getAttribute("aria-label")).toMatch(/^管理 /);
    await chat.click();
    await expect(menu).toBeVisible();
    const chatItems = (await menu.locator("button").allTextContents()).map((entry) => entry.trim());
    expect(chatItems).toEqual(["重命名", "移动", "置顶", "归档", "删除"]);
    await page.keyboard.press("Escape");
  });

  test("the Settings page, including the two preferences that were menu rows", async ({ page }) => {
    await open(page, "C10");

    await expect(page.getByRole("heading", { name: "设置", level: 1 })).toBeVisible();
    expect(await text(page, ".dx-page-header p")).toBe("让 OfficeDex 按你的方式工作。");
    await expect(page.getByRole("navigation", { name: "设置" })).toBeVisible();

    const nav = (await page.locator(".dx-settings-nav button").allTextContents()).map((entry) => entry.trim());
    expect(nav).toEqual([
      "通用",
      "文件与存储",
      "模型",
      "连接与权限",
      "通知",
      "账户与用量",
      "商业授权",
      "关于与支持",
    ]);

    /*
     * The two preferences that used to be rows in the sidebar footer's dropdown.
     * That menu is gone; they are rows under General now, with the same words
     * they had in the menu.
     */
    await expect(page.getByRole("switch", { name: "减少动效" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "回车发送" })).toBeVisible();
    // The page is drawn inside the content region, so no menu is left standing.
    await expect(page.locator("#dx-layers .dx-menu")).toHaveCount(0);

    // A section heading and a row's one sentence, both in the reader's language.
    expect(await text(page, ".dx-settings-content h2")).toBe("通用");
    const sentence = await text(page, ".dx-setting-row p");
    expect(sentence, `first settings row sentence: ${sentence}`).toMatch(HAN);
  });
});

/* =========================================================== en-US */

test.describe("en-US is the English the prototype wrote", () => {
  test.use({ locale: "en-US" });

  /**
   * The same surfaces as the Chinese block, asserted as English.
   *
   * This is the half that protects the other specs: they select by accessible
   * name, and a translation that quietly reworded an English string would take
   * them down with it. Asserted here per surface rather than by naming the other
   * spec files, so this stays true while those are rewritten.
   */
  test("the band, the sidebar and the Settings door", async ({ page }) => {
    await open(page, "C1");

    expect(await attr(page, "#dx-global-controls [data-act=toggle-sidebar]", "aria-label")).toBe("Hide sidebar");
    expect(await attr(page, "[data-act=window-close]", "title")).toBe("Close window");
    expect(await attr(page, "[data-act=home]", "aria-label")).toBe("OfficeDex Home");

    const rows = await page.locator("#dx-sidebar .dx-sidebar-main .dx-nav-item span").allTextContents();
    expect(rows.map((row) => row.trim())).toEqual(["New", "Local"]);
    expect(await text(page, "#dx-project-group .dx-group-heading span")).toBe("Projects");
    expect(await attr(page, "#dx-sidebar [role=tree]", "aria-label")).toBe("Projects and conversations");
    await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" }).first()).toBeVisible();
    expect(await text(page, "#dx-sidebar [data-act=account] .dx-footer-label")).toBe("Guest");
  });

  test("Home and Local keep their English headings and columns", async ({ page }) => {
    await open(page, "C1");
    expect(await text(page, ".dx-home h1")).toBe("What would you like to work on?");
    expect(await text(page, ".dx-quick-start-label")).toBe("Quick start");
    expect(await text(page, ".dx-feature-highlights .dx-section-heading h2")).toBe("Hot and fresh features");
    expect(await text(page, ".dx-home-section:not(.dx-feature-highlights) .dx-section-heading h2")).toBe("Recent");
    const homeHeaders = (await page.locator(".dx-home-recent thead th").allTextContents()).map((entry) => entry.trim());
    expect(homeHeaders.filter(Boolean)).toEqual(["Name", "Type", "Last opened", "Status"]);

    await open(page, "C3");
    expect(await text(page, ".dx-local-page > .dx-page-header h1")).toBe("Local");
    expect(await attr(page, "[data-local-search]", "placeholder")).toBe("Search files and folders");
    expect(await text(page, ".dx-local-breadcrumb h2")).toBe("My Files");
    const localHeaders = (await page.locator("#dx-local-results thead th").allTextContents()).map((entry) =>
      entry.trim().replace(/\s*↓$/, ""),
    );
    expect(localHeaders.filter(Boolean)).toEqual(["Name", "Size", "Modified"]);
  });

  test("the tab strip and the save / share row keep their English", async ({ page }) => {
    await open(page, "C5");
    expect(await attr(page, ".dx-document-tabs", "aria-label")).toBe("Open documents");
    expect(await attr(page, "[data-act=close-file]", "aria-label")).toMatch(/^Close /);
    expect(await text(page, "[data-act=share]")).toBe("Share");
    expect(await text(page, "[data-act=save]")).toMatch(/^(Saved|Unsaved)$/);
    expect(await attr(page, "#dx-splitter [role=separator]", "aria-label")).toBe("Resize conversation");
    expect(await attr(page, "#dx-workspace-toggle", "aria-label")).toMatch(/^(Open|Close) workspace$/);
  });

  test("the Settings page keeps its English section names", async ({ page }) => {
    await open(page, "C10");
    const nav = (await page.locator(".dx-settings-nav button").allTextContents()).map((entry) => entry.trim());
    expect(nav).toEqual([
      "General",
      "Files & storage",
      "Models",
      "Connections & permissions",
      "Notifications",
      "Account & usage",
      "Commercial license",
      "About & support",
    ]);
    await expect(page.getByRole("switch", { name: "Reduce motion" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Enter to send" })).toBeVisible();
  });
});

/* =========================================================== layout */

test.describe("Chinese copy does not break the rows it sits in", () => {
  test.use({ locale: "zh-CN" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("officedex.locale", "zh"));
  });

  test("sidebar rows, project rows and conversation rows stay on one line", async ({ page }) => {
    await open(page, "C1");
    await settle(page);

    /*
     * The audit fixture carries a project whose name is a 60-character Chinese
     * sentence, chosen because CJK has no spaces: it wraps anywhere, and
     * `text-overflow: ellipsis` is the only thing holding the row together. It is
     * the worst case in the tree, so it is the one measured.
     */
    const names = await page.locator("#dx-sidebar [data-project] [data-act=toggle-project] .dx-ellipsis").allTextContents();
    const longest = names.reduce((a, b) => (b.length > a.length ? b : a), "");
    expect(longest.length, `no long project name in the fixture: ${JSON.stringify(names)}`).toBeGreaterThan(20);
    const index = names.indexOf(longest);

    await expectSingleLine(
      page.locator("#dx-sidebar [data-project] [data-act=toggle-project] .dx-ellipsis").nth(index),
      "long project name",
    );
    await expectSingleLine(page.locator(".dx-chat-tree [data-act=open-chat] .dx-ellipsis").first(), "conversation name");
    await expectSingleLine(page.locator("#dx-sidebar [data-act=account] .dx-footer-label").first(), "account name");
    await expectSingleLine(page.locator(".dx-home-recent .dx-recent-file-name .dx-ellipsis").first(), "recent file name");
  });

  test("the sidebar's rows stay inside its 244px column", async ({ page }) => {
    await open(page, "C1");
    await settle(page);

    const overflow = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("#dx-sidebar");
      if (!sidebar) return null;
      const bounds = sidebar.getBoundingClientRect();
      return [...sidebar.querySelectorAll<HTMLElement>(".dx-nav-item, .dx-project-row, .dx-chat-tree, .dx-footer-item")]
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { text: node.textContent?.trim().slice(0, 24) ?? "", spill: rect.right - bounds.right };
        })
        .filter((entry) => entry.spill > 1);
    });
    expect(overflow, "sidebar rows inside the column").toEqual([]);
  });

  test("the document tabs keep the long Chinese file name on one line", async ({ page }) => {
    await open(page, "C5");
    await settle(page);

    // The fixture opens a tab on a file whose name is the same long Chinese
    // sentence. A tab that wrapped would take the 40px row with it.
    const tabs = page.locator(".dx-file-tab .dx-tab-title .dx-ellipsis");
    const labels = await tabs.allTextContents();
    const index = labels.indexOf(labels.reduce((a, b) => (b.length > a.length ? b : a), ""));
    await expectSingleLine(tabs.nth(index), "long tab label");

    const strip = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>("#dx-content > .dx-tabs-strip")!;
      return { height: row.getBoundingClientRect().height, scroll: row.scrollWidth, client: row.clientWidth };
    });
    // §03: the top row is 40, and a long label does not make it taller.
    expect(strip.height, `the tab row grew to ${strip.height}px`).toBeLessThanOrEqual(40.5);
  });

  test("Local's table does not push past its own container", async ({ page }) => {
    await open(page, "C3");
    await settle(page);

    // Chinese column headers are wider per character; the table may scroll inside
    // its wrapper (it declares `min-width: 600px`) but the wrapper itself must not
    // spill out of the page.
    const spill = await page.evaluate(() => {
      const wrap = document.querySelector<HTMLElement>("#dx-local-results .dx-table-wrap");
      const host = wrap?.parentElement?.parentElement;
      if (!wrap || !host) return null;
      return { wrap: wrap.getBoundingClientRect().width, host: host.clientWidth };
    });
    expect(spill, "Local's file table is on the page").not.toBeNull();
    expect(spill!.wrap).toBeLessThanOrEqual(spill!.host + 1);

    // And the page itself does not scroll sideways (§03: "应用框架不横向溢出").
    const page_ = await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>(".dx-local-page")!;
      return { scroll: scroll.scrollWidth, client: scroll.clientWidth };
    });
    expect(page_.scroll, `Local scrolls sideways: ${JSON.stringify(page_)}`).toBeLessThanOrEqual(page_.client + 1);
  });

  test("Chinese body copy still wraps rather than clipping", async ({ page }) => {
    await open(page, "C10");
    await settle(page);

    // §04's other half: "正文、错误、帮助说明自然换行，不用单行省略隐藏操作后果".
    // A settings row's sentence is body copy, so it must NOT have the row
    // treatment the tree and the tabs get.
    const sentence = await page.locator(".dx-setting-row p").first().evaluate((node) => {
      const style = getComputedStyle(node);
      return { whiteSpace: style.whiteSpace, overflow: style.textOverflow };
    });
    expect(sentence.whiteSpace, `a settings sentence is clipped: ${JSON.stringify(sentence)}`).not.toMatch(/nowrap/);
    expect(sentence.overflow).not.toBe("ellipsis");
  });
});

# W1-D — 强制更新页

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ **未 commit**（四条 track 并发）

关掉 8 条 finding：**S0-001（P0）**、S8-001、S8-002、S8-003、S8-004、S8-005（其中的 notes/error 直出部分）、S8-006、S8-007。

---

## 一、改了什么

| 文件 | 性质 |
|---|---|
| `src/renderer/components/ForceUpdateOverlay.tsx` | 我拥有；重写渲染逻辑 |
| `src/renderer/styles/onboarding-update.css` | 我拥有；改 overlay 背景，补 `overflow-wrap`，新增 8 个 class |
| `src/renderer/components/ForceUpdateOverlay.test.tsx` | 组件自带单测，随组件改；5 → 11 个用例 |
| `src/renderer/i18n/en.ts` / `zh.ts` | **越界说明见下**；只在 `update.force.*` 段追加 14 个键 |
| `src/renderer/useAppUpdate.ts` | **越界说明见下**；两处 |
| `e2e/fix-w1d.spec.ts` | 新增，11 个用例，无任何条件 skip |

**没碰**：`src/shell/**`（含 `main.tsx`、`chrome/UpdateGate.tsx`、`dev/fixture.ts`）、`src/renderer/ui/**`。

### 两处越界的说明

**`src/renderer/useAppUpdate.ts`（同时服务 legacy 入口 `renderer/App.tsx:686`）** —— 改了两处，都是
S8-001/S8-002 的上游根因，不改则症状只在组件里被遮住：

1. `downloaded` 事件补 progress 到 total。原来只改 phase，真实链路下进度条会停在最后一个
   progress 事件的百分比（实测 fixture 是 38.94%）。这对 legacy 的更新横幅同样是修正而非行为变更。
2. `error` 事件与 `install()` 的 catch 里把 `autoInstallTriggeredRef` 复位。原来这个 latch 一旦
   烧掉就不再自动安装，于是「自动安装失败 → 用户点重试 → 下载完成 → 没人装、也没有按钮」会成为
   死胡同。这是 S8-002 的修法（见下）能成立的前提。

**`src/renderer/i18n/en.ts` / `zh.ts`** —— 新文案必须有键，`i18n.test.ts` 强制 en/zh 双向齐全。
改动全部是在 `// Force update overlay` 段尾**追加**，未动任何既有键，与其它 track 的冲突面最小。
**没有开 Wave 3-J 的 i18n 头**：`src/shell` 一个 `t()` 都没加。

---

## 二、逐条

### ① S0-001（P0）样式没进 shell 包 —— **关掉，构建产物层面已验**

`onboarding-update.css` 的 import 从「legacy 入口独有」挪成**组件自己的 import**
（`ForceUpdateOverlay.tsx` 顶部，带注释说明为什么不在入口）。`renderer/main.tsx:19` 的那行
**保留**：该文件同时供给 onboarding / runtime overlay / update banner 三组样式，删掉会连带砸了它们；
Vite 对同一模块的重复 import 是幂等的，构建产物可证（见第四节：`legacy-*.css` 里已经没有
`force-update` 规则了，它们被提到两个入口共享的 chunk 里）。

按 S5 表 5 的订正办（**并对 S5 的措辞做一处精确化**）：这个组件有**三个**调用点——
`chrome/UpdateGate.tsx:6`、`shell/main.tsx:31`（`?forceUpdate=` 预览）、`renderer/App.tsx:686`（legacy）。
前两个在同一个 shell 入口里，所以严格说 S0 原方案「往 `src/shell/main.tsx` 加一行」这一次**能**覆盖到它们；
S5 写的「加在入口只覆盖一个」不成立。但结论是对的、理由要换：**入口级 import 是一条会悄悄断掉的耦合**——
它已经断过一次（legacy 入口有、shell 入口没有，于是 shell build 少一份样式），
任何新入口、新调用点都会再断一次，而源码扫描看不出来。样式随组件走，一次覆盖全部，且不会漂移。

### ② S8-001 三个信号互相矛盾 —— **关掉**

组件里建立唯一真值源：一个 `view = {percent, barStatus, status, action}`，进度条、文案、按钮全部读它。
关键点：`downloaded` / `installing` 的 `percent` 由**phase 的定义**给出 `100`，不再由字节计数给出。
上游同时补了 progress（见越界说明 1），所以真实链路里字节计数也不会再停在 39%。

### ③ S8-004 错误态没有第二条出路 —— **关掉**

error 态现在有：
- 主按钮文案改为 **"Try again"**（与 available 的 "Update now" 不再逐字相同）；
- `.force-update-fallback` 区块：读 `release.assets`（`shared/types.ts:954`，此前 grep=0）渲染**手动下载链接**。
  按 `platform-arch` 键（`internal/appupdate/manager.go:591 platformKey`）按平台过滤；
  **不猜 arch** —— 浏览器分不出 Apple silicon 和 Intel（都报 "Intel Mac OS X"），所以同平台多个资源就都列出来带标签，
  猜错架构等于发一个打不开的包；
- **"Copy error details"** 按钮：把 `当前版本 → 目标版本 / phase / 错误原文` 拼好写进剪贴板，
  给用户一条能贴给支持的路径。这个按钮是**无条件存在**的第二出口——fixture 的 `previewRelease()`
  是 `assets: {}`，没有下载链接，而 `dev/fixture.ts` 属 A/B track 我不能改，所以「第二出路」必须不依赖 assets。
  带 assets 的下载链接分支由单测覆盖（`offers a second way out of the error state`）。

### ④ S8-003 三个 phase 逐像素相同 —— **关掉（选「区分」不选「合并」）**

七个 phase 现在各有一句自己的状态文案，e2e 里按 `{status, bar, buttons, links}` 签名做了互斥断言：

| phase | 状态行 | 进度条 | 按钮 |
|---|---|---|---|
| idle | "The update has not started yet." | 无 | Update now |
| checking | "Checking for the latest version..." | 无 | Checking...（disabled） |
| available | "Version 1.4.0 is ready to download." | 无 | Update now |
| downloading | "Downloading... 44 MB / 113 MB" | 39 | 无 |
| downloaded | "Download complete. Restarting..." | **100** | 无 |
| installing | "Restarting..." | 100 | 无 |
| error | "The update did not finish." + 错误块 + fallback 区 | 无 | Try again / Copy error details |

`checking` 的按钮 disabled——一个正在做事的 phase 不该再给一个「开始做这件事」的按钮。

### ⑤ S8-002 「Restart to install」按不到 —— **关掉**

把「谁负责触发安装」收敛成一个所有者：**`useAppUpdate` 负责**（mandatory 下自动装），
组件新增 `autoInstall?: boolean`，**默认 `true`**，为真时 `downloaded` 不画那个按钮——
一个永远按不到的控件是死控件，不是功能。默认取 `true` 的理由写在 props 注释里：
两个调用点（`UpdateGate.tsx:38`、`App.tsx:681`）都只在 `status.mandatory` 时渲染这一页，
而 mandatory 下 `useAppUpdate:156-162` 必然自动安装。按需安装的调用方传 `false` 就拿回按钮（单测覆盖）。

配套：上游 latch 复位（越界说明 2），否则「自动装失败 → 重试」会落进一个既不自动装、又没有按钮的洞。

### ⑥ S8-005 中英混排（服务端 notes 直出那部分）—— **关掉**

`release.notes` 现在包在 `.force-update-notes-block` 里，上面有一行本地化的小标题
（en "Release notes" / zh "更新说明（服务器原文）"）；`error` 同样加了
`.force-update-error-label`（zh "错误详情（原文）"）。句内混排变成「带标签的引文」，
读者知道那两块是别人写的原文，不再像本 app 自己说了两句英文。
**没有翻译服务端文本**，也没碰 shell 的硬编码英文（那是 Wave 3-J）。

### ⑦ S8-006 盖在空白上的 70% 蒙版 —— **关掉**

`.force-update-overlay` 的 `rgba(15,15,15,0.7)` + `backdrop-filter: blur(6px)` 换成不透明
`#3a3a3d`，去掉 blur。两个调用点都是**整片替换**（legacy `App.tsx:681` 的 early return 里只有
DialogHost/ToastHost + 本组件；shell `UpdateGate.tsx:38` 同理），背后从来没有东西可以压暗或模糊，
那层合成层是纯开销。CSS 里留了注释说明它是「页面」不是「蒙版」。

### ⑧ S8-007 notes 缺断词保护 —— **关掉**

`.force-update-notes` 补 `overflow-wrap: anywhere`，与同卡片的 `.force-update-reason`(:413)、
`.force-update-error`(:436) 对齐。e2e 里塞 109 字符无断点 URL 实测溢出从 6px 变 0px。

---

## 三、没关掉的

1. **S0 建议的构建期闸门没加。** S0-001 的根因是构建期 CSS 分块决定的，源码扫描看不见；
   S5 也把它写成了待加的两条 vitest（"a shell-reachable component's styles ship with the component"、
   "shell only imports visuals through renderer/ui"）。我这轮只出了**修复 + 一条 dev server 上的
   font-family 断言**，没有落「`dist/index.html` 链接的 CSS 必须包含 shell 可渲染组件的每条规则」这道
   构建后断言。理由：它属于 `scripts/` 与 vitest 闸门面，四条 track 并发时加 CI 闸门容易撞车；
   建议归 Wave 收口时统一加，位置与 `scripts/verify-packaged-runtime.mjs` 同类。
   **在它落地前，S0-001 的回归防线只有本报告第四节那条手工 grep。**
2. **S8-005 的另一半（shell 全硬编码英文）不在本 track。** 按边界要求只处理了服务端 notes/error 的句内混排。
3. **真实 updater 链路仍未跑通**（本机无 backend）。S8-002 的修法与 latch 复位都是在 fixture + 单测层面验证的，
   `downloading → downloaded → installing` 的真实时序没观察过——这条洞 S8 自己也记了。
4. **手动下载链接没有在 e2e 里跑过**（fixture 的 `previewRelease()` 是 `assets: {}`，而 `src/shell/dev/fixture.ts`
   不属于我）。该分支由单测覆盖。建议 A/B track 或 Wave 收口时给 fixture 的 preview release 塞两个假 asset。

---

## 四、构建验证（S0-001 的真正判据）

### 修改前（基线复现，命令与输出原样）

```
$ npx vite build            # exit=0

$ grep -l force-update dist/assets/*.css
dist/assets/legacy-BNqFKTHi.css

$ grep -o 'href="[^"]*\.css"' dist/index.html
href="./assets/useAppUpdate-Do5gRErF.css"
href="./assets/main-Cu7d9UsF.css"

$ grep -o 'href="[^"]*\.css"' dist/legacy.html
href="./assets/useAppUpdate-Do5gRErF.css"
href="./assets/legacy-BNqFKTHi.css"
```

→ `force-update` 只在 `legacy-*.css` 里，而 **`dist/index.html`（shell，默认入口）不链它**。S0-001 复现。

### 修改后

```
$ npx vite build            # exit=0

$ grep -l force-update dist/assets/*.css
dist/assets/useAppUpdate-C3XMWDoe.css

$ grep -o 'href="[^"]*\.css"' dist/index.html
href="./assets/useAppUpdate-C3XMWDoe.css"
href="./assets/main-q1unsCPg.css"

$ grep -o 'href="[^"]*\.css"' dist/legacy.html
href="./assets/useAppUpdate-C3XMWDoe.css"
href="./assets/legacy-BEq8cD3S.css"
```

→ 规则移进了**两个入口都链**的 `useAppUpdate-*.css`。

### 逐条确认 index.html 链接的 CSS 里**包含** force-update 规则

```
$ for css in $(grep -o './assets/[^"]*\.css' dist/index.html); do \
    n=$(grep -o 'force-update[a-z-]*' "dist/${css#./}" | sort -u | wc -l | tr -d ' '); \
    echo "$css -> $n distinct force-update-* selectors"; done
./assets/useAppUpdate-C3XMWDoe.css -> 21 distinct force-update-* selectors
./assets/main-q1unsCPg.css -> 0 distinct force-update-* selectors

$ grep -o 'force-update[a-z-]*' dist/assets/useAppUpdate-C3XMWDoe.css | sort -u
force-update-action
force-update-card
force-update-download
force-update-error
force-update-error-detail
force-update-error-label
force-update-fallback
force-update-fallback-heading
force-update-glyph
force-update-notes
force-update-notes-block
force-update-notes-heading
force-update-overlay
force-update-progress
force-update-progress-label
force-update-reason
force-update-secondary
force-update-status
force-update-title
force-update-version
force-update-version-current

$ grep -o '\.force-update-notes{[^}]*}' dist/assets/useAppUpdate-C3XMWDoe.css
.force-update-notes{font-size:14px;line-height:1.5;color:#37352f;margin:0;white-space:pre-line;overflow-wrap:anywhere}

$ grep -o '\.force-update-overlay{[^}]*}' dist/assets/useAppUpdate-C3XMWDoe.css
.force-update-overlay{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9999;background:#3a3a3d;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto}
.force-update-overlay{align-items:flex-start;padding:16px}
```

（第二条是 `@media (max-width:600px)` 那条，原有。）⑦ 与 ⑧ 在产物里也得到确认。

---

## 五、四项验证的真实输出

### 1. `npx tsc --noEmit`

```
$ npx tsc --noEmit; echo "tsc exit=$?"
tsc exit=0
```

### 2. `npx vitest run`

```
 Test Files  181 passed (181)
      Tests  1291 passed (1291)
   Start at  22:06:37
   Duration  12.55s
```

基线是 180 文件 / 1280 测试。**没有变少**：本 track 把 `ForceUpdateOverlay.test.tsx` 从 5 个用例
加到 11 个（+6）；另外 +1 个文件 / +5 个用例来自并发 track（本 track 未新增 vitest 文件）。
**0 skipped。**

### 3. 构建验证

见第四节，命令与输出原样贴出。

### 4. `e2e/fix-w1d.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3124 \
  OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/w1d \
  npx playwright test e2e/fix-w1d.spec.ts

Running 11 tests using 1 worker

  ✓   1 … › the stylesheet ships with the component (S0-001) (286ms)
  ✓   2 … › idle: bar, status line and buttons agree (S8-001, S8-003) (270ms)
  ✓   3 … › checking: bar, status line and buttons agree (S8-001, S8-003) (266ms)
  ✓   4 … › available: bar, status line and buttons agree (S8-001, S8-003) (272ms)
  ✓   5 … › downloading: bar, status line and buttons agree (S8-001, S8-003) (267ms)
  ✓   6 … › downloaded: bar, status line and buttons agree (S8-001, S8-003) (283ms)
  ✓   7 … › installing: bar, status line and buttons agree (S8-001, S8-003) (270ms)
  ✓   8 … › error: bar, status line and buttons agree (S8-001, S8-003) (267ms)
  ✓   9 … › no two phases render the same card (S8-003) (895ms)
  ✓  10 … › the error state has a second way out (S8-004) (336ms)
  ✓  11 … › server-authored release notes are labelled and can wrap (S8-005, S8-007) (264ms)

  11 passed (4.1s)
```

**11 passed / 0 skipped。** 这个 spec 里没有任何 `test.skip`、没有条件跳过、没有环境探测分支——
`grep -c "skip" e2e/fix-w1d.spec.ts` 只命中注释里解释「为什么不许有 skip」的那一句。

spec 断的四件事（对应要求）：
- 每个 phase 的**标题 / 状态行 / 进度条 / 按钮**互相一致；`downloaded` 断 `aria-valuenow === 100`；
- 7 个 phase 的 `{status, bar, buttons, links}` 签名两两不同（比截图 hash 更稳，且失败时能指名是哪两个撞了）；
- 错误态：可操作出口 ≥ 2、按钮文案不是 "Update now"、`Copy error details` 点下去真的变 "Copied"；
- `.force-update-title` 的 computed `font-family` 不含 `Times`，且 `.force-update-card` 实测宽 480px、
  overlay 背景不含 `rgba` —— 三条一起证明样式真的加载了（只断 font-family 的话，一条 `h1{font-family}` 也能骗过）。

dev server 用的是 3124（`npx vite --port 3124 --strictPort`），跑完已停；全程未碰 3100/3121/3122/3123，未用 `preview_*`。

# S0 — 搭建审计 harness

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 状态：完成，8 个 session 可开

## 交付物

| # | 交付物 | 位置 | 验证 |
|---|---|---|---|
| 1 | dev-only fixture 开关 + 壳状态 URL 参数 | `src/shell/dev/fixture.ts` | `src/shell/dev/fixture.test.ts` 15 条通过 |
| 2 | 审计数据集（空文件夹 / 45 文件 / 超长中英文名 / 7 标签 / 五种任务态） | `src/shell/port/fake/auditSeed.ts` | e2e 冒烟第 2 条 |
| 3 | 种子任务支持 | `fakeAgent.ts` `createFakePort.ts` 各加一个可选项 | 同上 |
| 4 | 共享 dev server（3100，playwright baseURL 默认值） | `.claude/launch.json` 的 `ui-audit` | 已起 |
| 5 | 采集与断言骨架 | `e2e/ui-audit-helpers.ts` | e2e 冒烟 4/4 |
| 6 | 更新页 phase 预览 | `?forceUpdate=<phase>` | e2e 冒烟第 3 条 |
| 7 | 产出目录 S0–S8 | `docs/ui-audit-2026-09-19/` | — |

回归：`npx vitest run` 180 文件 / 1280 测试全过；`tsc --noEmit` 退出 0。

## 给各 session 的入口

```
http://localhost:3100/?shellFixture=1&shell=C7
```

`shell=C1..C10` 是 PLAN 第 2 节的十个组合。单轴参数写在后面会覆盖它：
`mode=agent|editor`、`home=1|0`、`nav=collapsed|expanded`、`presence=docked|floating`。
`?forceUpdate=idle|checking|available|downloading|downloaded|installing|error` 单独渲染更新页。

fixture 下不写 localStorage：每次都从 URL 起步，上一个 session 的残留不会污染下一个。

---

## 发现

### [S0-001] 打包后的 shell 里，强制更新页没有任何样式

- 壳组合：不适用（这一页替换整个应用）
- 运行环境：`vite build` 产物；`?forceUpdate=downloading` 在 3100 上同样复现
- 表面：`UpdateGate` → `ForceUpdateOverlay`
- 复现：`npx vite build`，然后看 `dist/index.html` 链了哪些 CSS
- 现象：黑底、Times 衬线、布局塌掉。标题、版本行、进度条、按钮全部无样式
- 证据（构建产物层面，非推断）：

  | 文件 | 链接的 CSS |
  |---|---|
  | `dist/index.html`（**shell，默认入口**） | `useAppUpdate-*.css`、`main-*.css` |
  | `dist/legacy.html` | `useAppUpdate-*.css`、`legacy-*.css` |

  `grep -l force-update dist/assets/*.css` → **只有 `legacy-*.css`**，而 index.html 不链它。
  对照：`od-toast-host` 在 `useAppUpdate-*.css` 里，index.html 有链，所以 toast 是有样式的。

- 根因：`src/renderer/styles/onboarding-update.css` 只被 legacy 入口 `src/renderer/main.tsx:19` import。
  shell 入口 `src/shell/main.tsx` 从未引它，而 `chrome/UpdateGate.tsx:40` 会渲染这个组件。
- 类别：legacy 组件进 shell 未带样式 ｜ 严重度：**P0**
- 为什么是 P0：这是后端拒绝旧版本时**用户唯一的出路**。每个版本落后的用户都会撞上它，
  而它现在长得像一个崩溃页面，上面还有一个他们必须点的按钮。
- 同根因其它实例：**恰好 1 个**。shell 用到的其它 legacy UI 全部来自 `renderer/ui`，
  而 `renderer/ui/index.ts:1-2` 自己 import 了 `tokens.css` 与 `components.css`，所以 Modal / Input /
  ToastHost 都带样式。`ForceUpdateOverlay` 是唯一一个绕过 `renderer/ui` 又需要 CSS 的。
- 修复：`src/shell/main.tsx` 加一行 `import "../renderer/styles/onboarding-update.css";`
- 闸门（不能只修不加）：现有的按源码扫描无法发现这类问题——它是构建期的 CSS 分块决定的。
  建议加一条构建后断言：`dist/index.html` 链接的 CSS 合起来必须包含 shell 可渲染的每个组件的规则，
  至少先覆盖 `force-update`。放在 `scripts/` 下，与 `verify-packaged-runtime.mjs` 同类。

**本条未修**，按 PLAN 第 5 节的纪律走：根因聚类后成批修、配闸门。
它属于 S5 扫描第 5 条（shell 里 import `renderer/*` 的调用点）那一类，等 S5 出完整清单一起处理。

---

## 实测推翻的三处 plan 假设（PLAN 已同步修正）

1. **`AgentStatus` 里没有 "failed"。** 契约是 idle / reading / writing / working / paused /
   awaiting-review / done，失败是 `AgentEvent` 的 `kind: "error"`（走 toast），不是任务行的状态。
   原 plan 要 S3/S6 截「失败的任务行」，那是契约表达不了的东西。
2. **文件类型是 3 种不是 4 种**：`FileType = "doc" | "sheet" | "slides"`。
3. **更新页的语言取决于系统**：`renderer/i18n/index.tsx:16` 按 `navigator.language` 选，
   中文系统才是中文。所以「英文壳 + 中文更新页」只在中文系统上成立——用户的机器上成立，
   英文环境下两边都是英文。原文断言得太死。

# 设计基准原型

本产品 UI 的唯一设计基准。

| | |
|---|---|
| 文件 | `OfficeDex-Final-Light-Preview-2026-09-17.html` |
| 版本日期 | 2026-09-17 |
| 大小 | 27,640,784 bytes（内嵌全部 base64 资源） |
| sha256 | `8721b597971ebe492f47525b5c9d8d4659aae7ba9fc2f17292ad8853a46ca675` |
| 当前位置 | 本机 `~/Documents/officedex/`（**不在版本控制里**，见下） |

## 为什么它不在仓库里

27MB 的单文件二进制式产物进 git 会永久留在历史里，而它只此一份、不会反复改。
**日常开发不需要它** —— 它的令牌已经抠进 `src/shell/tokens.css`，那份文件才是可核对、
可 diff、可写进闸门的基准。

所以当前的约定是：

- **写代码时以 `src/shell/tokens.css` 为准**（它是原型的机器可读投影）
- 原型本身只在两种情况下需要：新增原型里已有但尚未落地的表面、或对某个值的来源存疑时回查
- 需要时向本仓库维护者索取；用上表的 sha256 确认拿到的是同一版

## 抠取方法（供将来换版时复用）

**必须读 computed styles，不能读样式表。** 原型叠了十三层 CSS，后面的层会静默覆盖前面的 ——
直接读源码会得到一批永不生效的规则（例如它的 Home 布局写在 `workspace-mode.css`，
实际被 `workspace-layout.css` 整个盖掉）。`src/shell/tokens.css` 开头记录了这件事。

## 从原型核到的关键值（与 `tokens.css` 逐值一致）

```
--ink:          #41464b        墨色
--shell:        #f5f6f8        壳体
--editor-accent:#596f86        强调
--line:         #e4e5e8        分隔线
--agent-panel-border: #d9dfe4
--nav-width:    190px          侧栏
--task-width:   320px          agent 列
--filebar-h:    32px           标签栏
--ui-font:      12px           正文
--ease:         cubic-bezier(.22, 1, .36, 1)
```

## 已作废的设计文档

2026-09-19 清理。以下两套值在原型里的命中数**均为 0**，全部是 legacy：

| 来源 | 宣称 | 处置 |
|---|---|---|
| `DESIGN.md`（821 行） | Notion 设计系统：`#5645d4`、Plus Jakarta Sans、DM Serif Display | **已删除** |
| 旧版 `CLAUDE.md` | 「Paper & Ink」：`#05101a`、`#006876`、`#fcfaf2`、`#e6e4d8` | **已改写** |

如果你在某份文档里又看到这些值，那份文档是过期的，以本文件与 `tokens.css` 为准。

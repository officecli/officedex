# OfficeDex develop/1.0 核心文档链路 E2E 测试报告

- 日期：2026-09-22（Asia/Shanghai，21:20–22:10）
- 被测：`officedex` @ `develop/1.0`，HEAD `6cd0e563fb23d6931a0973114ffc0401241d3ce2`
- 目标：验证「生成三种文档 + 图片」「编辑三种文档」这 7 项核心能力
- 新增自动化：`e2e/shell-core-matrix-real.spec.ts`（7 条，新 shell `/` + 真实 bridge）

---

## 1. 结论摘要

| # | 用户可见能力 | 结论 | 一句话 |
|---|---|---|---|
| 1 | 生成 Word（.docx） | ✅ 通过 | 51.3s 落盘 6873B，新 shell 打开真实 Writer |
| 2 | 生成 Excel（.xlsx） | ✅ 通过 | 39.8s 落盘 5394B，打开真实网格；**但合计公式错位**（缺陷 D-4） |
| 3 | 生成 PPT（.pptx） | ❌ **阻塞** | MOP worker 与 presentation SSR 清单漂移，**仓库自带 spec 同样红**（缺陷 D-2） |
| 4 | 生成图片 | ❌ **阻塞** | 上游 hosted 凭据拒绝：`Image generation is not enabled for this group`（缺陷 D-3） |
| 5 | 编辑 Word（.docx） | ❌ **缺陷** | 编辑器内改动已生效，**存盘失败** `DOCX export unavailable: docx-export-failed`（缺陷 D-1） |
| 6 | 编辑 Excel（.xlsx） | ✅ 通过 | 网格内输入 → 保存 → 从磁盘字节里读到新值（55s） |
| 7 | 编辑 PPT（.pptx） | ✅ 通过 | 对打开的 deck 下指令 → in-place 改动 → 导出落盘（2.3s，planner 打桩） |

**7 项中 4 项通过、3 项不通过。** 3 项不通过里有 1 项是产品缺陷（Word 存盘），
2 项是环境/依赖版本问题（PPT 生成、图片生成），两者都不在本仓库前端代码里，但都会
让「核心功能正常」这句话在今天的这台机器上不成立。

---

## 2. 被测对象与指纹

E2E 前必须核对实例而不是凭印象。本次没有走 devctl 实例（该 checkout 下没有
`scripts/devctl`），用的是仓库自带的 managed bridge：`npm run test:e2e`，它自己拉临时
bridge host + Vite，测完自收。

| 项 | 值 |
|---|---|
| 仓库 | `/Users/luyang/Workspace/shimo/vibe-officing/officedex` |
| 分支 / revision | `develop/1.0` / `6cd0e563fb23d6931a0973114ffc0401241d3ce2` |
| 工作区指纹 | **dirty：202 files changed, +5032 / −771**（含 `app_documents.go`、`internal/bridge/client.go`、`internal/localstore/store.go`、`internal/settings/store.go`、`real_client_e2e_host_test.go`、`src/canvas/*`、`src/shell/*`、`presentation-component/*`） |
| 应用版本 | `1.0.1`（`package.json` / `wails.json`） |
| officecli | `build/officecli/officecli`，`0.2.121`，**local-release 本地构建 2026-09-22T12:45:58Z** |
| Writer 组件 | `public/writer` @ `shimo/writer` `a7956d6499cb744e199d8c6892be27881ca818eb` |
| word2mow convert | `build/writer-convert/convert`，sha256 `921123ee…277e2` = 仓库 pin 的 `darwin-arm64` 构建（revision `18bf54a5`） |
| Presentation 组件 | `public/presentation` @ `4331187ac82ba8d15e2d7577fba6a8d1103d3011` |
| MOP SSR 运行时 | `presentation/dist-ssr`，builtAt `2026-09-20T15:06:02Z` |
| 提供方 | hosted（`platform.officecli.io`，uid 607，余额 999220） |
| 工具链 | Node 26.3.1 / npm 11.16.0 / Go 1.26.4 / Playwright chromium |

> **注意**：被测对象是「`develop/1.0` + 202 个文件的未提交改动」。若要看纯 commit
> 行为，需要 `git stash` 后重跑；本报告的所有结论都只对这一份工作区成立。

---

## 3. 测试方法

### 3.1 新增用例

`e2e/shell-core-matrix-real.spec.ts` 补的正是 `docs/test-cases.md` §19 里标注
「**新 shell 仍须手工**」的那几格：

| 用例 | 对应 TC | 断言强度 |
|---|---|---|
| generates a Word document… | TC-DOC-01 | 产物落盘 + `word/document.xml` 有正文 + Writer iframe 挂载 |
| generates a workbook… | TC-XLS-01 | 产物落盘 + `xl/*.xml` 有内容 + 网格 canvas 可见 |
| generates a presentation… | TC-PPT-01 | 产物落盘 + `ppt/slides/*.xml` 有内容 + `Unable to open this presentation` 计数为 0 |
| generates an image… | TC-IMG-01 | `/control/artifacts/latest` 报 `img` + 文件头是 PNG/JPEG/GIF/WebP |
| edits the Word document… | docx 在位修改 | 运行报告「Changes applied」+ **从磁盘字节里读到替换文本** |
| edits the workbook… | TC-XLS-02 | `SaveXlsxEditor` 响应 + **从磁盘字节里读到新单元格** |
| edits the presentation… | TC-EDT-01 | **从磁盘字节里读到新标题** + 未调用 `Generate` + `ExportPptxEditor` ≥ 1 次 |

设计要点（写进文件注释里了，这里简述）：

- **入口用 Home 的四个快捷提示**（"Write a document" / "Analyze a spreadsheet" /
  "Create a presentation" / "Create an image"）。Home 的 composer 是
  `showModeControls={false}`，「What this message makes」菜单和图片开关在 Home 上根本
  不渲染；快捷提示会把「文本 + 输出类型」一起写进 composer，是 Home 上唯一真实可点的
  四类入口。
- **每条用例都查磁盘**。「标签页出现了」一个草稿预览也能满足，「Generation Complete」
  曾经在一个打不开的文件上方亮着。所以生成类查包内 XML，编辑类查改动是否真的写回。
- **两个在位编辑只打桩 planner**，其余全真：Office.js 跑在真实内嵌编辑器里、真实导出、
  真实落盘。Word 的 planner 是 `StartAgentRun`/`GetAgentRun`，deck 的是 `PlanPptxJS`。
- **工作簿不需要打桩**：网格里敲的键就是网格里敲的键。

### 3.2 执行

```bash
cd officedex
npm run test:e2e -- e2e/shell-core-matrix-real.spec.ts            # 全量 7 条
npm run test:e2e -- e2e/shell-core-matrix-real.spec.ts -g "core editing matrix"   # 只跑编辑
```

harness 内部：`go test -tags real_e2e -run TestRealOfficeDexClientBridgeHost` +
`vite` + `playwright test`，`workers=1`。

---

## 4. 缺陷与阻塞

### D-1（P1，产品缺陷）Word 文档存不上盘：word2mow 与 Writer 的 MOW 表结构不一致

**现象**：生成的 `.docx` 在 Writer 里能打开、能改，运行也报告成功，但改动**写不回磁盘**。

- Agent 面板原文：`Changes applied — One change made to the document. They are not saved
  yet — DOCX export unavailable: docx-export-failed.`
- 标签页状态：`Unsaved changes`，点保存按钮仍然失败。

**根因**（来自 Playwright trace 里那笔请求的响应体，274 字节，非推测）：

```
POST /api/export → 400 Bad Request
word2mow convert failed (exit 1): error: convert MOW to DOCX failed:
translate document block to EGBody sequence failed:
translate document.children[9] (type='tbl'): decode tbl.attrs → CTTbl:
unknown tbl attr key: nodeId
```

Writer 组件（`a7956d64`）导出的 MOW 表格节点带了 `nodeId` 属性，而仓库 pin 的
word2mow converter（`build/writer-convert/convert`，sha256 与
`scripts/prefetch-word2mow-convert.mjs` 的 pin 完全一致，revision `18bf54a5`，
2026-09-05）的 `CTTbl` 解码器不认识这个键。

**证据链**：

1. converter 本身没坏：对同一份生成的 docx 跑 `convert roundtrip` 成功（8526B 输出）。
   坏的是 **Writer 产出的 MOW → convert export** 这一向。
2. `/api/export` 确实被调用了两次，两次都 400，响应体同上（trace `0-trace.network`）。
3. 与「改了什么」无关：报错节点是文档第 9 个 block（生成出来的 Readiness Matrix 表格），
   不是打桩替换的那段文字。**只要文档里有表格，就存不下来。**

**影响范围**：新 shell 与 legacy Word 工作台共用同一套 `internal/word2mowhttp` +
同一个 Writer 组件 + 同一个 converter，所以这不是新 shell 独有，而是**当前这份
develop/1.0 的三件套组合**的问题。任何含表格的 Word 文件都保存不了。

**修复方向**：把 word2mow converter 的 pin 升到 `CTTbl` 认识 `nodeId` 的构建；或在
writer 侧不再输出该属性。这属于依赖版本对齐，不是前端代码改动。

**用例现状**：`edits the Word document in place and writes it back` 保持红色，失败信息
会带上运行自己说的话（`The runtime said: … DOCX export unavailable: docx-export-failed.`），
**不要**把它改成绿色——它红的正是这条缺陷。

---

### D-2（P0，阻塞）PPTX 生成失败：officecli 的 MOP worker 与 presentation SSR 清单漂移

**现象**：四次尝试（两种 prompt：本用例的与仓库自带 spec 的）全部失败，两种失败形态，
其中两次是同一个硬错误：

```
content generation failed: MOP skill authoring failed: run MOP skill worker: exit status 1:
Error: dist-ssr/manifest.json has no bundle for
/packages/presentation-engine/src/capabilities/smartart/diagram-controller.ts;
rebuild it with presentation/scripts/build-ssr-runtime.mjs
```

**根因**（两个文件对不上，可逐条核对）：

| 位置 | 期望的 SSR entry |
|---|---|
| `officecli-internal/internal/runtime/pptx_mop_skill_worker.mjs:340`（编进本机 officecli 二进制） | `/packages/presentation-engine/src/capabilities/smartart/diagram-controller.ts` |
| `presentation/scripts/build-ssr-runtime.mjs:29`（`SSR_ENTRY_POINTS`）与 `presentation/dist-ssr/manifest.json`（9 个 entry） | `packages/presentation-engine/src/browser/adapters/diagram-adapter.ts` |

worker 按**源路径**查 bundle，清单里没有它要的那个路径 → 抛错。而且
`presentation/packages/presentation-engine/src/capabilities/smartart/` 下**根本不存在**
`diagram-controller.ts`（只有 `diagram-adapters` 在 `browser/adapters/diagram-adapter.ts`），
说明是本机 officecli 的 worker 比 presentation checkout 新——同一工作区里跨仓库版本漂移。

**不是我的用例或 prompt 的问题**：仓库自带的
`e2e/shell-pptx-generation-real.spec.ts`（TC-PPT-01 的官方自动化，prompt 用的是它自己的
那句）跑出来**同一个错误**：

```
test-results/real-e2e-canonical-pptx-213318 → 1 failed
```

另一次尝试越过了 authoring，死在内容校验：

```
content generation failed: PPTX expansion is incomplete; retained completed pages: 2/3 ready (page_failed)
.mop-assets/…-slide-3-a2-validation.json: {"error_class":"validation",
  "violations":["6 items overflow the outline's 3; merge or drop the weakest"]}
.mop-assets/…-recovery-…/decision.json: {"allow_whole_deck": false, "ready_pages": 2}
```

即 3 页里第 3 页超出大纲条目数被校验拒绝，运行选择**整份 deck 失败**而不是留下 2/3 页。
这是一条独立的、可以单独讨论的设计取舍（要不要降级交付），但它不是今天的主因。

**修复方向**：对齐 officecli 与本机 `presentation` checkout 的 revision；或按 worker 的
entry 列表重建 `presentation/dist-ssr`（`node presentation/scripts/build-ssr-runtime.mjs`）
后重新出 officecli。**PPT 生成在这台机器上现在是 100% 不可用。**

---

### D-3（阻塞，非本仓库代码）图片生成被上游拒绝

**现象**：请求发出后 6.1s 失败，运行把原因如实显示出来：

```
content generation failed: image generation failed: internal llm request failed: status=400
body={"error":"hosted_upstream_credential_invalid: shared upstream credential was rejected:
hosted upstream request failed: status=403 body={\"error\":{\"message\":
\"Image generation is not enabled for this group\",\"type\":\"permission_error\"}}"}
```

**客户端这一侧是对的**：bridge host 的
`artifacts/_app/home/Library/Application Support/officecli/agent-runtime/events.jsonl`
里能看到 `document_type":"img"` 的请求（1 次），composer 的图片模式、比例/分辨率/数量
三个下拉、`imageGeneration` 载荷都真实组装并发出去了。失败发生在 hosted 上游：
**这个 group 没有开通图片生成**。

**历史上是通的**：`test-results/real-e2e-20260829-123759-286-48180` 的 `generate-img`
在 2026-08-29 生成成功（29.5s，产物 `画一只猫咪.png`）。也就是说这是账号/上游权限在这
之后的变化，不是产品代码回归。

**修复方向**：给该 group 开通图片生成，或换一个有权限的凭据后重跑。
**在此之前「生成图片」无法被 E2E 判定为通过或失败。**

---

### D-4（P2，数据正确性）生成的预算表合计公式错位

生成的 `.xlsx` 本身是真表（10 个包内条目、有数字、有 `SUM` 公式），但行号错位：

| 行 | 内容 | 问题 |
|---|---|---|
| 4 | 表头 `Budget Line / Month 1 / Month 2 / Month 3 / Three-Month Total` | 正常 |
| 5 | **把表头又写了一遍**（A5:E5 与 A4:E4 同值） | 多出一行 |
| 6 | Personnel & Contractors，`B6=18500 C6=18500 D6=19200`，`E6=SUM(B5:D5)` | **合计的是表头那一行 → 0** |
| 7–9 | 其余数据行，`E7=SUM(B6:D6)` … | 各差一行 |
| 10 | Total，`B10=SUM(B5:B8)`、`E10=SUM(E5:E8)` | **含表头行、漏掉最后一行数据** |

这正是 `docs/test-cases.md` TC-XLS-01 里点名要盯的那个坑（「合计是数字不是共享字符串
导致的 SUM=0」）。生成能跑通，但**合计是错的**——按验收口径应当开缺陷，而不是记成通过。

---

## 5. 既有覆盖里已经过时的地方（本次顺带测出）

这几条不是产品缺陷，是测试资产与当前实现脱节，会让「已自动化」的清单说谎。

| 位置 | 现象 | 原因 |
|---|---|---|
| `e2e/deck-edit-routing-real.spec.ts`（2 条，TC-EDT-01 的官方自动化） | **两条都红**：`getByRole('textbox', { name: /Message Agent/ })` 找不到 | 该 spec 先切到 **Editor** 模式再打开 deck。而「停靠」只属于 Agent 模式（`effectivePlacement` / `canDock`，`shellReducer.ts:188`）：Editor 下 agent 是一个折叠的脸，composer 根本没挂载。修法：留在 Agent 模式打开文件（我的用例就是这么做并跑通的） |
| `e2e/shell-generation-real.spec.ts:136` | **红**：`.shell-statusbar` 不存在 | `SHEET_CHROME.ownsStatusBar = true`（`SheetCanvas.tsx:104`），`App.tsx:151,227` 因此**不渲染** shell 自己的状态栏。**注意这条断言在生成成功之后才失败**——生成与编辑器挂载都是过的，红的只是这条过时断言 |
| 三个 spec 里的 `.shell-skeleton-paper` 断言 | 恒为 0，**证明不了任何事** | 走真实 bridge 时 `createShellCanvas()` 永远返回非 null，骨架根本不会出现 |

**结论**：`docs/test-cases.md` §19 里「TC-EDT-01 已被 `deck-edit-routing-real` 端到端
覆盖」这句话今天不成立。本次新增的 `edits the presentation in place and writes it back`
（Agent 模式 + 磁盘校验）是当前唯一跑得通的 deck 在位编辑覆盖。

---

## 6. 通过项的细节与证据

| 用例 | 通过证据 | 产物 |
|---|---|---|
| 生成 docx | 51.3s；`word/document.xml` 抽出正文 > 600 字符（Release Readiness Memo，含 Executive Summary / Decision / Readiness Matrix）；`iframe.writer-embed-frame` 可见，无「The Word editor could not start」 | `…/20260922-212644-write-a-short-officedex-core-matrix-memo-bb112443/OfficeDex_Release_Readiness_Memo.docx`（6873 B） |
| 生成 xlsx | 39.8s；`xl/*.xml` 有内容；`.spreadsheet-canvas--error` 为 0、`.spreadsheet-canvas__loading` 为 0、`canvas` 可见 | `…/20260922-212722-…/OfficeDex_Core-Matrix_Budget.xlsx`（5394 B） |
| 编辑 xlsx | 55.0s；网格内敲入标记 → 点 `button.shell-save-state` → `SaveXlsxEditor` 200 → **磁盘字节里读到该标记** | 副本 `matrix-runner-xlsx.xlsx`（4295 B，含 `E2EMATRIX42`） |
| 编辑 pptx | 2.3s；指令发出后未调用 `Generate`，`ExportPptxEditor` 至少 1 次，**磁盘字节里读到 `Hello World`** | 副本 `matrix-runner-pptx.pptx`（8595 B，`ppt/slides/slide1.xml` 文本 = `Hello World`） |

编辑 pptx 那条还额外证实了产品的一个设计：planner 给的脚本读了比编辑器交给它的范围更大
的对象时，shell 会**停下来问**（「This plan reaches past your selection… Apply it to the
rest of the deck anyway?」），点 Apply anyway 才继续。这是对的，用例按流程回答了它。

---

## 7. 与「核心功能正常」的差距

按本次证据，`develop/1.0` 在**这台机器、这份工作区**上：

- 三件套的**生成**：2/3 可用（Word、Excel 可用；PPT 被依赖漂移挡住）
- 图片生成：不可判定（上游权限）
- 三件套的**编辑**：2/3 可用（Excel、PPT 可用；**Word 改动存不上盘**）

也就是说用户能拿到的完整体验是「生成 Word/Excel → 改 Excel/PPT」，而
「生成 PPT」「生成图片」「改 Word」三条主干今天都断着。其中 Word 存盘那条最危险：
**界面上看不出失败在编辑器里，只在任务面板里有一句 "They are not saved yet"**，用户很可能
以为改好了。

---

## 8. 产出与复现

- 新增用例：`e2e/shell-core-matrix-real.spec.ts`（7 条）
- 报告：本文件
- 运行目录（含 trace / video / 截图 / artifacts / 日志）：

| run | 目录 | 内容 |
|---|---|---|
| harness 冒烟 | `test-results/real-e2e-smoke-canvas-212302` | `shell-canvas-real` 2/2 绿 |
| 生成矩阵 | `test-results/real-e2e-matrix-gen-212638` | docx ✓ / xlsx ✓ / pptx ✘ / img ✘ |
| full matrix | `test-results/real-e2e-matrix-full-213717` | 7 条：3 绿 4 红 |
| 编辑矩阵 | `test-results/real-e2e-matrix-edit2-215546` | xlsx ✓ / pptx ✓ / docx ✘（D-1） |
| PPT 复现 | `test-results/real-e2e-matrix-pptx-retry-213107`、`test-results/real-e2e-canonical-pptx-213318` | 自带 spec 同样红（D-2） |
| 回归对照 | `test-results/real-e2e-regression-220055` | `deck-edit-routing` 2 红、`shell-generation` 状态栏断言红 |

复现 D-1 的最短路径：

```bash
npm run test:e2e -- e2e/shell-core-matrix-real.spec.ts -g "edits the Word document"
# 失败信息末尾会带上运行自己的话：
#   DOCX export unavailable: docx-export-failed.
# 完整响应体在 trace 里：
#   unzip -o test-results/real-e2e-matrix-edit2-*/playwright-output/*in-place-and-writes*/trace.zip -d /tmp/t
#   # 0-trace.network 里 /api/export 的 content._sha1 → resources/<sha1>.txt
```

---

## 9. 建议的下一步（按性价比排序）

1. **D-2（PPT 生成）**：对齐 officecli 与 `presentation` checkout 的 revision / 重建
   `dist-ssr`。这是唯一一条「重跑就能变绿」的阻塞项，修完可立刻验证 TC-PPT-01。
2. **D-1（Word 存盘）**：升 word2mow converter pin。它挡的是所有含表格的 Word 保存，
   影响面比 PPT 更大——用户是「以为存上了」。
3. **修 3 处过时断言**（`deck-edit-routing` 的 Editor 模式、`shell-generation` 的状态栏、
   三个 spec 的骨架断言），否则 §19 的覆盖表会继续报「已覆盖」。
4. **D-3（图片生成）**：属于账号/权限，需要人去开通，代码侧不用动。
5. **D-4（合计错位）**：归到生成运行时的表格写入逻辑，按 TC-XLS-01 开缺陷。
6. `docs/test-cases.md` §19 建议同步：把本次新增的 7 条挂到 TC-DOC-01 / TC-XLS-01 /
   TC-PPT-01 / TC-IMG-01 / TC-XLS-02 / TC-EDT-01，并把「新 shell 仍须手工」的措辞撤掉。

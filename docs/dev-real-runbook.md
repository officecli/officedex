# dev-real 真后端验证 runbook

来源：docx track（`local_45decb03-…`）实际走通的那条路，连坑一起记。
适用于任何需要**真编辑器 / 真 LLM / 真生成**的验证 —— 浏览器 fixture（3100 系列）到不了这些：
`createShellCanvas()` 在 `!hasDesktopBackend()` 时返回 null，画布退回骨架，
`?deckRun=1` 喂的是 port 的 `AgentTask`（任务面板）而**不是画布的 task store**。

## 起真后端

```bash
OFFICEDEX_E2E_NO_HMR=1 node scripts/dev-real.mjs --port 3214
```

- **`OFFICEDEX_E2E_NO_HMR=1` 是必须的。** 不加的话，并发 session 的热更新会在你测到一半时
  触发 `page reload src/shell/main.tsx`，整个会话作废。
- 启动约 22 秒。日志里 `│ bridge  http://127.0.0.1:<随机端口>` 就是桥地址，后面要用。
- **并行安全**：`RUN_DIR` 以前写死 `build/dev-real`（端口是参数但目录不是），谁后启动谁
  `rm -rf` 掉它，先启动那个的 SQLite 变成
  `attempt to write a readonly database (1032)`，所有 Generate/Modify 直接 500
  而日志里看不出真因。已由 xlsx track 改成 `build/dev-real-<port>`。
- **一个未查清的现象**：有实例约 9 分钟后自己死掉（ECONNREFUSED），另外两个跑半小时以上无事。
  脚本里已有 `-timeout 0`，不是 go test 超时。**原因不明，别误以为是自己代码的问题。**

## 打开页面

```js
location.href = "http://127.0.0.1:3214/shell.html"
```

坑：`127.0.0.1` 与 `localhost` 在预览标签页里**不总是可互换**。见过 3115 上
`127.0.0.1` 返回 `chrome-error://chromewebdata/` 而 `localhost` 正常，3213/3214 上又反过来。
**哪个不行换另一个，不要去查代码。**

## 触发一次真生成：直接打桥，不要走 UI

```bash
curl -s -X POST $BRIDGE/rpc/Generate -H 'content-type: application/json' \
  -d '{"documentType":"docx","topic":"Onboarding checklist",
       "prompt":"Draft a new-hire onboarding checklist covering week one, week two and the first month.",
       "noProject":true,"enableImages":false}'
# → {"ok":true,"result":{"taskId":"…","sessionId":"…","status":"running"}}  立刻返回
```

页面通过事件流自己接住这个 task，舞台就显形。**不需要在 UI 里点任何东西**，
因此也不会跟别人的 HMR 抢。docx 是单次 LLM 调用，比 pptx 便宜得多，整个 run 约 40–60 秒。

**如果非要走 UI，必须是真实点击。** 用 `element.click()` 合成点击去点快捷提示词，
composer 不会被填上（React 收不到），`canSend` 为假、`submit()` 早返回 ——
表现是「点了发送、输入框清空了、什么都没发生」，极易被当成产品 bug。

## 断言

```js
// 运行中
!!document.querySelector('.shell-doc-stage')                       // true
document.querySelector('.shell-doc-stage-phase')?.textContent      // "Generating document content"

// 交接完成
!!document.querySelector('.shell-doc-stage')                       // false
[...document.querySelectorAll('.shell-tab')].map(t => t.textContent)   // 多出一个新标签
document.querySelector('.shell-task-artifact')?.textContent        // "Xxx.docx / Saved on this computer / Open in Editor"
```

## 验「舞台从已打开文档手里接管画布」

这是舞台这个组件存在的理由，值得单独验一次：先登记并打开一份 docx，再发 Generate。

```js
// dev-real 只注册 preview token，不写 documents 投影，所以要手动登记
await fetch("/__officedex_bridge/control/file-dialog", {method:"POST",
  headers:{"content-type":"application/json"}, body: JSON.stringify({paths:["/tmp/x.docx"]})});
await fetch("/__officedex_bridge/rpc/OpenLocalFile", {method:"POST",
  headers:{"content-type":"application/json"}, body:"null"});
location.reload();
```

然后展开侧栏文件夹、**真实双击**文件行打开。

**等 Writer 渲染完要用这个信号，不要用固定 sleep**：

```js
document.querySelector("[data-canvas-host] iframe").contentDocument.body.innerHTML.length
// 272522   = 只有编辑器壳，文档还没渲染（界面停在「正在呈现文档...」）
// 1319785  = 文档真的渲染了
```

见过要 45 秒。中间那段很容易被误判成卡死。

## 两条既有缺陷，做截图取证时别误判

- **Writer 嵌入件的 `apply` 替换标题时会丢字符格式** —— 青色标题被替换后变成正文样式。
  属嵌入件自身（在 `src/renderer/word/WriterEditorFrame.tsx` 之外），未修。
  截图里标题样式不一致是它，不是舞台或编辑链路。
- **dev-real 里 Writer 的 DOCX 导出会失败**（`/api/export` 收到嵌入件给的 zip 报 400，
  表现为 `DOCX export unavailable: docx-export-failed`）。就地编辑因此保存不了，
  但**替换本身成功、撤销也成功** —— docx track 那条「apply 成功 / save 失败必须分开报」
  的设计就是被这个逼出来的。**别把它当成编辑失败。**

## 基线提醒：裸 worktree 上 tsc 不是 0 而是 12

`src/renderer/generated/wailsjs/**` 在 `.gitignore:36` 里，是 wails 生成物，**永远不在 HEAD**。
所以「`git worktree add` + `tsc --noEmit`」这套 A/B 归因方法的基线是 **12 条错**，不是 0。

解法（本轮各 track 用的）：建完 worktree 后把生成物拷进去。

```bash
git worktree add -q /tmp/x HEAD
ln -s "$PWD/node_modules" /tmp/x/node_modules
cp -R src/renderer/generated /tmp/x/src/renderer/     # ← 少这步会有 12 条假红
```

不拷的话别去追那 12 条，它们不是任何人的退化。

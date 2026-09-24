# OfficeDex P0 执行 Prompt（可直接复制）

四条互不依赖。同时开四个 session，墙钟约 45–60 分钟。
验收标准见 `docs/test-cases.md` 第 18 节。不要 `git add` / `commit`。

**总禁令（每条 prompt 已内嵌，这里是给人看的）：**

- 禁止裸跑 `npm run test:e2e`
- 禁止 `OFFICEDEX_E2E_RUN_HOSTED_PPTX=1` / `OFFICEDEX_E2E_RUN_HOSTED_GIF=1`
- 禁止跑旧 UI spec：`generation-real`、`shell-settings-real`、`pptx-stage-real`、`artifacts-preview-real`、`tiktok-ops-ui-generation`
- 禁止跑 `shell-outline-gate-real`、完整 `ui-audit-s*`
- 禁止 `killall` / `pkill` / 按端口杀未知进程
- 网络慢走 `http://127.0.0.1:7890`

---

## Prompt A — 签名包校验（约 5 分钟，不花额度）

```
你在仓库 /Users/luyang/Workspace/shimo/vibe-officing/officedex。只做签名包机械校验，不启动应用，不跑 Playwright，不改代码，不 git commit。

目标：勾掉 TC-PKG-01～07。TC-PKG-08 换机装机不在你的范围。

1. 找到当前要验的包（优先 dist-artifacts 里最新的同架构 DMG + 对应 build/bin/OfficeDex.app）。把实际路径写进报告。没有包就停，不要自己出包。

2. 跑：
   APP=<上面的.app>
   DMG=<上面的.dmg>
   bash ~/.agents/skills/officedex-signed-build/references/verify.sh "$APP" "$DMG"

3. 再按 ~/.agents/skills/officedex-signed-build/references/verification.md 跑第 5 项只读 SSR。禁止 `cp -R "$APP" /tmp/xxx.app`（macOS 会静默失败）。按该文档的 PROBE 拷贝方式。

4. 核对架构：officedex / officecli / mop-convert / node 都是目标 arch。

通过标准：verify.sh 全绿；SSR 不写进 bundle；事后 codesign --verify 仍过。

交回格式：
- APP / DMG 路径
- 每一项 PASS/FAIL + 关键输出摘录
- 失败就停，不要改产品代码去“修过”
```

---

## Prompt B — fixture 自动化（约 15–25 分钟，不花额度）

```
你在仓库 /Users/luyang/Workspace/shimo/vibe-officing/officedex。只跑新 shell fixture Playwright + 两个单测。不花额度，不启动真实 bridge，不改代码，不 git commit。

禁止：npm run test:e2e；任何 *real.spec.ts；ui-audit-s*；killall/pkill/按端口杀未知进程。
网络慢：export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890

步骤：

1. 确认 3153 空闲。被占用就换 3154，并在后续命令里改端口。不要杀别人的进程。

2. 启动 Vite（后台，不要用 wails / npm run dev）：
   npx vite --host 127.0.0.1 --port 3153 --strictPort
   等到 http://127.0.0.1:3153 可访问。

3. 跑这一批，不要加别的 spec：
   PLAYWRIGHT_BASE_URL=http://127.0.0.1:3153 npx playwright test \
     e2e/gates.spec.ts \
     e2e/fix-w1a.spec.ts e2e/fix-w1c.spec.ts e2e/fix-w1d.spec.ts \
     e2e/fix-w2f.spec.ts e2e/fix-w2g.spec.ts \
     e2e/fix-w3h.spec.ts e2e/fix-w3j.spec.ts e2e/fix-w5.spec.ts

4. 再跑：
   npx vitest run src/shell/test/deadControls.test.ts src/shell/test/copyRatchet.test.ts

5. 结束后只停你自己拉起的 Vite（用它的 PID），不要扫端口杀进程。

通过后可勾：TC-UPD-01、TC-SHL-01/02/04 几何与键盘、TC-FIL-04、TC-HOM-01、TC-SET-03、TC-CNV-02 铺满、TC-ENG-04/05/06。

交回格式：
- Playwright 摘要（passed/failed/skipped）
- 失败 spec 名字 + 失败断言原文
- vitest 结果
- 哪些 TC 可以勾
```

---

## Prompt C — 新 shell 真生成（约 25–45 分钟，花额度）

```
你在仓库 /Users/luyang/Workspace/shimo/vibe-officing/officedex。只跑新 shell、真实 bridge 的 5 条 Playwright。不改代码，不 git commit。

禁止：裸跑 npm run test:e2e；OFFICEDEX_E2E_RUN_HOSTED_PPTX/GIF；generation-real / shell-settings-real / pptx-stage-real / artifacts-preview-real / shell-outline-gate-real / tiktok-ops / ui-audit-s*；killall/pkill。
网络慢：export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890

只跑：
   npm run test:e2e -- \
     e2e/shell-canvas-real.spec.ts \
     e2e/shell-generation-real.spec.ts \
     e2e/shell-pptx-generation-real.spec.ts \
     e2e/deck-edit-routing-real.spec.ts \
     e2e/editor-write-permission-real.spec.ts

这条命令会自己拉临时 bridge + Vite，测完自己收。不要另开 npm run dev / wails dev。Playwright workers=1，不要拆成并行以免抢额度、抢 host。

通过后可勾：TC-FIL-01、TC-SHL-01、TC-CMP-01、TC-QST-01、TC-DOC-01、TC-PPT-01、TC-EDT-01、TC-CNV-03。
这些不要再让手工轨道重复，除非你这边红了。

交回格式：
- 5 个 spec 各自 PASS/FAIL
- test-results/real-e2e-* 目录路径
- 失败则贴关键日志/断言，不要重跑 hosted PPTX 去“再试一次”
- 哪些 TC 可以勾
```

---

## Prompt D — 签名包一条龙（约 30–40 分钟，花额度；补 C 盖不住的）

```
你在做 OfficeDex 发版 P0 手工验收。产品清单：/Users/luyang/Workspace/shimo/vibe-officing/officedex/docs/test-cases.md（第 18 节冒烟表 + 第 20 节已知边界）。
主入口是新 shell `/`，不是 /legacy.html。不改代码，不 git commit。

包：用已公证的 DMG，装进 Applications 再打开，不要从 DMG 直接跑，不要用本机 wails dev 代替装机。
账号：准备匿名额度 + 可登录各一。官方 Provider 探测只点一次（花额度）。

不要测：⌘S / ⌘N / ⌘,；Finder 拖入；拖侧栏宽度；⋯ 菜单里的导出/打印/版本历史（新 shell 没有这三项）；系统语言切换（首启恒 English）；图片/GIF/Report；大纲闸门。
Home Composer 进行中不变成 Stop —— 这是设计，取消走任务面板。不要当 bug。

按这个顺序一次做完，不要按编号跳：

1. 首次打开。不弹「无法验证开发者」。Home 可交互。首启语言必须是 English。About 版本与 DMG 文件名一致。
   → TC-INS-01/02、TC-PKG-08

2. 创建空白 Word / Excel / PPT → 三个标签能切 → ⌘W（无标签时不要拦截成关标签）。
   → TC-HOM-02、TC-CNV-01/02、TC-SHL-04/07
   Writer 英文：顶层选项卡真英文，其余允许 “Toolbar Font Bold” 这种 humanized key，不是缺陷。Excel 应整体英文。

3. Open from disk 打开本地 docx/xlsx/pptx；重命名、副本、置顶、移出库；新建/重命名/删除文件夹（非空文件夹里的文件进默认文件夹，磁盘文件不删）。
   → TC-FIL-01/03、TC-FOL-01

4. 设置（先别点官方 Provider 测试）：默认类型改 Word、通知开关+测试通知、外观、Check for updates、导出诊断日志、Runtime 表翻页/历史切换。
   → TC-SET-01/02/03、TC-UPD-02、TC-ADV-01 的非探测部分

5. 三个预开缺陷，确认一次就记，不要修：
   - 切到中文，点 Review changes 或 Highlights：标题仍是 “Not built yet” → TC-NBI-02
   - 打开 docx 改几个字不保存，再切语言：iframe 重载丢掉编辑 → TC-SET-03c
   - 让文件/任务列表读取失败（停 bridge 或断网）：界面长得像空工作区 → TC-ERR-01
   顺手：docx/xlsx/pptx 各开着切一次中文↔English（xlsx 不即时变，关掉重开）。→ TC-SET-03b
   再顺手：Advanced 自定义 provider，看 key 是否回填进 DOM、清空是否覆盖已存 key → TC-CMP-07（记缺陷，不挡 P0）

6. Composer 显式选 New document，发一条短 Word。产物必须是 .docx 不是 PPT。
   → TC-CMP-02
   若轨道 C 已绿 TC-DOC-01，不必再等一篇完整 Word。

7. 选 New presentation，确认立刻出现 Starting，然后立刻在任务面板 Cancel（不要等 Home Composer 变 Stop）。
   → TC-PPT-02、TC-PPT-06

8. 仅当轨道 C 的 shell-pptx-generation-real 没跑或失败时：再发一条短 PPT 等到完成并打开。否则跳过。
   → TC-PPT-01

9. 必做：短 Excel 生成并打开；再提一条改单元格的要求，完成后打开的是改过的那份（旁边出现 *.modified.xlsx 是约定，不是丢文件）。
   → TC-XLS-01、TC-XLS-02

10. 断网发一条 PPT，看失败原因和 Retry。
    → TC-PPT-07

11. 登录/登出（成功以 whoami 为准）；匿名额度用尽必须执行前拦截。
    → TC-ACC-01、TC-CRD-01

12. 最后点一次官方 Provider Test connection：必须先出花费确认框，确认后再出结果。
    → TC-ADV-01 剩余

交回格式：
- 按第 18 节清单逐条：PASS / FAIL / SKIP（注明因 C 已覆盖）/ 预开缺陷（单号或“待开”）
- 不要把第 20 节已知边界写成新 bug
- 三张预开缺陷各用 3 行写清：现象、复现、期望
```

---

## 调度（给人，不必贴给 agent）

同时开 A、B、C。D 用打好的 DMG，不要等 C 结束才装机；D 的第 8 步等 C 出 PPT 结果再决定做不做。C 绿了，D 就跳过完整 PPT 和完整 Word，把时间留给 Excel、取消、失败、登录、额度。

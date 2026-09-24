# Prompt：`docs/test-cases.md` 三处收尾修正

> 用法：整段复制给执行 agent。它是自包含的——不需要看过之前的审查对话。

---

## 任务

修改 `/Users/luyang/Workspace/shimo/vibe-officing/officedex/docs/test-cases.md`。这份产品验收清单刚经过一轮整改（727 → 935 行），覆盖缺口已基本补齐。复审发现**还剩三处需要收尾**，其中第一处是**事实性错误，且方向危险**（把不安全的行为写成了安全的）。

**只改这三处，不要顺手重写其他章节，不要调整编号，不要重新排序章节。**

工作目录：`/Users/luyang/Workspace/shimo/vibe-officing/officedex`（注意：`docs/test-cases.md` 目前是 untracked 文件，用普通文件读写即可，不要 git add/commit）。

---

## 修正 1（必须）：TC-CMP-07 —— 关于 provider key 的两句断言与代码相反

**位置：** 约第 348 行，`### TC-CMP-07 模型选择（P1）` 的「期望」段。

**现在的文本（整行替换）：**

```
**期望：** 选中的是当前 provider，后续任务走它。对话框是 write-only：重开时 key 字段为空、界面不回显明文。桌面端把 key 写入 `settings.llmProvider.apiKey`（设置文件，不是会话内存）；空 key 的更新会保留已存 key。自动化（新 shell fixture）：`e2e/ui-audit-s2.spec.ts`（几何，不断言存储）。
```

**问题：** 两个分句都不成立，而且互相矛盾。

1. **不是 write-only，key 会回填进 DOM。** 证据：`src/shell/settings/AdvancedControls.tsx:70` 用 `useState(() => remote ?? ...)` 播种、`:82` 在 remote 变化时 `setDraft(remote)`，`:245` 是 `value={provider.apiKey}`；`ImePasswordInput`（`src/renderer/components/ImeInput.tsx:97-107`）把 `ime.draftValue` 交给底层 `<PasswordInput>`。所以**真实 key 会以明文存在于 input value 与组件 state 中**——`type="password"` 只是视觉遮蔽，不是不回显。后端也不 redact：`internal/types/types.go:565-570` 的 `LlmProvider.APIKey` 是 `json:"apiKey"`，`internal/settings/store.go` 读取时原样返回。
2. **空 key 不会保留已存 key。** 保存是逐次按键即时触发（`AdvancedControls.tsx:88-94` 的 `handleChange` → `onSave(next)`，无提交按钮）；`internal/settings/store.go:218-219` 是 `out.LlmProvider = patch.LlmProvider`——**整体替换，无按字段合并**。清空 key 字段就会把已存 key 写空。

**替换为：**

```
**期望：** 选中的是当前 provider，后续任务走它。key 字段是 `type="password"`（视觉遮蔽），但**真实值会回填进 DOM 与组件 state**，不是 write-only；后端也不做 redact。桌面端把 key 写入 `settings.llmProvider.apiKey`（设置文件，不是会话内存）。保存为逐次按键即时触发，且 `internal/settings/store.go:218` 对 `LlmProvider` 是**整体替换**：清空 key 字段会覆盖掉已存 key，不会保留。

**待确认 / 按缺陷记：**
- 重开对话框时 key 不应回填明文（当前会回填）。
- 空 key 的保存不应覆盖已存 key（当前会覆盖）。

自动化（新 shell fixture）：`e2e/ui-audit-s2.spec.ts`（几何，不断言存储）。
```

---

## 修正 2（建议）：TC-SET-04 补一条凭据字段断言

**位置：** 约第 667-671 行，`### TC-SET-04 Connection（P1）`。

**理由：** Jira / Liquipedia 连接器**恰好做对了** provider 做错的那件事——`src/shell/settings/ConnectionSection.tsx:58` 的 secret 是独立 state、**不从存储播种**，`:104-115` 的注释还专门讨论了"空凭据字段是保留已存 secret 还是清除"。把这个正确行为写成断言，可以固定住与 Provider 的行为差异，防止将来被"统一"掉。

**在该节末尾（那段 `>` 引用块之后）追加：**

```
**凭据字段断言（与 TC-CMP-07 的 Provider 行为对照）：** secret 输入框**不得**回填已存 secret；空 secret 保存时应**保留**已存 secret 而不是清空。实现依据：`src/shell/settings/ConnectionSection.tsx:58`（secret 为独立 state，不从存储播种）、`:104-115`（空值的语义）。Provider 目前与此相反，见 TC-CMP-07。
```

---

## 修正 3（建议）：第 19 节表格区分 fixture 与真实 bridge

**位置：** 约第 856-891 行的表格「入口」列。

**理由：** 第 19 节的正文（约第 852 行）已经正确点名"走真实 bridge 的新 shell spec 只有 5 个"，但表格里 23 行仍统一写着「新 shell fixture」。fixture（回放/快照）不是发版界面，执行人容易把 fixture 通过误当成新 shell 已过——这正是这一节本来要防的误读。

**做法：** 把表格「入口」列中所有 `新 shell fixture` 改为 `新 shell fixture（非 bridge）`。共 23 处，可用一次全局替换完成。

**不要动**这几行（它们是真实 bridge，保持 `新 shell /` 或 `新 shell /?planMode=1`）：
`shell-canvas-real`、`shell-generation-real`、`shell-pptx-generation-real`、`shell-outline-gate-real`、`deck-edit-routing-real`。
也**不要动**标记为 `**旧 UI** /legacy.html` 的行。

提示：先 `grep -n "新 shell fixture" docs/test-cases.md` 确认命中 23 行且全部在表格内，再替换。

---

## 完成后自检

1. `grep -n "write-only\|不回显明文\|保留已存 key" docs/test-cases.md` —— 应为空（旧断言已清除）。
2. `grep -n "整体替换\|非 bridge" docs/test-cases.md` —— 应分别命中修正 1、修正 3 的结果。
3. `grep -c "新 shell fixture（非 bridge）" docs/test-cases.md` —— 应为 23。
4. TC-CMP-07 仍保留原有的 4 条操作步骤（1. 切换已配置 provider / 2. 添加自定义模型 / 3. 关掉对话框再打开编辑 / 4. 未登录跳账号页），只替换「期望」段，不要删步骤。
5. 文档总行数应在 935 基础上小幅增加（约 +8～12 行），不应大幅变化。

## 不要做的事

- 不要改产品代码。本次只改文档。修正 1 记录的是**待确认/缺陷**，不是要求修代码。
- 不要动 TC-SHL-09 —— 它已经正确写明"宽度不可拖，见 not-implemented.md"。
- 不要把修正 1 的问题删掉了事；必须留下"待确认 / 按缺陷记"两行，否则这条用例会失去价值。
- 不要 git commit。

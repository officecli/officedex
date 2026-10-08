# 期望输出文件名（`outputFileName`）：Go 侧已接通，renderer 侧待接线

对应 OfficeDex 1.0.11 验收 F03：用户在 prompt 里写明输出文件名（如 `ODQA-agent-result`），
产物却叫 `ODQA_Agent_File_Task.pptx`。根因是协议里没有「期望文件名」字段，runtime 一直用模型
生成的标题 slug 命名。

本分支（`feat/generate-output-filename`）只改 Go 侧；`src/` 一行未动，等 WT-B 的
`src/services/agent.ts` 大改收尾后再按下面的最小接线补齐。

## 协议语义（两端一致）

| 层 | 字段 | 说明 |
|---|---|---|
| renderer → Go（Wails `Generate`） | `GenerateInput.outputFileName?: string` | 可选，**不含扩展名**的文件名 |
| Go → officecli（agent bridge `office.generate` / `office.render` args） | `output_file_name` | 仅在非空时发送 |
| officecli CLI | `officecli new … --output-name <name>` | 同一语义 |

officecli 收到后：

- 用它替换标题 slug；扩展名仍由 `document_type` 决定（`ODQA-agent-result` → `ODQA-agent-result.pptx`）。
- 做清理：去首尾空白；若用户把匹配的扩展名也写上了（`deck.pptx`）则剥掉；`/ \ : * ? " < > |`
  换成 `-`；控制字符丢弃；首尾的 `.` 和空格裁掉；最长 80 个 rune。清理后为空则回退到 slug。
- 重名避让：同目录已有同名文件时写成 `<name>-2.<ext>`、`<name>-3.<ext>`…，preview 边车跟着实际落盘名走。
- 字段为空 → 行为与现在完全一致。

## Go 侧本分支已做

- `internal/types/types.go`：`GenerateInput.OutputFileName`（json `outputFileName,omitempty`）。
- `internal/bridge/client.go` `InvokeGenerate`：非空时 `args["output_file_name"]`。
- `internal/taskrecovery/input.go`：`EncodeGenerateInput` / `DecodeGenerateInput` 登记
  `output_file_name`（兼容 `outputFileName`），崩溃恢复重跑时名字不丢。
- 测试：`internal/bridge/client_test.go`（发送 / 未设置时不发送）、
  `internal/taskrecovery/input_test.go`（snake_case 键集合、round-trip、未设置不输出）。

`App.Generate` → `resolveGenerateInput` 是整体拷贝 `input`，字段自然透传，无需改 `app.go`。

## renderer 侧最小接线（留给 WT-B 收尾后）

1. `src/shared/types.ts` `GenerateInput`（约 294 行起）加：
   ```ts
   /** 用户点名的输出文件名，不含扩展名；officecli 用它替代标题 slug，重名时追加 -2/-3。 */
   outputFileName?: string;
   ```
   Wails 绑定按 JSON 反射透传，Go 结构体已有同名 tag，`src/renderer/generated/wailsjs` 不需要手改；
   `wails dev` / `wails generate module` 重新生成 `models.ts` 即可。

2. `src/services/agent.ts` 调 `api.generate({...})` 处（约 1086–1089 行，`topic: text.slice(0, 64)` 旁）透传：
   ```ts
   ...(requestedName ? { outputFileName: requestedName } : {}),
   ```

3. 从 prompt 抽取 `requestedName`。建议放在 `agent.ts` 里 `promptWithComposerContext` 附近，
   和 `inferHomeTaskRoute` 同层（都是「读用户原话」的纯函数），单独导出便于测试。只认**显式**措辞，
   宁可不抽也不要误抽：
   - 英文：`(?:named|name it|file ?name(?: is|:)?|save (?:it )?as|call(?:ed| it)|output (?:as|file))\s+["'“”‘’]?([^\s"'“”‘’,，。;；]+)`
   - 中文：`(?:文件名(?:为|是|叫|叫做|：|:)?|命名为|起名为|取名为|叫做|保存为|存为|输出为|名为)\s*["'“”‘’]?([^\s"'“”‘’,，。;；]+)`
   - 命中后：去引号；若末尾是已知扩展名（`.pptx .docx .xlsx .html .md .png .jpg .gif .pdf`）则剥掉
     （officecli 只剥与 documentType 匹配的那一个，renderer 这里多剥一层更稳）；长度 > 80 或只剩
     标点则放弃。
   - 不要把这句话从 prompt 里删掉：模型看到也无害，而且 officecli 自己还会用它。
   - 已知误抽风险：`叫做` 也会出现在「本产品叫做 X」这类描述里；若觉得过宽，先只上
     `文件名 / 命名为 / 保存为 / named / save as / file name` 这几个最硬的词。

4. 可选的 UI 提示：officecli `initialize` 返回的 `office.generate.input_schema` 里有
   `output_file_name` 键即表示当前二进制支持该字段，renderer 可据此决定是否显示「将保存为 X」。
   不支持时静默回退到 slug，不要报错。

## 兼容策略

- 字段两端都是可选。officedex 当前打包的是 officecli `0.2.121`（`package.json` `officecliVersion`），
  它的 `bridgeInvokeArgs` 用 `encoding/json` 解码、未开 `DisallowUnknownFields`，收到 `output_file_name`
  会**静默忽略**，行为与现在相同（仍按 slug 命名）。
- 新 officecli + 旧 officedex（不发该字段）：行为不变。
- 真正落到产物上需要两步：officecli-internal 这条分支发版，再把 `officecliVersion` 升上去。
  本轨只到代码与测试，发版另算。

## 验证记录（2026-10-08）

- officecli-internal `go test ./...`：除环境相关的
  `TestResolveMOPPresentationRootUsesPWDWhenGUICwdIsRoot`（期望 `../presentation` 相对仓库根，
  worktree 嵌在 `.claude/worktrees/` 下时路径不符，与本改动无关）外全部通过；
  `agent_bridge_baseline` 的两份 schema golden 已随字段刷新。
- officedex `go test ./...`：全部通过（`internal/word2mowhttp` 需要 staged 的
  `build/writer-convert/convert`，软链主检出后通过）。
- officedex `npx tsc --noEmit`：剩余 2 个错误均在 `src/renderer/spreadsheet/sheetSdk*.ts`
  （`strip` 不在 sdk-sheet 类型里），develop/1.0 主检出同样存在，与本分支无关。
- 真实二进制：`officecli new docx "ODQA Agent File Task" --output-name ODQA-agent-result --mode fast --no-publish --json`
  → `document_name: "ODQA-agent-result.docx"`，落盘文件同名。

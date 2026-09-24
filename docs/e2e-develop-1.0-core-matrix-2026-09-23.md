# OfficeDex develop/1.0 核心文档链路 E2E 测试报告

- 日期：2026-09-23（Asia/Shanghai，00:38–00:51）
- 被测：`officedex` @ `develop/1.0`，HEAD `6cd0e56`，工作区含未提交改动
- 目标：生成 Word / Excel / PPT / 图片，以及编辑这三种文档
- 自动化：`e2e/shell-core-matrix-real.spec.ts`（7 条，新 shell `/` + 真实 bridge）
- 入口：`OFFICEDEX_E2E_SKIP_PREFETCH=1 npm run test:e2e -- e2e/shell-core-matrix-real.spec.ts`
- 原始记录：`test-results/real-e2e-core-matrix-20260923/`

## 1. 结论

7 项里 5 项在同一次矩阵里通过。编辑三种文档全部通过，其中 Word 存盘用的是刚换上的 `convert`。生成 PPT 和生成图片这两项在本次矩阵里不通过，原因都不在客户端解码或 SSR 路径上。

| # | 能力 | 结果 | 证据 |
|---|---|---|---|
| 1 | 生成 Word | 通过 | 45.4s，落盘 7008B，打开真实 Writer |
| 2 | 生成 Excel | 通过 | 1.1min，落盘 5465B，打开真实网格。合计公式仍错位，见 §4 |
| 3 | 生成 PPT | 本次矩阵不通过 | 同一次跑被上游 429 打断（1/3 页）。空闲后重试仍不稳定，见 §3 |
| 4 | 生成图片 | 不通过 | 上游 403：`Image generation is not enabled for this group` |
| 5 | 编辑 Word | 通过 | 59.7s，磁盘读到替换文本，不再出现 `docx-export-failed` |
| 6 | 编辑 Excel | 通过 | 52.4s，网格改单元格后磁盘字节校验通过 |
| 7 | 编辑 PPT | 通过 | 3.8s，in-place 改标题后导出落盘 |

## 2. 这次先做的修复

`git.shimo.im` 恢复后，把认识 Writer `nodeId` 的 `word2mow convert` 编出来并换进 OfficeDex。

| 项 | 值 |
|---|---|
| word2mow HEAD | `289bdf45c051f7ad2d7907120b909c8561dd8d5d`（其上有未提交的 `nodeId` 导出跳过） |
| 新二进制 | `writer/apps/docx-demo/bin/convert`，以及 `officedex/build/writer-convert/convert` |
| sha256 | `3024c16b06a2c1438a8327d806228efcdecb3f3b564316106cdeeae4164c316a` |
| pin | `officedex/scripts/prefetch-word2mow-convert.mjs` 的 `darwin-arm64` |
| officecli | `0.2.121`（`local-build`，2026-09-22T16:00:49Z），未被 prefetch 换回发行包 |

`word2mow` 单测 `table_export_drops_writer_node_id_and_keeps_cell_text` 与 `table_export_still_rejects_unknown_attr` 通过。OfficeDex 侧在调用 `convert` 之前仍会丢掉 `nodeId`（Go 处理与 Vite 中间件各一条），未知键继续失败。Word 编辑 E2E 走的是 Vite 中间件 + 这份新二进制。

## 3. 生成 PPT

客户端路径已经能编出 deck。同一份 officecli 在 2026-09-23 00:08 的官方用例 `shell-pptx-generation-real.spec.ts` 通过，产物 `Product_Launch_Brief.pptx` 三页 XML 都非空（slide1 3345B、slide2 14520B、slide3 10200B）。矩阵用例在 00:12 的单独重试也通过过（`OfficeDex_Core_Matrix.pptx`）。

本次矩阵和随后的单独重试没有再出现 `diagram-controller.ts` 清单缺失或 `Controller requires an EditorModel`。失败是生成内容没过产品校验，整份 deck 不落盘：

| 跑次 | 结果 |
|---|---|
| 矩阵内（00:40） | `provider_rejected`，1/3 页。第 3 页 `gateway_concurrency_limit`（429），第 2 页被取消 |
| 单独重试（00:44） | 仍是 429，0/3 页 |
| 再等约 2.5 分钟后的重试（00:49） | 过了 429，审稿拒绝：第 3 页缺可见文本 `Decision ask` / `Action chips` |
| 紧接着的重试（00:50） | `page_failed`，2/3 页就绪。第 3 页校验：`6 items overflow the outline's 3` |

提示词只要求三页 brief（readiness、risks、next steps）。大纲条目数和可见文本是生成器自己写出来、再被整份拒绝的。这是生成质量门，不是 SSR 加载失败。

## 4. 其余两项缺陷

**图片生成。** 请求带了 `document_type: img`。上游返回 403 `permission_error`：`Image generation is not enabled for this group`，客户端包成 `hosted_upstream_credential_invalid`。代码侧没有可改的失败点。要这条变绿，需要给这把共享凭据所在的 group 开通图片生成。

**Excel 合计错位。** 生成用例本身通过，打开的是真实网格。抽查 `OfficeDex_Core-Matrix_Budget.xlsx` 的 `sheet1`：`E6=SUM(B5:D5)`，而 B5:D5 是表头行，数据从第 6 行开始。这是 2026-09-22 报告里的 D-4，本次未改。

## 5. 复现

```bash
cd officedex
OFFICEDEX_E2E_SKIP_PREFETCH=1 npm run test:e2e -- e2e/shell-core-matrix-real.spec.ts
```

`SKIP_PREFETCH` 用来保住本机编的 officecli。不设的话，`prefetch:officecli` 会按 `version.json` 里的 0.2.121 认为已经就位并跳过下载，当前这份 local-build 会留着；若版本记录对不上，发行包会盖掉它。

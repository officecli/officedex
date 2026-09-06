# OfficeDex 多产物产品验收矩阵

## 已实现并通过自动验证

| 能力 | 证据 |
| --- | --- |
| Excel / PPT / DOCX / HTML / Image 统一产物模型 | `src/shared/officeProduct.ts` 与对应 Vitest |
| Workbook Source / View / Output 数据血缘 | `internal/localstore/store.go`、`office_product_test.go` |
| Wails 产品图读写 API | `app_office_product.go`、TypeScript lint |
| Workbook fingerprint | `src/renderer/spreadsheet/workbookFingerprint.ts` 与测试 |
| 外部数据源身份和错误状态 | `workbookSource.ts` 与 `useVerticalPanels` 测试 |
| HTML App Spec 和 Vite 文件生成 | `htmlAppModel.ts`、`htmlAppRuntime.ts` 与测试 |
| 刷新影响计算、确认队列、执行器 | `officeRefresh.ts`、`refreshQueue.ts`、`refreshExecutor.ts` |
| PPT 刷新规划适配器 | `officeRefreshHandlers.ts` 与测试 |
| 项目首页产物列表 | `OfficeProductOutputsPanel.tsx`、`HomeScreen` 测试 |
| Credit 估算 | `src/shared/officeCost.ts` 与测试 |

## 仍需真实运行时验收

| 能力 | 当前边界 | 验收要求 |
| --- | --- | --- |
| Excel 保存后刷新 PPT | 已有 fingerprint 和 planner；需绑定真实 PPT editor inspect/apply | 用真实 Workbook 修改数据，确认指定图表更新且手工修改保留 |
| HTML App 生成与落盘 | 已生成项目文件、桌面安全写入、版本和产品图记录 | 真实启动 Vite、刷新 Excel、确认页面数据变化 |
| DOCX 局部刷新 | 已有 Writer `replace-text` 协议、Writer adapter 和保存链路 | 真实 Writer embed 必须实现并回归 `writer:replace-text` |
| Image 刷新 | 已有 Image adapter、模板 lineage、版本回写边界 | 真实图片生成任务接入 adapter 并验证资产落盘 |
| Credit 结算 | 有统一估算；需接入真实任务扣费/退款 | 成功、失败、重试分别验证余额变化 |
| 桌面端 E2E | 单测和 Go 测试已通过 | 使用真实桌面实例完成 Excel → PPT/HTML/DOCX/Image 主链路 |

## 验收命令

```bash
npm run lint
npx vitest run
go test ./... -count=1
git diff --check
```

自动化测试通过不等于运行时验收通过；发布前必须补齐上表中的真实运行证据。

# OfficeDex 1.0.29 Test：PPT 模板能力验收与设计体验

目标平台：macOS Apple Silicon / arm64。渠道：Test（beta）。

## 体验路径

安装本次 DMG，进入首页 →「我的 PPT 模板 / My PPT templates」。

1. 导入一个 `.pptx`，查看解析、分析、模板就绪状态。
2. 选择模板，输入新演示需求。
3. 简单模式直接生成；高级模式先确认需求，再审阅大纲，可修改标题、删除页面，确认后生成。
4. 生成结果在内嵌 PPT 编辑器打开，可继续编辑。
5. 再次打开模板入口可复用已保存模板；删除模板有二次确认。

可用于对比两种模式的需求：

> 使用所选模板生成恰好 3 页中文演示，主题是设计团队体验：模板导入、品牌一致性、交互反馈。保持模板版式，不联网，不生成图片。

高级模式可以把第二页标题改为「设计团队确认的品牌一致性」，确认其在最终文件中保留。

## 当前能力与交互边界

- 这里的模板“训练”是解析页面、提取文字槽位和模板规则，并保存为本地模板资产；不是模型微调。
- 两种模式都使用选中的模板。主要填充文字槽位，沿用模板版式、样式、图片、图表、表格和固定页脚。
- 图片、图表和表格的数据不会按需求重写；固定页脚中的原始页码也可能沿用，建议纳入设计说明。
- 高级模式有需求确认和大纲确认两个环节。已确认的标题会直接写入对应标题槽位，避免被模型再次改写。
- 模板路径目前一次性生成，没有逐页流式预览；完成后聊天中的 Pages 可能仍显示「0 of 3 ready」，但整体完成状态和生成文件正常。该进度展示待适配。
- 当前生成文件名可能取自较长的原始需求，模板列表、导入反馈、生成配置、阶段反馈、命名与结果入口均可交由设计团队梳理。

## 本次修复

- 打开首页模板管理与生成入口，支持中文/英文文案。
- 恢复模板导入、分析进度、本地持久化、选择和删除。
- 显式透传模板绑定与 fast / plan 模式，确保不会误入普通 PPT 生成路径。
- 模板生成时移除原始备注页及其旧引用，修复克隆页面后的导出校验失败。
- 将用户确认的大纲传入内容填充，并保留确认后的标题。

## 验收

- 前端回归：152 个文件、1636 个测试通过；构建脚本的样式、脚本与 Go 回归通过。
- 构建自带真实编辑器 E2E：WebKit 6 项和 Chromium 1 项通过。
- 真实模板：`officedex-landingpage/public/media/examples/OfficeDex-Product-Overview.pptx`，6 页。
- 使用新编译引擎：真实导入后简单模式和高级模式各生成 3 页，并打开编辑器，高级修改标题保留。
- 使用最终包内 OfficeCLI、Node、presentation 运行时再跑同一组流程：通过。
- 签名原生桌面应用：通过真实文件选择器导入相同模板，简单模式直接生成 3 页；高级模式修改大纲标题后生成 3 页，两者均在编辑器打开，确认的标题完整保留。
- 运行进程核验：应用 PID 34081，实际 OfficeCLI 子进程 PID 34139 / 34419，路径在本次 `OfficeDex.app/Contents/Resources/officecli/officecli`；独立验收配置没有 `bridgeBinaryPath` 覆盖。
- OfficeCLI 从本次源码重新编译；版本标识 `0.2.121 (local-release, 2026-10-12T07:15:03Z)`，以实际进程路径和 SHA-256 区分旧包。
- 四个关键二进制均为 arm64；Node 有 JIT 所需 entitlement，无 Homebrew 动态库依赖，没有第二份 Node。
- 只读 bundle 的四个 SSR 入口通过，缓存位于临时目录，运行后签名仍有效。探针适配本项目现有 `dist-ssr/manifest.json`，通过打包后的 JS 入口加载，未依赖被裁剪的 TypeScript 源码。
- 应用本体通过 Apple 公证、Gatekeeper 和 stapler 校验。DMG 同样通过 Apple 公证、Gatekeeper 和 stapler 校验。安装镜像、更新 ZIP 与已验收应用的四个关键二进制哈希一致。

## 构建来源与隔离

构建目录：`officedex-test-1.0.29`，从 `a729c391fc8236063c4fa9afb6c43a628c107241` 建立独立 worktree 并应用本次改动，避免覆盖正在运行的原开发包。

- OfficeCLI 基线：`85e77fd95b9921f27a479c136ca7619929e62f99` + 本次模板修复。
- presentation 基线：`7ad7e7e62ef272486d862259a106ec2983eeece5` + 构建前已有工作区改动。
- writer 基线：`878b9099e2ba23c70d6c6911ebd46530b8822d0a` + 构建前已有工作区改动。
- 使用既有启动和真实 E2E 脚本，无 devctl，无系统代理设置修改。
- 本次源码尚未提交；完整改动文件、patch 与逐文件哈希保存在 `outputs/release-1.0.29-beta/source-changes/` 和 `sources-final.json`，可还原本次构建来源。

验收证据位于工作区 `outputs/release-1.0.29-beta/`，包含真实 E2E 报告、样例 PPTX、桌面截图、运行引擎核验 JSON、架构/签名/公证结果。目录含本地验收配置，仅将安装包和更新 ZIP 作为发布资产，不整目录外传。

另一台无开发者证书的 Mac 首次安装仍需设计团队实际体验；本机 Gatekeeper 校验不等同于跨机器验收。

## 本地样例与截图

- [简单模式生成样例](/Users/luyang/Workspace/shimo/vibe-officing/outputs/release-1.0.29-beta/native-template-fast.pptx)
- [高级模式生成样例](/Users/luyang/Workspace/shimo/vibe-officing/outputs/release-1.0.29-beta/native-template-plan.pptx)
- [模板入口截图](/Users/luyang/Workspace/shimo/vibe-officing/outputs/release-1.0.29-beta/native-template-entry.png)
- [版本与 Test 渠道截图](/Users/luyang/Workspace/shimo/vibe-officing/outputs/release-1.0.29-beta/native-version-channel.png)

![高级模式实际生成结果](/Users/luyang/Workspace/shimo/vibe-officing/outputs/release-1.0.29-beta/native-generated.png)

## 发布记录

- [OfficeDex 1.0.29 Test](https://github.com/officecli/officedex/releases/tag/v1.0.29)，GitHub prerelease，非 latest。
- [macOS arm64 安装包](https://github.com/officecli/officedex/releases/download/v1.0.29/OfficeDex-1.0.29-darwin-arm64.dmg)。本地副本：`officedex/dist-artifacts/OfficeDex-1.0.29-darwin-arm64.dmg`。
- beta 清单已提交并推送：`88eea2b29cc89137d5deb545766aaa303cf0ee41`；远端读取版本 1.0.29，Ed25519 签名通过，资产大小和 SHA-256 与本地包一致。
- Stable 和历史 1.0 清单字节未变；GitHub latest 仍为 v1.0.15。仅新增 macOS arm64 资产。
- GitHub 直传过慢，确认草稿没有已完成资产后，仅停止本任务上传进程，使用 `127.0.0.1:7890` 代理向同一草稿上传同样字节，再核验哈希后公开发布。没有改系统代理设置。

`OfficeDex-1.0.29-darwin-arm64.dmg`

- 字节数：331877712
- SHA-256：`52d2aefe74fdb4059f50539ed656653200679285c365b1b0e695473d4ef657ca`

`OfficeDex-v1.0.29-darwin-arm64.zip`

- 字节数：348047227
- SHA-256：`d16936ca538813573f18c017441347d94aff45fdd335cda7a5e8336beab8f901`


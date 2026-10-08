# PPT 模板管线实验室

把 OfficeDex 当前「导入模板 → 蒸馏规则 → 写 generated.mjs → 本机执行 JS-SDK」拆成可点的步骤。用来核对原理，而不是再等一次 10 分钟黑盒任务。

## 启动

在 `officedex` 目录：

```bash
npm run demo:pptx-lab
```

浏览器打开 <http://127.0.0.1:4177>。

需要本机已有：

- `presentation/tools/bin/mop-convert`（或 `MOP_CONVERT_BIN`）
- 生成步骤需要 officecli `config.json` 里的 LLM（当前 mygpt / grok-4.6）

## 步骤

导入：

1. 上传 PPTX
2. mop-convert → `source.mop`
3. 抽取 facts，并做本地蒸馏（配色/字体/版式/Skill）
4. 可选：LLM 再蒸馏 Skill

生成：

5. 模型只输出槽位文案 JSON
6. 复制 source.mop，只替换已有文本
7. mop-convert 导出 filled.pptx

工作目录在 `demo/pptx-template-lab/work/`，已 gitignore。

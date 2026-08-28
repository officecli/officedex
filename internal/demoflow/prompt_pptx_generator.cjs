const fs = require("node:fs");
const path = require("node:path");

const [, , moduleRoot, outputPath, promptPath] = process.argv;
if (!moduleRoot || !outputPath || !promptPath) throw new Error("usage: generator.cjs <module-root> <output-path> <prompt-path>");
const PptxGenJS = require(path.join(moduleRoot, "pptxgenjs"));
const prompt = fs.readFileSync(promptPath, "utf8").trim() || "OfficeDex 演示文稿";
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "OfficeDex";
pptx.company = "OfficeDex";
pptx.subject = "Prompt-driven presentation";
pptx.title = prompt.slice(0, 80);
pptx.lang = "zh-CN";
pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "zh-CN" };

const C = { ink: "17211D", muted: "5F6C66", green: "007A55", mint: "DDF3EA", cream: "FCFAF2", white: "FFFFFF", line: "D7E2DC", amber: "F5B84B", paleAmber: "FFF3D8", blue: "2D6CDF", paleBlue: "E8F0FF" };
function compact(value, limit = 42) { const normalized = String(value || "").replace(/\s+/g, " ").trim(); return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized; }
function extract(pattern, fallback) { const match = prompt.match(pattern); return compact(match?.[1] || fallback); }
const isQBR = /\bQBR\b|季度业务回顾|季度复盘|目标达成[、，, ]*关键指标/u.test(prompt);
const namedSubject = extract(/^为([^，。；;]{2,30}?)制作/u, "");
const topic = namedSubject || compact(prompt.replace(/^(请|帮我|为我|需要)?(制作|生成|创建|做)(一份|一个|套)?/u, "").replace(/(的)?(演示文稿|幻灯片|PPTX?|pptx?)。?$/u, ""), 46);
const audience = extract(/面向([^，。；;]{2,24}?)(?:的|，|。|；|;)/u, "核心决策者与执行团队");
const objective = extract(/(?:目标|用于|希望|以便|帮助)(?:是|为|能够)?[:：]?([^，。；;]{2,36})/u, `围绕“${topic}”形成清晰结论`);
const qbrFocus = extract(/(?:涵盖|包含|重点说明)[:：]?([^。；;]{2,60})/u, "目标达成、关键指标、项目复盘与资源诉求");
function addChrome(slide, section, page) {
  slide.background = { color: C.cream };
  slide.addText(section, { x: 0.65, y: 0.35, w: 5.4, h: 0.22, fontFace: "Aptos", fontSize: 10, bold: true, color: C.green, charSpacing: 1.4, margin: 0 });
  slide.addText(`OFFICEDEX  /  ${String(page).padStart(2, "0")}`, { x: 10.45, y: 7.05, w: 2.2, h: 0.18, fontFace: "Aptos", fontSize: 9, color: C.muted, align: "right", margin: 0 });
  slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 6.88, w: 12.03, h: 0, line: { color: C.line, width: 1 } });
}
function addTitle(slide, title, subtitle) {
  slide.addText(title, { x: 0.65, y: 1.0, w: 11.7, h: 0.72, fontFace: "Aptos Display", fontSize: 29, bold: true, color: C.ink, margin: 0, breakLine: false, fit: "shrink" });
  if (subtitle) slide.addText(subtitle, { x: 0.68, y: 1.86, w: 10.8, h: 0.4, fontFace: "Aptos", fontSize: 15, color: C.muted, margin: 0, fit: "shrink" });
}
function placeholder(label) { return `${label}：[可编辑字段，待补充]`; }
function bulletList(slide, items, x = 0.9, y = 2.55, w = 11.2, gap = 0.82) {
  items.forEach((item, index) => { const top = y + index * gap; slide.addShape(pptx.ShapeType.ellipse, { x, y: top + 0.08, w: 0.22, h: 0.22, fill: { color: index === 0 ? C.green : C.mint }, line: { color: C.green, width: 1 } }); slide.addText(item, { x: x + 0.45, y: top, w, h: 0.42, fontSize: 18, color: C.ink, margin: 0, fit: "shrink" }); });
}
function renderCover(slide, spec, page) {
  addChrome(slide, "封面", page);
  slide.addText(spec.title, { x: 0.68, y: 1.22, w: 7.5, h: 1.4, fontFace: "Aptos Display", fontSize: 36, bold: true, color: C.ink, margin: 0, fit: "shrink" });
  slide.addText(spec.subtitle, { x: 0.72, y: 3.0, w: 6.9, h: 0.72, fontSize: 18, color: C.muted, margin: 0, fit: "shrink" });
  slide.addShape(pptx.ShapeType.roundRect, { x: 8.55, y: 1.75, w: 3.65, h: 2.8, rectRadius: 0.08, fill: { color: spec.accent || C.green }, line: { color: spec.accent || C.green } });
  slide.addText(spec.badge || "可编辑演示", { x: 8.9, y: 2.68, w: 2.95, h: 0.8, fontSize: 24, bold: true, color: C.white, align: "center", valign: "mid", margin: 0, fit: "shrink" });
  slide.addText(`受众：${audience}`, { x: 0.72, y: 4.38, w: 5.9, h: 0.3, fontSize: 14, color: C.green, bold: true, margin: 0, fit: "shrink" });
}
function renderSummary(slide, spec, page) {
  addChrome(slide, "管理摘要", page); addTitle(slide, spec.title, spec.subtitle);
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.72, y: 2.55, w: 4.0, h: 2.55, rectRadius: 0.05, fill: { color: C.green }, line: { color: C.green } });
  slide.addText("一句话判断", { x: 1.02, y: 2.9, w: 2.9, h: 0.3, fontSize: 14, bold: true, color: C.mint, margin: 0 });
  slide.addText(spec.message, { x: 1.02, y: 3.43, w: 3.25, h: 1.0, fontSize: 22, bold: true, color: C.white, margin: 0, fit: "shrink", valign: "mid" });
  bulletList(slide, spec.items, 5.35, 2.72, 6.7, 0.84);
}
function renderScorecard(slide, spec, page) {
  addChrome(slide, spec.section || spec.title || "关键指标", page); addTitle(slide, spec.title, "所有数值保留为可编辑字段，不对未提供的业绩作推断");
  spec.items.slice(0, 4).forEach((item, index) => { const x = 0.72 + (index % 2) * 6.05; const y = 2.55 + Math.floor(index / 2) * 1.62; slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.65, h: 1.24, rectRadius: 0.05, fill: { color: index % 2 === 0 ? C.white : C.paleBlue }, line: { color: C.line, width: 1 } }); slide.addText(item.label, { x: x + 0.25, y: y + 0.2, w: 2.8, h: 0.25, fontSize: 15, bold: true, color: C.green, margin: 0, fit: "shrink" }); slide.addText(item.value, { x: x + 3.1, y: y + 0.18, w: 2.1, h: 0.42, fontSize: 21, bold: true, color: C.ink, align: "right", margin: 0, fit: "shrink" }); slide.addText(item.note, { x: x + 0.25, y: y + 0.72, w: 5.0, h: 0.23, fontSize: 11, color: C.muted, margin: 0, fit: "shrink" }); });
}
function renderProjectReview(slide, spec, page) {
  addChrome(slide, "项目复盘", page); addTitle(slide, spec.title, "将事实、判断和改进动作分开，便于复盘后继续编辑");
  [["进展", placeholder("已完成事项")], ["学习", placeholder("关键发现")], ["改进", placeholder("下一轮调整")]].forEach(([heading, body], index) => { const x = 0.78 + index * 4.08; slide.addText(String(index + 1).padStart(2, "0"), { x, y: 2.62, w: 0.75, h: 0.4, fontSize: 22, bold: true, color: C.green, margin: 0 }); slide.addShape(pptx.ShapeType.line, { x, y: 3.12, w: 3.25, h: 0, line: { color: C.line, width: 1.2 } }); slide.addText(heading, { x, y: 3.42, w: 3.2, h: 0.4, fontSize: 21, bold: true, color: C.ink, margin: 0 }); slide.addText(body, { x, y: 4.08, w: 3.2, h: 0.8, fontSize: 16, color: C.muted, margin: 0, fit: "shrink" }); });
}
function renderResourceAsks(slide, spec, page) {
  addChrome(slide, "资源诉求", page); addTitle(slide, spec.title, "把需要决策或协调的事项写成可确认的请求");
  [["需要什么", placeholder("资源或支持")], ["为什么现在", placeholder("窗口与影响")], ["如何验收", placeholder("交付与检查条件")]].forEach(([label, value], index) => { const y = 2.58 + index * 1.12; slide.addText(label, { x: 0.85, y, w: 1.5, h: 0.3, fontSize: 16, bold: true, color: C.green, margin: 0 }); slide.addShape(pptx.ShapeType.roundRect, { x: 2.45, y: y - 0.12, w: 9.45, h: 0.62, rectRadius: 0.04, fill: { color: index === 0 ? C.paleAmber : C.white }, line: { color: C.line, width: 1 } }); slide.addText(value, { x: 2.75, y: y + 0.03, w: 8.8, h: 0.24, fontSize: 16, color: C.ink, margin: 0, fit: "shrink" }); });
}
function renderNextSteps(slide, spec, page) {
  addChrome(slide, "下一步", page); addTitle(slide, spec.title, "将结论转成下一轮可执行、可检查的动作");
  spec.items.slice(0, 3).forEach((item, index) => { const y = 2.62 + index * 1.12; slide.addShape(pptx.ShapeType.ellipse, { x: 0.82, y, w: 0.68, h: 0.68, fill: { color: index === 0 ? C.green : C.mint }, line: { color: C.green, width: 1.2 } }); slide.addText(String(index + 1), { x: 0.82, y: y + 0.17, w: 0.68, h: 0.22, fontSize: 16, bold: true, color: index === 0 ? C.white : C.green, align: "center", margin: 0 }); slide.addText(item.label, { x: 1.9, y: y + 0.05, w: 2.65, h: 0.3, fontSize: 19, bold: true, color: C.ink, margin: 0, fit: "shrink" }); slide.addText(item.value, { x: 4.8, y: y + 0.06, w: 6.8, h: 0.3, fontSize: 15, color: C.muted, margin: 0, fit: "shrink" }); });
}
function renderGeneric(slide, spec, page) {
  addChrome(slide, spec.section || "主题分析", page); addTitle(slide, spec.title, spec.subtitle);
  (spec.items || []).forEach((item, index) => { const x = 0.78 + (index % 3) * 4.08; const y = 2.66 + Math.floor(index / 3) * 1.5; slide.addText(String(index + 1).padStart(2, "0"), { x, y, w: 0.7, h: 0.34, fontSize: 21, bold: true, color: C.green, margin: 0 }); slide.addShape(pptx.ShapeType.line, { x, y: y + 0.56, w: 3.2, h: 0, line: { color: C.line, width: 1.1 } }); slide.addText(item.label, { x, y: y + 0.76, w: 3.15, h: 0.32, fontSize: 19, bold: true, color: C.ink, margin: 0, fit: "shrink" }); slide.addText(item.value, { x, y: y + 1.22, w: 3.15, h: 0.42, fontSize: 14, color: C.muted, margin: 0, fit: "shrink" }); });
}

// The prompt is normalized into a DeckSpec before any slide is authored. Each
// entry carries a semantic type so content and layout are selected together.
function qbrSpec() {
  return { slides: [
    { type: "cover", title: `QBR｜${qbrFocus}`, subtitle: "季度经营回顾与下一阶段决策", badge: "QBR", accent: C.blue },
    { type: "summary", title: "管理摘要", subtitle: "先给出本季度最重要的判断与待决策事项", message: placeholder("本季度核心结论"), items: [placeholder("目标达成概览"), placeholder("最重要的变化"), placeholder("需要管理层决定的事项")] },
    { type: "scorecard", title: "目标达成", items: [{ label: "目标 01", value: "待补充", note: "目标值：可编辑字段｜实际值：可编辑字段" }, { label: "目标 02", value: "待补充", note: "目标值：可编辑字段｜实际值：可编辑字段" }, { label: "目标 03", value: "待补充", note: "目标值：可编辑字段｜实际值：可编辑字段" }, { label: "达成判断", value: "待判断", note: "请补充依据后选择：达成／部分达成／未达成" }] },
    { type: "scorecard", title: "关键指标", items: [{ label: "指标 01", value: "待补充", note: "口径：可编辑字段｜周期：可编辑字段" }, { label: "指标 02", value: "待补充", note: "口径：可编辑字段｜周期：可编辑字段" }, { label: "指标 03", value: "待补充", note: "口径：可编辑字段｜周期：可编辑字段" }, { label: "风险信号", value: "待补充", note: "请填入趋势、阈值或异常说明" }] },
    { type: "project-review", title: "项目复盘" }, { type: "resource-asks", title: "资源诉求" },
    { type: "next-steps", title: "下一步", items: [{ label: "动作 01", value: placeholder("负责人、截止时间与验收条件") }, { label: "动作 02", value: placeholder("负责人、截止时间与验收条件") }, { label: "动作 03", value: placeholder("负责人、截止时间与验收条件") }] },
  ] };
}
function genericSpec() {
  const launch = /投资|融资|增长|市场|发布|launch|渠道/i.test(prompt);
  const education = /教育|招生|学校|课程|培训/u.test(prompt);
  const product = /产品|应用|软件|平台|功能|product|app/i.test(prompt);
  if (launch) return { slides: [{ type: "cover", title: `${topic}｜增长与发布方案`, subtitle: `面向${audience}的行动框架`, badge: "GROWTH", accent: C.green }, { type: "summary", title: "机会与判断", subtitle: objective, message: `先验证${topic}最值得投入的增长假设`, items: ["明确优先受众与场景", "把渠道动作与转化路径连起来", "使用可编辑指标补齐证据"] }, { type: "generic", section: "受众与定位", title: "受众与定位", subtitle: "把价值主张落到具体使用场景", items: [{ label: "优先受众", value: audience }, { label: "核心问题", value: placeholder("待补充用户问题") }, { label: "价值主张", value: `围绕“${topic}”说明改变` }] }, { type: "generic", section: "渠道与动作", title: "渠道与动作", subtitle: "按验证顺序组织触达、转化和复盘", items: [{ label: "触达", value: placeholder("渠道与素材") }, { label: "转化", value: placeholder("转化动作") }, { label: "复盘", value: placeholder("检查节点") }] }, { type: "scorecard", title: "验证指标", items: [{ label: "激活", value: "待补充", note: "口径：可编辑字段" }, { label: "转化", value: "待补充", note: "口径：可编辑字段" }, { label: "留存", value: "待补充", note: "口径：可编辑字段" }, { label: "效率", value: "待补充", note: "口径：可编辑字段" }] }, { type: "next-steps", title: "行动清单", items: [{ label: "验证假设", value: placeholder("负责人与时间") }, { label: "补齐证据", value: placeholder("数据来源") }, { label: "做出决策", value: placeholder("检查条件") }] }] };
  if (education) return { slides: [{ type: "cover", title: `${topic}｜招生行动方案`, subtitle: `面向${audience}的年度规划`, badge: "EDU", accent: C.blue }, { type: "summary", title: "核心判断", subtitle: "先明确招生目标、关键人群和决策依据", message: `让${audience}看见清晰的选择理由`, items: ["从真实需求出发组织内容", "组合线上线下触点", "用可编辑字段补齐招生数据"] }, { type: "generic", section: "受众洞察", title: "受众洞察", subtitle: "围绕决策链拆解关心的问题", items: [{ label: "关键人群", value: audience }, { label: "决策因素", value: placeholder("待补充") }, { label: "信任证据", value: placeholder("待补充") }] }, { type: "scorecard", title: "招生指标", items: [{ label: "线索", value: "待补充", note: "口径：可编辑字段" }, { label: "咨询", value: "待补充", note: "口径：可编辑字段" }, { label: "到访", value: "待补充", note: "口径：可编辑字段" }, { label: "报名", value: "待补充", note: "口径：可编辑字段" }] }, { type: "next-steps", title: "推进安排", items: [{ label: "准备内容", value: placeholder("负责人和时间") }, { label: "触达家庭", value: placeholder("渠道与节奏") }, { label: "复盘调整", value: placeholder("检查条件") }] }] };
  if (product) return { slides: [{ type: "cover", title: `${topic}｜产品迭代方案`, subtitle: `面向${audience}的产品工作框架`, badge: "PRODUCT", accent: C.green }, { type: "summary", title: "产品判断", subtitle: "把用户问题、价值主张和验证方式放在一起", message: `优先解决${audience}最影响结果的障碍`, items: ["描述问题发生的场景", "明确产品带来的改变", "用可编辑指标判断迭代效果"] }, { type: "generic", section: "用户问题", title: "用户问题", subtitle: "从场景、阻碍和期望结果开始", items: [{ label: "场景", value: placeholder("待补充") }, { label: "阻碍", value: placeholder("待补充") }, { label: "结果", value: placeholder("待补充") }] }, { type: "project-review", title: "迭代复盘" }, { type: "scorecard", title: "验证指标", items: [{ label: "使用", value: "待补充", note: "口径：可编辑字段" }, { label: "完成", value: "待补充", note: "口径：可编辑字段" }, { label: "反馈", value: "待补充", note: "口径：可编辑字段" }, { label: "结果", value: "待补充", note: "口径：可编辑字段" }] }, { type: "next-steps", title: "迭代计划", items: [{ label: "确认范围", value: placeholder("负责人、时间与边界") }, { label: "交付验证", value: placeholder("测试与反馈") }, { label: "决定取舍", value: placeholder("下一轮条件") }] }] };
  return { slides: [{ type: "cover", title: topic, subtitle: `面向${audience}的可编辑演示`, badge: "BRIEF", accent: C.green }, { type: "summary", title: "核心判断", subtitle: objective, message: placeholder("一句话结论"), items: [placeholder("背景"), placeholder("关键机会"), placeholder("待决策事项")] }, { type: "generic", section: "重点内容", title: "重点内容", subtitle: "按主题补齐事实与行动", items: [{ label: "现状", value: placeholder("待补充") }, { label: "重点", value: compact(prompt, 34) }, { label: "行动", value: placeholder("待补充") }] }, { type: "next-steps", title: "下一步", items: [{ label: "补齐信息", value: placeholder("负责人和时间") }, { label: "形成方案", value: placeholder("交付物") }, { label: "检查结果", value: placeholder("验收条件") }] }] };
}

function buildDeckSpec() { return isQBR ? qbrSpec() : genericSpec(); }
const DeckSpec = buildDeckSpec();
DeckSpec.slides.forEach((slideSpec, index) => { const slide = pptx.addSlide(); switch (slideSpec.type) { case "cover": renderCover(slide, slideSpec, index + 1); break; case "summary": renderSummary(slide, slideSpec, index + 1); break; case "scorecard": renderScorecard(slide, slideSpec, index + 1); break; case "project-review": renderProjectReview(slide, slideSpec, index + 1); break; case "resource-asks": renderResourceAsks(slide, slideSpec, index + 1); break; case "next-steps": renderNextSteps(slide, slideSpec, index + 1); break; default: renderGeneric(slide, slideSpec, index + 1); } });
pptx.writeFile({ fileName: outputPath }).catch((error) => { console.error(error && error.stack ? error.stack : error); process.exitCode = 1; });

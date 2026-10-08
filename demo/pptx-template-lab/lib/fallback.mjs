import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importPptxFile } from "../../../../presentation/tools/lib/mop-converter-client.mjs";

const PRESENTATION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../presentation");

export function fallbackProgram(visual, slide) {
  const primary = visual?.primary || "#2B3033";
  const bg = visual?.background || "#FFFFFF";
  const titleFont = visual?.fonts?.title?.name || "Microsoft YaHei";
  const titleSize = visual?.fonts?.title?.sizePt || 28;
  const bodySize = visual?.fonts?.body?.sizePt || 14;
  const title = JSON.stringify(slide.purpose || "Slide");
  const bullets = (slide.bullets || []).map((item) => JSON.stringify(item));
  return `export async function build(PowerPoint) {
  await PowerPoint.run(async (context) => {
    context.presentation.slides.add();
    await context.sync();
    const slide = context.presentation.slides.getItemAt(0);
    slide.background.fill.setSolidColor(${JSON.stringify(bg)});
    const heading = slide.shapes.addTextBox(${title}, { left: 48, top: 36, width: 860, height: 64 });
    heading.textFrame.textRange.font.name = ${JSON.stringify(titleFont)};
    heading.textFrame.textRange.font.size = ${titleSize};
    heading.textFrame.textRange.font.color = ${JSON.stringify(primary)};
    ${bullets.map((b, i) => `slide.shapes.addTextBox(${b}, { left: 48, top: ${120 + i * 36}, width: 860, height: 32 }).textFrame.textRange.font.size = ${bodySize};`).join("\n    ")}
    await context.sync();
  });
}
`;
}

export async function buildFallbackSlide(visual, outlineSlide, workDir) {
  const dir = path.join(workDir, `fallback-${outlineSlide.outlineIndex || "x"}`);
  await fs.mkdir(dir, { recursive: true });
  const program = path.join(dir, "generated.mjs");
  await fs.writeFile(program, fallbackProgram(visual, outlineSlide));
  const runDir = path.join(dir, "run");
  await runNode([path.join(PRESENTATION, "tools", "execute-jssdk.mjs"), program, runDir], PRESENTATION);
  const pptx = path.join(runDir, "generated.pptx");
  const mopDir = path.join(dir, "mop");
  await importPptxFile(pptx, mopDir);
  const mop = JSON.parse(await fs.readFile(path.join(mopDir, "content.json"), "utf8"));
  const slides = (mop.blocks || []).find((block) => block.type === "slides")?.data || [];
  if (!slides[0]) throw new Error("js-fallback produced no slide");
  return slides[0];
}

function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, PRESENTATION_SOURCE_DIR: PRESENTATION } });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-800) || `execute-jssdk exit ${code}`));
    });
  });
}

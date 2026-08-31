import { Button, Tag } from "../ui";
import { FileTextOutlined, FolderOpenOutlined, GlobalOutlined, LinkOutlined, SendOutlined } from "../ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PptistSlide } from "../../shared/pptistProtocol";
import { PptistEmbedPanel, type PptistEmbedPanelHandle } from "../components/PptistEmbedPanel";
import { ImeTextArea } from "../components/ImeInput";
import { useLocale, type Locale } from "../i18n";

type PerfMetric = {
  event: string;
  value: number;
  at: number;
};

declare global {
  interface Window {
    __officedexPptistPerf?: {
      metrics: PerfMetric[];
      mark: (event: string, value?: number) => void;
      reset: () => void;
    };
  }
}

const PERF_SLIDE_IDS = Array.from({ length: 10 }, (_, index) => `perf-slide-${index + 1}`);

function createPerfSlides(locale: Locale): PptistSlide[] {
  const titles = locale === "zh" ? [
    "介绍石墨文档",
    "什么是石墨文档",
    "石墨文档的核心特点",
    "传统文档协作流程中的常见问题",
    "传统协作痛点造成的效率损失",
    "石墨文档的核心场景",
    "多人实时协作如何提升效率",
    "权限与版本管理",
    "AI 如何辅助文档处理",
    "总结与下一步",
  ] : [
    "Introducing Shimo Docs",
    "What is Shimo Docs?",
    "Core Shimo Docs capabilities",
    "Common problems in traditional document collaboration",
    "The productivity cost of collaboration friction",
    "Core Shimo Docs use cases",
    "How real-time collaboration improves efficiency",
    "Permissions and version management",
    "How AI assists document work",
    "Summary and next steps",
  ];
  const subtitle = locale === "zh"
    ? "本页用于模拟真实完成态 PPTist 编辑页面，包含缩略图、画布和右侧 AI 继续修改输入。"
    : "This page simulates a completed PPTist editing workspace with thumbnails, canvas, and AI follow-up editing.";
  const body = locale === "zh"
    ? "<p><strong>传统协作中的时间消耗分布示意</strong></p><p>版本核对、沟通确认、风险处理、权限调整等环节会持续占用团队注意力。</p>"
    : "<p><strong>Where traditional collaboration consumes time</strong></p><p>Version checks, alignment, risk handling, and permission changes continuously consume team attention.</p>";
  const side = locale === "zh"
    ? "<p><strong>主要损耗来源</strong></p><p>1 版本核对挤占产出时间</p><p>2 沟通成本持续上升</p><p>3 风险处理增加负担</p>"
    : "<p><strong>Main sources of loss</strong></p><p>1 Version checks displace productive work</p><p>2 Communication overhead keeps growing</p><p>3 Risk handling adds operational load</p>";
  return titles.map((title, index) => ({
    id: PERF_SLIDE_IDS[index],
    background: { type: "solid", color: "#f7fbfd" },
    elements: [
      {
        id: `title-${index + 1}`,
        type: "text",
        left: 72,
        top: 54,
        width: 760,
        height: 62,
        content: `<p><strong>${title}</strong></p>`,
        defaultFontName: "Microsoft Yahei",
        defaultColor: "#172033",
        defaultFontSize: 34,
      },
      {
        id: `subtitle-${index + 1}`,
        type: "text",
        left: 74,
        top: 120,
        width: 780,
        height: 36,
        content: `<p>${subtitle}</p>`,
        defaultFontName: "Microsoft Yahei",
        defaultColor: "#667085",
        defaultFontSize: 15,
      },
      {
        id: `body-card-${index + 1}`,
        type: "shape",
        left: 74,
        top: 170,
        width: 530,
        height: 275,
        viewBox: [530, 275],
        path: "M 0 0 L 530 0 L 530 275 L 0 275 Z",
        fill: "#ffffff",
        fixedRatio: false,
        text: {
          content: body,
          defaultFontName: "Microsoft Yahei",
          defaultColor: "#172033",
          defaultFontSize: 18,
        },
      },
      {
        id: `side-card-${index + 1}`,
        type: "shape",
        left: 624,
        top: 170,
        width: 282,
        height: 275,
        viewBox: [282, 275],
        path: "M 0 0 L 282 0 L 282 275 L 0 275 Z",
        fill: "#dff3ec",
        fixedRatio: false,
        text: {
          content: side,
          defaultFontName: "Microsoft Yahei",
          defaultColor: "#24324a",
          defaultFontSize: 16,
        },
      },
      {
        id: `page-no-${index + 1}`,
        type: "text",
        left: 840,
        top: 500,
        width: 80,
        height: 24,
        content: `<p>${String(index + 1).padStart(2, "0")}/10</p>`,
        defaultFontName: "Inter",
        defaultColor: "#8792a2",
        defaultFontSize: 12,
      },
    ],
  }));
}

function installPerfCollector() {
  if (typeof window === "undefined") return;
  if (window.__officedexPptistPerf) return;
  const metrics: PerfMetric[] = [];
  window.__officedexPptistPerf = {
    metrics,
    mark(event, value = 0) {
      metrics.push({ event, value, at: performance.now() });
    },
    reset() {
      metrics.splice(0, metrics.length);
    },
  };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.push({ event: "longtask", value: entry.duration, at: entry.startTime });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Long Task API is unavailable in some browser contexts.
  }
}

export function PerfPptistCompletedScreen() {
  const locale = useLocale();
  const iframeRef = useRef<PptistEmbedPanelHandle>(null);
  const [prompt, setPrompt] = useState("");
  const [slideIndex, setSlideIndex] = useState(4);
  const [inputCount, setInputCount] = useState(0);
  const [lastInputRAF, setLastInputRAF] = useState(0);
  const [thumbnailCapturePaused, setThumbnailCapturePaused] = useState(false);
  const slides = useMemo(() => createPerfSlides(locale), [locale]);

  useEffect(() => {
    installPerfCollector();
    window.__officedexPptistPerf?.reset();
  }, []);

  const gotoSlide = useCallback((index: number) => {
    setSlideIndex(index);
    iframeRef.current?.gotoSlide(index);
    window.__officedexPptistPerf?.mark("goto-slide", index + 1);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => gotoSlide(4), 900);
    return () => window.clearTimeout(timer);
  }, [gotoSlide]);

  function handlePromptChange(value: string) {
    const start = performance.now();
    setPrompt(value);
    setInputCount((count) => count + 1);
    window.requestAnimationFrame(() => {
      const delay = performance.now() - start;
      setLastInputRAF(delay);
      window.__officedexPptistPerf?.mark("input-raf-delay", delay);
    });
  }

  return (
    <main className="perf-pptist-page">
        <header className="perf-pptist-topbar">
          <div>
            <span>OfficeDex / OfficeDex Workspace</span>
            <strong>Living Tree Cockpit</strong>
          </div>
          <Tag color="success">Perf mock</Tag>
        </header>
        <section className="perf-pptist-cockpit">
          <div className="perf-pptist-title">
            <span>Living Tree Cockpit</span>
            <strong>{locale === "zh" ? "介绍石墨文档，十页" : "Introducing Shimo Docs, 10 slides"}</strong>
          </div>
          <div className="perf-pptist-body">
            <div className="perf-pptist-stage">
              <PptistEmbedPanel
                ref={iframeRef}
                slides={slides}
                animateSlides={false}
                slideIds={PERF_SLIDE_IDS}
                onSlideChanged={(index) => setSlideIndex(index)}
                autosaveEnabled={false}
                thumbnailCapturePaused={thumbnailCapturePaused}
              />
            </div>
            <aside className="living-tree-pptx-toolbar is-ai-dialogue-panel perf-pptist-side">
              <section className="living-tree-pptx-edit-panel is-review-mode" aria-label="Edit with AI">
                <div className="living-tree-pptx-action-card">
                  <div className="living-tree-pptx-file-title">
                    <FileTextOutlined />
                    <strong>{locale === "zh" ? "介绍石墨文档十页.pptx" : "Introducing Shimo Docs - 10 slides.pptx"}</strong>
                  </div>
                  <div className="living-tree-pptx-action-card-buttons">
                    <Button icon={<GlobalOutlined />} />
                    <Button icon={<FolderOpenOutlined />} />
                    <Button icon={<LinkOutlined />} />
                  </div>
                </div>
                <section className="living-tree-pptx-dialogue-log">
                  <div className="living-tree-pptx-dialogue-log-head">
                    <div>
                      <strong>AI conversation</strong>
                      <span>Focus on follow-up edit instructions</span>
                    </div>
                    <Tag>1</Tag>
                  </div>
                  <div className="living-tree-pptx-dialogue-log-body">
                    <div className="living-tree-pptx-dialogue-intent">
                      <strong>What would you like to change in this PPT?</strong>
                      <div className="living-tree-pptx-dialogue-chips">
                        <Button size="small">More sales-focused</Button>
                        <Button size="small">More modern</Button>
                        <Button size="small">Less text, more visuals</Button>
                      </div>
                    </div>
                    <div className="living-tree-pptx-dialogue-message is-ai">
                      <span>AI</span>
                      <p>The deck is ready for follow-up edits.</p>
                    </div>
                  </div>
                  <p className="living-tree-pptx-dialogue-status">
                    Slide {slideIndex + 1}/10 · inputs {inputCount} · last RAF {lastInputRAF.toFixed(1)}ms
                  </p>
                  <div className="living-tree-pptx-dialogue-footer">
                    <div className="living-tree-pptx-edit-row">
                      <ImeTextArea
                        data-testid="perf-pptist-input"
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        placeholder="Ask to modify this PPT..."
                        value={prompt}
                        onValueChange={handlePromptChange}
                        onFocus={() => setThumbnailCapturePaused(true)}
                        onBlur={() => setThumbnailCapturePaused(false)}
                      />
                      <Button type="primary" icon={<SendOutlined />} disabled={!prompt.trim()} />
                    </div>
                  </div>
                </section>
              </section>
            </aside>
          </div>
        </section>
    </main>
  );
}

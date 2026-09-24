import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { LocaleProvider } from "../../src/renderer/i18n";
import { CanvasPlaceholder } from "../../src/shell/editor/CanvasPlaceholder";
import { fixtureGenerationTask } from "../../src/shell/editor/slidesGenerating/generationTaskFixtures";
import type { GenerationCanvasPhase } from "../../src/shell/editor/slidesGenerating/pptxGenerationPhase";
import "../../src/shell/tokens.css";
import "../../src/shell/app.css";

const PHASES: GenerationCanvasPhase[] = ["research", "outline", "writing", "drawing", "polish"];

declare global {
  interface Window {
    __slidesGenerating?: {
      goto: (phase: GenerationCanvasPhase) => void;
      phase: () => GenerationCanvasPhase;
    };
  }
}

function Harness() {
  const [phase, setPhase] = useState<GenerationCanvasPhase>("research");
  const task = fixtureGenerationTask(phase);

  useEffect(() => {
    window.__slidesGenerating = {
      goto: (next) => setPhase(next),
      phase: () => phase,
    };
    return () => {
      delete window.__slidesGenerating;
    };
  }, [phase]);

  return (
    <div id="shell" data-loaded="true" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="shell-canvas" style={{ flex: 1, minHeight: 0 }}>
        <CanvasPlaceholder type="slides" mode="generating" task={task} />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <LocaleProvider value="en">
    <Harness />
  </LocaleProvider>,
);

void PHASES;

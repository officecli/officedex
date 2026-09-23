import { useCallback, useRef, useState } from "react";

import { ArrowUpRight } from "lucide-react";
import { AttentionBorder } from "../agent/AttentionBorder";
import { Composer } from "../composer/Composer";
import { PROMPTS, QuickPrompts } from "./QuickPrompts";
import { useHomeStartRequests } from "./homeStart";
import { useAgentTask } from "../agent/useAgentTask";
import { useComposerSettings } from "../composer/useComposerSettings";
import { useShell } from "../state/ShellContext";
import type { FileType } from "../../shared/uiPort";

/**
 * The corner radius of the hero composer, from `.shell-cx--home`.
 *
 * Stated here because the glow is SVG and cannot inherit a CSS radius, and the
 * shell holds no ref into the composer to read it off the way the prototype
 * did. If `.shell-cx--home`'s `border-radius` moves, this and the matching
 * rule in agent.css move with it.
 */
const COMPOSER_RADIUS = 20;

/**
 * Starting sentences for a picture, shown while the composer is in image mode.
 * Like the quick prompts they fill, never send — a purpose is not yet a brief.
 */
const IMAGE_PURPOSES = [
  {
    label: "Product photo",
    prompt: "Create a clean product photo with a warm white background, soft natural light, and a carefully balanced composition.",
  },
  {
    label: "Marketing visual",
    prompt: "Create a campaign visual for a product launch. Use a bold composition with plenty of space for a headline. No text.",
  },
  {
    label: "Illustration",
    prompt: "Create an editorial illustration about a calm, productive workspace. Use simple shapes, subtle texture, and a muted color palette.",
  },
  {
    label: "Social cover",
    prompt: "Create a striking social media cover for a product launch. Keep the main subject centered and leave room for a short headline. No text.",
  },
];

/**
 * Agent Home's top half: the question, the composer, the starting points.
 *
 * The hero carries the same `Composer` as the docked column and the floating
 * panel — including the scope chip that replaced the prototype's separate
 * folder dropdown (decision 2). There was a second copy of that dropdown here
 * until recently, sitting above the input and bound to the same `select-folder`
 * action as the chip inside it: one screen, one scope, two controls for it.
 * Decision 2 says the scope is a property of the message, so the one that
 * travels with the message is the one that survived.
 */
export function Hero() {
  const { dispatch } = useShell();
  const agent = useAgentTask();
  const settings = useComposerSettings();

  /**
   * Focus anywhere inside the composer — its input, its chips, its buttons.
   *
   * Tracked in React rather than left to `:focus-within` because the glow is
   * painted by an overlay object, not by CSS. `focusout` is checked against
   * the wrapper so moving between the input and the send button does not blink
   * the border off and on again; a null `relatedTarget` (clicking the page
   * background, or the window losing focus) correctly falls through to false.
   */
  const [focused, setFocused] = useState(false);

  // Handed to us by the composer on mount; the quick prompts type through it.
  const fill = useRef<((text: string, output?: FileType | "image") => void) | null>(null);
  const registerFill = useCallback((next: (text: string, output?: FileType | "image") => void) => {
    fill.current = next;
  }, []);
  const setImageMode = useRef<((on: boolean) => void) | null>(null);
  const registerImageMode = useCallback((next: (on: boolean) => void) => {
    setImageMode.current = next;
  }, []);
  const [imageMode, setImageModeShown] = useState(false);

  // The sidebar's New task menu: the kind it picked, primed in the composer.
  useHomeStartRequests((kind) => {
    if (kind === "image") {
      setImageMode.current?.(true);
      fill.current?.(IMAGE_PURPOSES[0].prompt, "image");
      return;
    }
    setImageMode.current?.(false);
    const entry = PROMPTS.find((prompt) => prompt.type === kind);
    if (entry) fill.current?.(entry.prompt, kind);
  });

  return (
    <div className="shell-hero" data-image-mode={String(imageMode)}>
      <h1>{imageMode ? "What would you like to create?" : "What would you like to get done?"}</h1>
      <p className="shell-hero-lede">
        {imageMode
          ? "Describe an image, add references, and make it yours."
          : "Bring your files and a goal. Jump in and edit at any time."}
      </p>

      <div className="shell-hero-composer">
        {/* Positions the overlay over the composer; see agent.css. */}
        <div
          className="shell-attention-anchor"
          onFocus={() => setFocused(true)}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setFocused(false);
          }}
        >
          <Composer
            placement="home"
            busy={agent.busy}
            // Home switches modes with "Create an image" below, not a toolbar toggle.
            showModeControls={false}
            onRegisterFill={registerFill}
            onRegisterImageMode={registerImageMode}
            onImageModeChange={setImageModeShown}
            onSend={async (submission) => {
              await agent.send(submission);
              /*
               * Leave Home for the canvas the run fills, and open nothing.
               *
               * There is no file to open. A task started from Home is about
               * something that does not exist yet — the composer deliberately
               * sends no `activeFileId` from here, because the service layer
               * reads that as "edit this document instead" — so the only
               * honest destination is the empty canvas, and `ShellContext`
               * opens the real artifact by `artifactTaskId` once the run
               * finishes.
               *
               * This used to guess: `files.find(file => file.folderId ===
               * submission.folderId)`, the first file of the scoped folder in
               * load order. Ask for a new deck in a folder of forty documents
               * and it opened document number one, which the task panel's
               * artifact card then named as though the agent had made it.
               */
              dispatch({ type: "enter-workspace" });
            }}
            onStop={agent.stop}
          />
          {/*
            The prototype's `agent-home-glow`: the agent's own border, lit by
            input focus rather than by a run. Rendered after the composer so it
            sits over it, and flush with its edge (`inset={0}`) so it reads as
            the composer lighting up rather than as a rectangle drawn inside it.
          */}
          <AttentionBorder
            active={focused}
            inset={0}
            radius={COMPOSER_RADIUS}
            reducedMotion={settings.value.reduceMotion}
          />
        </div>
      </div>

      {imageMode ? (
        <div className="shell-hero-purposes" role="group" aria-label="Image prompt ideas">
          <span>Try</span>
          {IMAGE_PURPOSES.map((purpose) => (
            <button key={purpose.label} type="button" onClick={() => fill.current?.(purpose.prompt, "image")}>
              {purpose.label}
              <ArrowUpRight size={11} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <QuickPrompts
        onPick={(prompt, type) => fill.current?.(prompt, type)}
        imageSelected={imageMode}
        onToggleImage={() => setImageMode.current?.(!imageMode)}
      />
    </div>
  );
}

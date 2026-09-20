import { useCallback, useRef, useState } from "react";

import { AttentionBorder } from "../agent/AttentionBorder";
import { Composer } from "../composer/Composer";
import { QuickPrompts } from "./QuickPrompts";
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
  const fill = useRef<((text: string, output?: FileType) => void) | null>(null);
  const registerFill = useCallback((next: (text: string, output?: FileType) => void) => {
    fill.current = next;
  }, []);

  return (
    <div className="shell-hero">
      <h1>What would you like to get done?</h1>
      <p className="shell-hero-lede">
        Bring your files and a goal. Jump in and edit at any time.
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
            onRegisterFill={registerFill}
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

      <QuickPrompts onPick={(prompt, type) => fill.current?.(prompt, type)} />
    </div>
  );
}

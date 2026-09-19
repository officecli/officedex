import { useCallback, useRef, useState } from "react";

import { AttentionBorder } from "../agent/AttentionBorder";
import { Composer } from "../composer/Composer";
import { QuickPrompts } from "./QuickPrompts";
import { useAgentTask } from "../agent/useAgentTask";
import { useComposerSettings } from "../composer/useComposerSettings";
import { useLibraryActions } from "../nav/useLibraryActions";
import { useShell } from "../state/ShellContext";

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
  const { dispatch, files } = useShell();
  const actions = useLibraryActions();
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
  const fill = useRef<((text: string) => void) | null>(null);
  const registerFill = useCallback((next: (text: string) => void) => {
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
               * Leave Home, but do not guess which file the run is about.
               *
               * Editing the file the user already had open is the one case
               * where the destination is known. Everything else is making
               * something that does not exist yet, and the canvas the run
               * fills is the honest place to wait: `ShellContext` opens the
               * real artifact when the task completes, matching it by
               * `artifactTaskId`.
               *
               * This used to fall back to `files.find(file => file.folderId
               * === submission.folderId)` — the first file of the scoped
               * folder, in load order, with no relation to what was asked
               * for. Ask for a new deck in a folder holding forty files and
               * the shell opened file number one and sat there, so the
               * artifact card (which shows whatever is open) named it too and
               * the whole screen agreed on the wrong document. The comment
               * here already described the behaviour below; only the code
               * disagreed.
               */
              const target = files.find((file) => file.id === submission.activeFileId);
              if (target) await actions.openFile(target.id);
              else dispatch({ type: "enter-workspace" });
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

      <QuickPrompts onPick={(prompt) => fill.current?.(prompt)} />
    </div>
  );
}

/**
 * `?deckDemo=1` — boot straight into the bundled recording.
 *
 * The recording itself is a real artefact: `demos/nexaedge/` holds 141 drawing
 * ops (8 slides, 123 shapes) recovered from an actual generation, and replaying
 * it drives the same sequencer, draft, editor and controller a live run does.
 * Legacy shipped it as **Watch PPT generation**; the shell offers it as a
 * button on Home (`shell-home-watch-deck`).
 *
 * This flag is the same thing without the clicking, for the cases where a URL
 * is the better handle: an e2e spec that wants the state under test without
 * driving the UI first, and a human who wants to reload into it. The button is
 * the product entry; this is a shortcut to it, so it is not gated — it starts a
 * recording the app already ships, in a scratch draft, and touches nothing the
 * user owns.
 *
 * It needs a real backend either way: the draft is a real
 * `workspaceDir/live/` file and the editor is the real embedded one.
 */
export function deckDemoEnabled(search?: string): boolean {
  const query = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return new URLSearchParams(query).get("deckDemo") === "1";
}

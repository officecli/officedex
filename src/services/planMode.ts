/**
 * Whether this session should ask the runtime to stop at the outline.
 *
 * The outline gate is the pipeline's one confirmation stop, and it is wired
 * only for an interactive best-mode run — which the bridge produces only for
 * `generationMode: "plan"`. Nothing in the shell has ever sent that, so a
 * feature with a card, a decision payload and tests on both sides has never
 * been seen by anyone using the product.
 *
 * Turning it on for everyone is a product decision with a real price: a
 * mandatory pause in front of every deck, in a flow whose first complaint was
 * that it had too much going on. So this is the other thing — a way to *try*
 * it, off unless asked for, so the decision can be made by using it.
 *
 * Two switches because the two places it needs to be tried have different
 * affordances. A dev server has an address bar; a packaged app does not, and
 * `localStorage` is what its DevTools can reach. The URL wins when both are
 * present, and `?planMode=0` is how a session turns it back off without
 * clearing storage by hand.
 *
 * Deliberately not a setting in the UI. A control in Settings is a claim that
 * the choice is settled and merely configurable, and it is not: the question is
 * whether this belongs in the product at all.
 */
const PLAN_MODE_KEY = "officedex.planMode";

export function planModeRequested(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const fromUrl = new URLSearchParams(window.location.search).get("planMode");
    if (fromUrl === "1") return true;
    if (fromUrl === "0") return false;
  } catch {
    // A URL that will not parse is not an opt-in.
  }

  try {
    return window.localStorage.getItem(PLAN_MODE_KEY) === "1";
  } catch {
    // Private mode, or storage disabled. Absence is the answer either way.
    return false;
  }
}

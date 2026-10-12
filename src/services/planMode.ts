/**
 * Developer override for ordinary chat generation. The template library has
 * an explicit per-request fast/plan control which takes precedence over this.
 * URL ?planMode=1/0 wins over localStorage; absent means direct generation.
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

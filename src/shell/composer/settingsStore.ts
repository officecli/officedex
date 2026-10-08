import { reportPortFailure } from "../port/reportPortFailure";
import type { Model, ShellSettings, UiPort } from "../../shared/uiPort";

/**
 * What the composer shows before the port has answered.
 *
 * `permission` matches the default in services/settings.ts and the fake port's
 * seed on purpose. The three had drifted apart on `review`, and because this
 * one is what renders first, a mismatch meant the composer opened on a tier
 * that only answers "not built yet" and then silently changed under the user.
 */
export const FALLBACK_SETTINGS: ShellSettings = {
  permission: "full",
  enterToSend: true,
  customInstructions: "",
  reduceMotion: false,
  selectedModelId: "",
};

/** One immutable object per change, so `useSyncExternalStore` can compare it. */
export interface SettingsSnapshot {
  value: ShellSettings;
  models: Model[];
}

/**
 * A settings payload can name a model that no longer exists (removed on another
 * device); fall back rather than showing an empty model button.
 */
function withLiveModel(settings: ShellSettings, models: Model[]): ShellSettings {
  return models.some((model) => model.id === settings.selectedModelId)
    ? settings
    : { ...settings, selectedModelId: models[0]?.id ?? "" };
}

/**
 * The one copy of the workspace's preferences, per port.
 *
 * ## Why this is a store and not `useState` in a hook
 *
 * It used to be the latter, and the result was the failure this shell says it
 * refuses. Five components called `useComposerSettings()` and each got its own
 * `useState` plus a one-shot `useEffect`: flipping "Enter sends" in the
 * composer left the sidebar's menu rendering `aria-checked="true"` for a
 * setting that was now false, on the same screen, with no reload in between
 * (audit S7-002). Turning on Reduced motion did nothing to the carousel until
 * Home happened to remount (S7-003). Neither is a rendering bug: the controls
 * were faithfully reporting state that had stopped being true, because there
 * were five states and only one of them had been told.
 *
 * ## Why a module store rather than a Context provider
 *
 * A provider would work, and was the obvious move. Two things argued against
 * it, both about this specific defect:
 *
 *  1. **A provider can be missing.** Every consumer would need one above it,
 *     in `main.tsx`, in `test/renderShell.tsx`, and in whatever renders the
 *     shell next. A consumer mounted outside it either throws at runtime or —
 *     if the hook is written forgivingly — silently falls back to its own
 *     private copy, which is a fresh instance of the exact bug being fixed.
 *     Keying off the port instead makes two sources of truth for one port
 *     structurally impossible: there is no wiring anyone can forget.
 *  2. **Re-render area.** The five consumers sit in five different subtrees
 *     (sidebar footer, composer, hero, highlights shelf, the task hook), so a
 *     provider has to live at the root and every settings change re-renders
 *     the whole application. `useSyncExternalStore` wakes only the components
 *     that actually subscribed, and `useReduceMotion` narrows that further to
 *     a single boolean.
 *
 * Extending `ShellContext` was not on the table: that is this window's view
 * state, persisted to localStorage by the shell itself, while these are
 * workspace preferences that live behind the port. Same word, different
 * lifetime and different owner.
 *
 * ## Keyed by port, held weakly
 *
 * The port object is the identity of the workspace connection, so one store per
 * port is exactly one store per workspace. Tests build a fresh fake port per
 * render, which is why the suite does not need a reset hook and why one test's
 * toggled preference cannot leak into the next.
 */
export class SettingsStore {
  readonly #port: UiPort;
  #snapshot: SettingsSnapshot = { value: FALLBACK_SETTINGS, models: [] };
  readonly #listeners = new Set<() => void>();
  #load: "idle" | "running" | "done" = "idle";
  /**
   * Whether the user has already changed something.
   *
   * The initial read and a toggle can overlap — the port resolves folders,
   * files, settings and models on mount, and the sidebar menu is clickable
   * throughout. Without this, a slow `settings.get()` landing after a fast
   * `settings.patch()` would put the old value back on screen, which is the
   * same visible symptom as the bug this store exists to fix.
   */
  #patched = false;

  constructor(port: UiPort) {
    this.#port = port;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SettingsSnapshot => this.#snapshot;

  /**
   * Reads the port once per store, however many components ask.
   *
   * The old hook did this in a `useEffect` keyed on the port, which is why
   * there were five reads of the same two endpoints on every mount. A failed
   * read clears the flag so the next component to mount retries — the previous
   * version let the rejection float off unhandled and left every reader on the
   * fallback with nothing said.
   */
  readonly load = (): void => {
    if (this.#load !== "idle") return;
    this.#load = "running";
    void (async () => {
      try {
        const [settings, models] = await Promise.all([
          this.#port.settings.get(),
          this.#port.models.list(),
        ]);
        this.#load = "done";
        this.#emit({
          value: this.#patched
            ? withLiveModel(this.#snapshot.value, models)
            : withLiveModel(settings, models),
          models,
        });
      } catch (reason) {
        this.#load = "idle";
        reportPortFailure(reason);
      }
    })();
  };

  /**
   * Applies a preference optimistically, then reconciles with the port.
   *
   * Optimistic because a checkbox that waits for a round trip feels broken, and
   * every one of these is a toggle the user just pressed.
   *
   * On failure it rolls back **only the keys this call touched**, rather than
   * restoring the whole pre-patch snapshot: two toggles can be in flight at
   * once, and a blanket restore would quietly undo the other one. Then it
   * reports — a control that swallows its own failure and keeps showing the new
   * value is lying about it, which is the same defect as S7-002 wearing a
   * different hat.
   *
   * Never rejects, so the call sites' `void settings.patch(...)` cannot turn
   * into an unhandled rejection. Returns whether the port accepted it.
   */
  readonly patch = async (next: Partial<ShellSettings>): Promise<boolean> => {
    const before = this.#snapshot.value;
    this.#patched = true;
    this.#emit({ ...this.#snapshot, value: { ...before, ...next } });
    try {
      const confirmed = await this.#port.settings.patch(next);
      this.#emit({ ...this.#snapshot, value: confirmed });
      return true;
    } catch (reason) {
      const rollback: Partial<ShellSettings> = {};
      for (const key of Object.keys(next) as Array<keyof ShellSettings>) {
        Object.assign(rollback, { [key]: before[key] });
      }
      this.#emit({ ...this.#snapshot, value: { ...this.#snapshot.value, ...rollback } });
      reportPortFailure(reason);
      return false;
    }
  };

  /**
   * Re-reads the model list after the custom-model dialog has changed it.
   *
   * Shared for the same reason the settings are: adding a model from the
   * composer used to leave every other reader of `models` on the old list.
   */
  readonly reloadModels = async (): Promise<void> => {
    try {
      const models = await this.#port.models.list();
      this.#emit({ models, value: withLiveModel(this.#snapshot.value, models) });
    } catch (reason) {
      reportPortFailure(reason);
    }
  };

  #emit(snapshot: SettingsSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of [...this.#listeners]) listener();
  }
}

const stores = new WeakMap<UiPort, SettingsStore>();

/** The store for this port, created on first ask. */
export function settingsStoreFor(port: UiPort): SettingsStore {
  let store = stores.get(port);
  if (!store) {
    store = new SettingsStore(port);
    stores.set(port, store);
  }
  return store;
}

import { useEffect, useSyncExternalStore } from "react";

import { usePort } from "../port/PortContext";
import { settingsStoreFor, type SettingsStore } from "./settingsStore";
import type { Model, ShellSettings } from "../../shared/uiPort";

export { FALLBACK_SETTINGS, type SettingsSnapshot } from "./settingsStore";

/** Subscribes this component to the port's one settings store. */
function useSettingsStore(): SettingsStore {
  const port = usePort();
  const store = settingsStoreFor(port);
  // In an effect rather than during render: the first read is a side effect on
  // the port, and StrictMode calls render twice.
  useEffect(() => store.load(), [store]);
  return store;
}

export interface ComposerSettings {
  value: ShellSettings;
  models: Model[];
  /**
   * Applies a change everywhere at once. Resolves to whether the port took it;
   * never rejects, and rolls back and reports if it did not (see the store).
   */
  patch: (next: Partial<ShellSettings>) => Promise<boolean>;
  reloadModels: () => Promise<void>;
}

/**
 * Composer-facing settings and model list.
 *
 * These live behind the port rather than in the shell's own persistence: which
 * model you use and how much the agent may do without asking are properties of
 * the workspace, not of this window, so they must survive a reinstall of the
 * UI and be readable by the service side.
 *
 * Every caller gets the *same* values, and a `patch` from any one of them is on
 * screen in all of them before the next frame. That used not to be true — each
 * call site held a private `useState` — and the two menus that both show "Enter
 * sends" disagreed with each other in the same screenshot (audit S7-002). The
 * shared state lives in `settingsStore.ts`, which explains why it is a store
 * keyed by the port and not a Context provider.
 */
export function useComposerSettings(): ComposerSettings {
  const store = useSettingsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    value: snapshot.value,
    models: snapshot.models,
    patch: store.patch,
    reloadModels: store.reloadModels,
  };
}

/**
 * Just the Reduced motion preference.
 *
 * For callers that animate but have no business re-rendering when the model
 * list changes — `App` mounts the workspace's attention border and nothing
 * else here concerns it. A boolean also means the subscription compares by
 * value, so adding a model does not repaint the whole shell.
 */
export function useReduceMotion(): boolean {
  const store = useSettingsStore();
  const read = () => store.getSnapshot().value.reduceMotion;
  return useSyncExternalStore(store.subscribe, read, read);
}

import { useSyncExternalStore } from "react";

/**
 * Whether the machine has a connection — OD-UI-1.2 §13.
 *
 * Offline is a state of the workspace, not an error: local files stay
 * editable, AI tasks wait. What the browser reports is the only source; the
 * review fixture can hold it at "offline" so the state can be looked at without
 * pulling a cable.
 */
let held: boolean | null = null;
const listeners = new Set<() => void>();

const read = () => held ?? (typeof navigator === "undefined" ? true : navigator.onLine !== false);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

export const useOnline = (): boolean => useSyncExternalStore(subscribe, read, () => true);

/** Fixture seam: `false` holds the workspace offline, `null` hands it back to the browser. */
export function holdOnline(value: boolean | null) {
  held = value;
  listeners.forEach((listener) => listener());
}

/** Looks again. Resolves to whether there is a connection now. */
export function reconnect(): boolean {
  holdOnline(null);
  return read();
}

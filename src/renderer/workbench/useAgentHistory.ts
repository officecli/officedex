import { useMemo, useSyncExternalStore, type SetStateAction } from "react";

/** File paths survive preview tokens, editor sessions and application restarts. */
export function agentHistoryKey(kind: "docx" | "xlsx" | "pptx" | "img", filePath?: string) {
  return filePath ? `officedex.agent-history.v1:${kind}:${filePath}` : undefined;
}

/** Codecs only restore display data; editor handles and executable state stay in memory. */
export interface HistoryCodec<T> {
  read: (value: unknown) => T[];
  write: (items: T[]) => unknown;
}

export function useAgentHistory<T>(key: string | undefined, codec: HistoryCodec<T>) {
  const store = useMemo(() => {
    let items: T[] = [];
    if (key) {
      try { items = codec.read(JSON.parse(localStorage.getItem(key) ?? "[]")); }
      catch { /* A damaged or unavailable store must not prevent opening a file. */ }
    }
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => items,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      set: (action: SetStateAction<T[]>) => {
        items = typeof action === "function" ? action(items) : action;
        // Persist immediately: closing a panel can unmount it before an effect runs.
        if (key) {
          try { localStorage.setItem(key, JSON.stringify(codec.write(items))); }
          catch (error) { console.warn("Could not save Agent history", error); }
        }
        listeners.forEach((listener) => listener());
      },
    };
  }, [key, codec]);
  return [useSyncExternalStore(store.subscribe, store.getSnapshot), store.set] as const;
}

export interface AgentHistoryMessage { role: "user" | "assistant"; text: string }
export const messageHistoryCodec: HistoryCodec<AgentHistoryMessage> = {
  read: (value) => Array.isArray(value) ? value.filter((item): item is AgentHistoryMessage =>
    item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string") : [],
  write: (items) => items,
};

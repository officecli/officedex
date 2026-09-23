import { useEffect, useRef } from "react";

import type { FileType } from "../../shared/uiPort";

/**
 * "Start a new task of this kind" — from the sidebar to Home's composer.
 *
 * The sidebar's New task menu and the hero composer are never on screen as a
 * parent and child: picking a kind is what brings Home up, so the hero may not
 * exist yet when the request is made. A request made with nobody listening is
 * held until the hero mounts and takes it; one made while it is showing is
 * delivered straight away.
 */

export type HomeStartKind = FileType;

type Listener = (kind: HomeStartKind) => void;

const listeners = new Set<Listener>();
let pending: HomeStartKind | null = null;

export function requestHomeStart(kind: HomeStartKind): void {
  if (listeners.size === 0) {
    pending = kind;
    return;
  }
  for (const listener of [...listeners]) listener(kind);
}

export function useHomeStartRequests(onStart: (kind: HomeStartKind) => void): void {
  const latest = useRef(onStart);

  useEffect(() => {
    latest.current = onStart;
  });

  useEffect(() => {
    const listener: Listener = (kind) => latest.current(kind);
    listeners.add(listener);
    if (pending) {
      const kind = pending;
      pending = null;
      listener(kind);
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

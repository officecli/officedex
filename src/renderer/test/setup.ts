import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DialogHost, Modal, toast } from "../ui";
import { createElement } from "react";
import { afterEach, beforeEach } from "vitest";

const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window);

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom ships no ResizeObserver; components that measure their own box (the
// template rail's overflow arrows) would otherwise throw on mount.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: NoopResizeObserver,
  });
}

Object.defineProperty(window, "getComputedStyle", {
  configurable: true,
  writable: true,
  value: (element: Element, _pseudoElement?: string | null) => getComputedStyleWithoutPseudo(element),
});

beforeEach(() => {
  render(createElement(DialogHost));
});

afterEach(async () => {
  toast.destroy();
  Modal.destroyAll();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

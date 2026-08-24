import { act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { message, Modal } from "antd";
import { afterEach } from "vitest";

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

Object.defineProperty(window, "getComputedStyle", {
  configurable: true,
  writable: true,
  value: (element: Element, _pseudoElement?: string | null) => getComputedStyleWithoutPseudo(element),
});

afterEach(async () => {
  // vitest runs with globals: false, so RTL cannot register its own auto-cleanup
  cleanup();
  message.destroy();
  Modal.destroyAll();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

import { act } from "@testing-library/react";
import { message, Modal } from "antd";
import { afterEach } from "vitest";

const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window);

Object.defineProperty(window, "getComputedStyle", {
  configurable: true,
  writable: true,
  value: (element: Element, _pseudoElement?: string | null) => getComputedStyleWithoutPseudo(element),
});

afterEach(async () => {
  message.destroy();
  Modal.destroyAll();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

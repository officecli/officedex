import { createElement } from "react";
import type { ComponentType } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { Shell } from "./Shell";

vi.mock("../bridge", () => ({
  officecli: new Proxy({} as DesktopAPI, {
    get(_target, prop) {
      if (prop === "getBridgeRuntimeSnapshot") {
        return vi.fn(async () => null);
      }
      if (prop === "onBridgeEvent") {
        return vi.fn(() => () => undefined);
      }
      return vi.fn();
    },
  }),
}));

afterEach(() => {
  cleanup();
});

describe("Shell sidebar layout", () => {
  it("places the credit meter above Profile in the sidebar footer", () => {
    render(
      <LocaleProvider value="en">
        {createElement(
          Shell as unknown as ComponentType<Record<string, unknown>>,
          {
            activeNav: "tasks",
            bridgeStatus: "connected",
            failed: false,
            tasks: [],
            selectedTaskId: undefined,
            conversations: [],
            selectedConversationId: undefined,
            credit: { displayMode: "balance", used: 0, total: 42, planLabel: "Credits" },
            onNavChange: vi.fn(),
            onNewGeneration: vi.fn(),
            onSelectTask: vi.fn(),
            onDeleteTask: vi.fn(),
            onDeleteConversation: vi.fn(),
          },
          <div />,
        )}
      </LocaleProvider>,
    );

    const meter = screen.getByRole("group", { name: /credit balance/i });
    const profile = screen.getByRole("button", { name: /profile/i });

    expect(meter.compareDocumentPosition(profile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

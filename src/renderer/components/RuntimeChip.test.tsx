import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { RuntimeChip } from "./RuntimeChip";
import type { BridgeRuntimeSnapshot, DesktopAPI } from "../../shared/types";

const mockGetSnapshot = vi.fn();
const mockOnBridge = vi.fn(() => () => undefined);

vi.mock("../bridge", () => ({
  officecli: new Proxy({} as DesktopAPI, {
    get(_target, prop) {
      if (prop === "getBridgeRuntimeSnapshot") return mockGetSnapshot;
      if (prop === "onBridgeEvent") return mockOnBridge;
      return vi.fn();
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

function snapshot(overrides: Partial<BridgeRuntimeSnapshot>): BridgeRuntimeSnapshot {
  return {
    runtimeMode: "hosted",
    binaryPath: "",
    envApplied: false,
    ...overrides,
  };
}

describe("RuntimeChip", () => {
  it("renders Official tag when in hosted mode", async () => {
    mockGetSnapshot.mockResolvedValueOnce(snapshot({ runtimeMode: "hosted" }));
    render(<RuntimeChip />);
    await waitFor(() => {
      expect(screen.getByText(/Official|官方/)).toBeTruthy();
    });
  });

  it("renders pending tag when custom mode but env not applied", async () => {
    mockGetSnapshot.mockResolvedValueOnce(
      snapshot({ runtimeMode: "custom", envApplied: false }),
    );
    render(<RuntimeChip />);
    await waitFor(() => {
      expect(screen.getByText(/pending|待激活/)).toBeTruthy();
    });
  });

  it("renders custom label with model when applied", async () => {
    mockGetSnapshot.mockResolvedValueOnce(
      snapshot({
        runtimeMode: "custom",
        envApplied: true,
        resolvedAt: "2026-05-25T10:00:00Z",
        binaryPath: "/tmp/officecli",
        provider: {
          type: "openai",
          baseUrlHost: "https://api.openai.com",
          model: "gpt-4o-mini",
          apiKeyMasked: "sk-a••••••wxyz",
          apiKeyLength: 43,
        },
      }),
    );
    render(<RuntimeChip />);
    await waitFor(() => {
      expect(screen.getByText(/gpt-4o-mini/)).toBeTruthy();
    });
    // Trust signal must not leak raw key into the chip text.
    expect(document.body.textContent).not.toContain("sk-a-real-key");
  });
});

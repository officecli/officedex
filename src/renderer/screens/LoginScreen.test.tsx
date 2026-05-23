import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthEvent, DesktopAPI, WhoAmIResult } from "../../shared/types";
import { officecli } from "../bridge";

function installDomStubs() {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}

let whoamiSpy: ReturnType<typeof vi.fn>;
let loginSpy: ReturnType<typeof vi.fn>;
let cancelLoginSpy: ReturnType<typeof vi.fn>;
let logoutSpy: ReturnType<typeof vi.fn>;
let openExternalSpy: ReturnType<typeof vi.fn>;
let authListener: ((event: AuthEvent) => void) | null = null;
let originals: Partial<DesktopAPI>;

beforeEach(() => {
  installDomStubs();
  authListener = null;
  whoamiSpy = vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "anonymous" }));
  loginSpy = vi.fn(async () => ({ url: "https://example.com/login" }));
  cancelLoginSpy = vi.fn(async () => undefined);
  logoutSpy = vi.fn(async () => undefined);
  openExternalSpy = vi.fn(async () => undefined);
  originals = {
    whoami: officecli.whoami,
    login: officecli.login,
    cancelLogin: officecli.cancelLogin,
    logout: officecli.logout,
    openExternal: officecli.openExternal,
    onAuthEvent: officecli.onAuthEvent,
  };
  officecli.whoami = whoamiSpy as unknown as DesktopAPI["whoami"];
  officecli.login = loginSpy as unknown as DesktopAPI["login"];
  officecli.cancelLogin = cancelLoginSpy as unknown as DesktopAPI["cancelLogin"];
  officecli.logout = logoutSpy as unknown as DesktopAPI["logout"];
  officecli.openExternal = openExternalSpy as unknown as DesktopAPI["openExternal"];
  officecli.onAuthEvent = ((callback: (event: AuthEvent) => void) => {
    authListener = callback;
    return () => {
      authListener = null;
    };
  }) as unknown as DesktopAPI["onAuthEvent"];
});

afterEach(() => {
  cleanup();
  Object.assign(officecli, originals);
  vi.restoreAllMocks();
});

describe("LoginScreen", () => {
  it("calls whoami on mount and shows anonymous state with sign-in button", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /sign in via browser/i })).toBeTruthy();
  });

  it("clicking Sign in calls login() and renders the awaiting URL", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /sign in via browser/i }));
    await waitFor(() => expect(loginSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/waiting for browser sign-in/i)).toBeTruthy();
    expect(screen.getByText("https://example.com/login")).toBeTruthy();
  });

  it("auth url event flips the screen into awaiting state", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    expect(authListener).toBeTruthy();
    act(() => {
      authListener!({ type: "url", url: "https://example.com/sso?state=abc" });
    });
    expect(await screen.findByText("https://example.com/sso?state=abc")).toBeTruthy();
  });

  it("auth success refreshes whoami and shows signed-in info with user id", async () => {
    whoamiSpy.mockResolvedValueOnce({ mode: "anonymous" });
    whoamiSpy.mockResolvedValueOnce({ mode: "logged_in", userId: "user-123", session: "sess-xyz" });
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));

    act(() => {
      authListener!({ type: "success" });
    });

    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("user-123")).toBeTruthy();
    expect(screen.getByText("sess-xyz")).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("Sign out calls logout and returns to anonymous state", async () => {
    whoamiSpy.mockResolvedValueOnce({ mode: "logged_in", userId: "user-123" });
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));

    const signOutButton = await screen.findByRole("button", { name: /sign out/i });
    fireEvent.click(signOutButton);
    await waitFor(() => expect(logoutSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /sign in via browser/i })).toBeTruthy();
  });

  it("auth failure event renders the failure state with Try again", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));

    act(() => {
      authListener!({ type: "failure", message: "Unauthorized provider response" });
    });

    expect(await screen.findByText("Unauthorized provider response")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("Cancel during awaiting calls cancelLogin and returns to anonymous", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /sign in via browser/i }));
    await waitFor(() => expect(loginSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(cancelLoginSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /sign in via browser/i })).toBeTruthy();
  });

  it("Open again on the awaiting URL calls openExternal with the login URL", async () => {
    const { LoginScreen } = await import("./SettingsScreens");
    render(<LoginScreen />);
    await waitFor(() => expect(whoamiSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /sign in via browser/i }));
    await waitFor(() => expect(loginSpy).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: /open again/i }));
    await waitFor(() => expect(openExternalSpy).toHaveBeenCalledWith("https://example.com/login"));
  });
});

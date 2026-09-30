import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthEvent, DesktopAPI, WhoAmIResult } from "../../shared/types";
import { LocaleProvider } from "../../renderer/i18n";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import { SEED_ACTIVE_FILE_ID } from "../port/fake/seed";
import { renderShell } from "../test/renderShell";
import { AccountPage } from "./AccountPage";
import { accountFromWhoAmI } from "./useAccount";

// `globals: false` in vite.config means Testing Library never registers its own
// afterEach, so every suite in this repo unmounts explicitly.
afterEach(cleanup);

/**
 * A desktop API that is only the account surface.
 *
 * The transport is injected rather than spied on the module singleton: the
 * shell reaches it through `useDesktopApi`, and a test that patches the global
 * would still pass if the component forgot the context.
 */
function makeApi(overrides: Partial<DesktopAPI> = {}) {
  let listener: ((event: AuthEvent) => void) | null = null;
  const spies = {
    whoami: vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "anonymous" })),
    login: vi.fn(async () => ({ url: "https://example.com/verify?code=abc" })),
    cancelLogin: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined),
    onAuthEvent: vi.fn((callback: (event: AuthEvent) => void) => {
      listener = callback;
      return () => {
        listener = null;
      };
    }),
    ...overrides,
  };
  return {
    api: spies as unknown as DesktopAPI,
    spies,
    emit: (event: AuthEvent) => listener?.(event),
  };
}

function renderPage(options: {
  api: DesktopAPI;
  onClose?: () => void;
  onAccountChanged?: () => void;
}) {
  const onClose = options.onClose ?? vi.fn();
  const onAccountChanged = options.onAccountChanged ?? vi.fn();
  render(
    <LocaleProvider>
      <DesktopApiProvider api={options.api}>
        <AccountPage onClose={onClose} onAccountChanged={onAccountChanged} />
      </DesktopApiProvider>
    </LocaleProvider>,
  );
  return { onClose, onAccountChanged };
}

const signInButton = () => screen.findByRole("button", { name: /sign in via browser/i });

describe("accountFromWhoAmI", () => {
  it("reads anonymous as anonymous, and prefers the email as the name", () => {
    expect(accountFromWhoAmI({ mode: "anonymous" })).toEqual({ mode: "anonymous" });
    expect(accountFromWhoAmI({ mode: "logged_in", email: "someone@example.com", userId: "usr-7" })).toEqual(
      { mode: "account", label: "someone@example.com" },
    );
  });

  it("falls back to the user id, and never invents a name", () => {
    expect(accountFromWhoAmI({ mode: "logged_in", userId: "usr-7" })).toEqual({
      mode: "account",
      label: "usr-7",
    });
    // A paid API key is not a browser session, but it is not anonymous either:
    // the CLI can do the work, which is the only thing the chip is claiming.
    expect(accountFromWhoAmI({ mode: "api_key", userId: "usr-9" })).toEqual({
      mode: "account",
      label: "usr-9",
    });
    expect(accountFromWhoAmI({ mode: "logged_in" })).toEqual({ mode: "account" });
  });
});

describe("AccountPage", () => {
  it("asks whoami once and offers the browser hand-off", async () => {
    const { api, spies } = makeApi();
    renderPage({ api });

    expect(await signInButton()).toBeTruthy();
    expect(spies.whoami).toHaveBeenCalledTimes(1);
  });

  it("says it is checking while whoami is still out", async () => {
    const whoami = vi.fn(() => new Promise<WhoAmIResult>(() => {}));
    const { api } = makeApi({ whoami });
    renderPage({ api });

    expect(await screen.findByText(/verifying your local session/i)).toBeTruthy();
  });

  it("opens the verification URL and shows it while waiting", async () => {
    const { api, spies } = makeApi();
    renderPage({ api });

    fireEvent.click(await signInButton());

    expect(await screen.findByText(/waiting for browser sign-in/i)).toBeTruthy();
    expect(await screen.findByText("https://example.com/verify?code=abc")).toBeTruthy();
    expect(spies.login).toHaveBeenCalledWith({});
    // The page opens the browser itself: the CLI runs with OFFICECLI_NO_BROWSER=1.
    expect(spies.openExternal).toHaveBeenCalledWith("https://example.com/verify?code=abc");
  });

  it("reports the account change only after whoami confirms a completed sign-in", async () => {
    const whoami = vi
      .fn<() => Promise<WhoAmIResult>>()
      .mockResolvedValueOnce({ mode: "anonymous" })
      .mockResolvedValueOnce({ mode: "logged_in", email: "someone@example.com" });
    const { api, emit } = makeApi({ whoami });
    const { onAccountChanged } = renderPage({ api });

    fireEvent.click(await signInButton());
    emit({ type: "url", url: "https://example.com/verify?code=abc" });
    emit({ type: "success" });

    expect(await screen.findByText(/connected as someone@example.com/i)).toBeTruthy();
    expect(onAccountChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("recovers a missed success event when returning from the browser", async () => {
    const whoami = vi.fn<() => Promise<WhoAmIResult>>()
      .mockResolvedValueOnce({ mode: "anonymous" })
      .mockResolvedValueOnce({ mode: "logged_in", email: "demo@example.com" });
    const { api } = makeApi({ whoami });
    const { onAccountChanged } = renderPage({ api });
    fireEvent.click(await signInButton());
    await screen.findByText(/waiting for browser sign-in/i);
    fireEvent.focus(window);
    expect(await screen.findByText(/connected as demo@example.com/i)).toBeTruthy();
    expect(onAccountChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting if checked too early, then allows manual confirmation", async () => {
    const whoami = vi.fn<() => Promise<WhoAmIResult>>()
      .mockResolvedValueOnce({ mode: "anonymous" })
      .mockResolvedValueOnce({ mode: "anonymous" })
      .mockResolvedValueOnce({ mode: "logged_in", email: "demo@example.com" });
    const { api } = makeApi({ whoami });
    renderPage({ api });
    fireEvent.click(await signInButton());
    const check = await screen.findByRole("button", { name: /refresh status/i });
    fireEvent.click(check);
    await waitFor(() => expect(whoami).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/waiting for browser sign-in/i)).toBeTruthy();
    fireEvent.click(check);
    expect(await screen.findByText(/connected as demo@example.com/i)).toBeTruthy();
  });

  it("does not claim a broadcast sign-in that this page did not start", async () => {
    const whoami = vi
      .fn<() => Promise<WhoAmIResult>>()
      .mockResolvedValueOnce({ mode: "anonymous" })
      .mockResolvedValueOnce({ mode: "logged_in", email: "someone@example.com" });
    const { api, emit } = makeApi({ whoami });
    const { onAccountChanged } = renderPage({ api });

    await signInButton();
    emit({ type: "success" });

    expect(await screen.findByText(/connected as someone@example.com/i)).toBeTruthy();
    expect(onAccountChanged).not.toHaveBeenCalled();
  });

  it("signs out and tells the chip", async () => {
    const whoami = vi.fn(async (): Promise<WhoAmIResult> => ({ mode: "logged_in", email: "someone@example.com" }));
    const { api, spies } = makeApi({ whoami });
    const { onAccountChanged } = renderPage({ api });

    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    expect(await signInButton()).toBeTruthy();
    expect(spies.logout).toHaveBeenCalledTimes(1);
    expect(onAccountChanged).toHaveBeenCalledTimes(1);
  });

  it("reports a whoami failure instead of guessing, and retries the flow", async () => {
    const whoami = vi.fn(async (): Promise<WhoAmIResult> => {
      throw new Error("officecli is not installed");
    });
    const { api, spies } = makeApi({ whoami });
    renderPage({ api });

    expect(await screen.findByText(/officecli is not installed/i)).toBeTruthy();

    // "Try again" restarts the hand-off rather than re-asking whoami — the same
    // thing the old renderer's login page does, and the reason both entry points
    // can be reasoned about together.
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));
    expect(await screen.findByText(/waiting for browser sign-in/i)).toBeTruthy();
    expect(spies.login).toHaveBeenCalledTimes(1);
  });

  it("closes back to the shell", async () => {
    const { api } = makeApi();
    const { onClose } = renderPage({ api });

    fireEvent.click(await screen.findByRole("button", { name: /back to officedex/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the shell's account entry", () => {
  /*
   * The wiring, not the page: the sidebar's account row goes to Settings →
   * Account & usage, that section owns the sign-in button, and App owns the
   * open flag the button sets. Also the property that decided the whole shape —
   * the shell is still mounted behind the cover, so an open document survives a
   * trip to sign in.
   */
  it("reaches the account page from the sidebar, over a live shell", async () => {
    const shell = await renderShell();
    await shell.dispatch({ type: "open-file", fileId: SEED_ACTIVE_FILE_ID });
    const host = shell.canvasHost();

    const row = await waitFor(() => {
      const node = shell.view.container.querySelector<HTMLElement>("button.dx-account-row[data-act=account]");
      if (!node) throw new Error("account row is missing");
      return node;
    });
    /*
     * The browser preview has no CLI to ask, so this is the honest label — not a
     * name, and not an empty control.
     */
    await waitFor(() => expect(row.textContent).toContain("Guest"));

    fireEvent.click(row);

    expect(shell.state().page).toBe("settings");
    expect(shell.state().settingsSection).toBe("account");
    const signIn = await waitFor(() => {
      const node = shell.view.container.querySelector<HTMLElement>("[data-act=sign-in]");
      if (!node) throw new Error("the Account & usage section has no sign-in button");
      return node;
    });
    expect(signIn.textContent).toContain("Sign in");

    fireEvent.click(signIn);

    expect(await screen.findByRole("dialog")).toBeTruthy();
    // The cover is over the shell, not instead of it: the sidebar is still
    // there and the document's editor was never torn down.
    expect(shell.view.container.querySelector("#dx-sidebar")).toBeTruthy();
    expect(shell.view.container.querySelector(".shell-account")).toBeTruthy();
    expect(Object.is(host, shell.canvasHost())).toBe(true);
    expect(shell.state().openFileIds).toContain(SEED_ACTIVE_FILE_ID);
  });
});

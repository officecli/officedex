import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../renderer/i18n";
import { DesktopApiProvider } from "../../renderer/services/desktopApi";
import type { DesktopAPI, UserSettings } from "../../shared/types";
import { USAGE_NOTICE_KEY, UsageNotice } from "./UsageNotice";

function mount(settings: Partial<UserSettings>) {
  const patches: Array<Partial<UserSettings>> = [];
  const api = {
    getSettings: vi.fn(async () => ({ usageAnalyticsEnabled: true, ...settings }) as UserSettings),
    getDefaultWorkspaceDir: vi.fn(async () => "/tmp"),
    updateSettings: vi.fn(async (patch: Partial<UserSettings>) => {
      patches.push(patch);
      return { usageAnalyticsEnabled: true, ...settings, ...patch } as UserSettings;
    }),
  } as unknown as DesktopAPI;
  render(
    <LocaleProvider>
      <DesktopApiProvider api={api}>
        <UsageNotice />
      </DesktopApiProvider>
    </LocaleProvider>,
  );
  return { api, patches };
}

describe("UsageNotice", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("officedex.locale", "en");
  });
  afterEach(cleanup);

  it("tells a new install once and remembers that it did", async () => {
    mount({});
    const accept = await screen.findByRole("button", { name: "Got it" });
    fireEvent.click(accept);

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(window.localStorage.getItem(USAGE_NOTICE_KEY)).not.toBeNull();

    cleanup();
    const { api } = mount({});
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("turns reporting off from the notice", async () => {
    const { patches } = mount({});
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(patches).toEqual([{ usageAnalyticsEnabled: false }]));
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.localStorage.getItem(USAGE_NOTICE_KEY)).not.toBeNull();
  });

  it("says nothing to an install that already turned reporting off", async () => {
    const { api } = mount({ usageAnalyticsEnabled: false });
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
    expect(window.localStorage.getItem(USAGE_NOTICE_KEY)).toBeNull();
  });

  it("names what is never reported", async () => {
    mount({});
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/never include document content, file names or prompts/);
    expect(notice.textContent).toMatch(/Settings/);
  });
});

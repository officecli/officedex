import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, LOCALE_STORAGE_KEY, useLocale, useSetLocale, useT, type Locale } from "./index";

function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
  };
}

function wrapper(value?: Locale) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <LocaleProvider value={value}>{children}</LocaleProvider>;
  };
}

describe("LocaleProvider runtime switching", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("useT returns the matching language after switching locale", () => {
    const { result } = renderHook(
      () => ({ locale: useLocale(), setLocale: useSetLocale(), t: useT() }),
      { wrapper: wrapper() },
    );

    act(() => result.current.setLocale("zh"));
    expect(result.current.locale).toBe("zh");
    expect(result.current.t("settings.row.language.title")).toBe("界面语言");

    act(() => result.current.setLocale("en"));
    expect(result.current.locale).toBe("en");
    expect(result.current.t("settings.row.language.title")).toBe("Language");
  });

  it("persists the selected locale to localStorage", () => {
    const { result } = renderHook(() => useSetLocale(), { wrapper: wrapper() });

    act(() => result.current("zh"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh");

    act(() => result.current("en"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("restores the persisted locale on remount (simulated refresh)", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh");

    const { result } = renderHook(() => useLocale(), { wrapper: wrapper() });
    expect(result.current).toBe("zh");
  });

  it("ignores invalid stored values and falls back to detection", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

    const { result } = renderHook(() => useLocale(), { wrapper: wrapper() });
    expect(["en", "zh"]).toContain(result.current);
    expect(result.current).not.toBe("fr");
  });

  it("value prop forces a fixed locale and disables switching", () => {
    const { result } = renderHook(
      () => ({ locale: useLocale(), setLocale: useSetLocale() }),
      { wrapper: wrapper("en") },
    );

    expect(result.current.locale).toBe("en");
    act(() => result.current.setLocale("zh"));
    expect(result.current.locale).toBe("en");
  });

  it("rerenders consumers when locale changes", () => {
    function Probe() {
      const t = useT();
      const setLocale = useSetLocale();
      return (
        <button type="button" onClick={() => setLocale("zh")}>
          {t("settings.row.language.title")}
        </button>
      );
    }

    const { getByRole } = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    const button = getByRole("button");
    expect(["Language", "界面语言"]).toContain(button.textContent);
    act(() => button.click());
    expect(button.textContent).toBe("界面语言");
  });
});

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";
type Dictionary = Record<string, string>;
const dictionaries: Record<Locale, Dictionary> = { en, zh };

export const LOCALE_STORAGE_KEY = "officedex.locale";

export function detectLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

function readStoredLocale(): Locale | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === "en" || stored === "zh" ? stored : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures (private mode, quota): the in-memory choice still applies.
  }
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({ locale: detectLocale(), setLocale: () => {} });

export function LocaleProvider({ value, children }: { value?: Locale; children: ReactNode }) {
  const [stateLocale, setStateLocale] = useState<Locale>(() => readStoredLocale() ?? detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setStateLocale(next);
    persistLocale(next);
  }, []);

  // `value` forces a fixed locale (used by tests/embeds) and disables switching.
  const locale = value ?? stateLocale;
  const contextValue = useMemo<LocaleContextValue>(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale(): (next: Locale) => void {
  return useContext(LocaleContext).setLocale;
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useMemo(() => {
    const dict = dictionaries[locale] ?? en;
    return (key: string, vars?: Record<string, string | number>) => {
      const raw = dict[key] ?? en[key] ?? key;
      if (!vars) return raw;
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), raw);
    };
  }, [locale]);
}

export { en, zh };

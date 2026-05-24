import { createContext, useContext, useMemo, type ReactNode } from "react";
import { en } from "./en";
import { zh } from "./zh";

export type Locale = "en" | "zh";
type Dictionary = Record<string, string>;
const dictionaries: Record<Locale, Dictionary> = { en, zh };

export function detectLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

const LocaleContext = createContext<Locale>(detectLocale());

export function LocaleProvider({ value, children }: { value?: Locale; children: ReactNode }) {
  const locale = value ?? detectLocale();
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
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

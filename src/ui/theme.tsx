/**
 * Theme selection ("سیستم / روشن / تیره") — Settings screen, Stage 2 task
 * description part A.4. Persisted locally and applied instantly by
 * toggling a `data-theme` attribute on <html>, which theme.css reads
 * alongside the existing `prefers-color-scheme` media query for "سیستم".
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "tabpal:theme";

function readStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function setTheme(mode: ThemeMode) {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    setThemeState(mode);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}

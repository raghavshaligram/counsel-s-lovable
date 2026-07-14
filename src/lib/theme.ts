import { useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light" | "system";
const KEY = "paperlane:theme";

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : theme;
  root.classList.add(resolved);
}

/**
 * Paperlane theme controller. Dark is the default (matches existing chrome).
 * Users can opt into light or follow system through the account menu.
 * Persisted to localStorage under `paperlane:theme`.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    try {
      const stored = (window.localStorage.getItem(KEY) as Theme | null) ?? "dark";
      setThemeState(stored);
      apply(stored);
    } catch {
      apply("dark");
    }
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { window.localStorage.setItem(KEY, t); } catch {}
    apply(t);
  }, []);

  return { theme, setTheme };
}

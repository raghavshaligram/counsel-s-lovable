import { useEffect } from "react";

type Handler = (e: KeyboardEvent) => void;

/**
 * Bind a global keyboard shortcut. Pass a falsy `when` to disable.
 * - "mod" matches Cmd on macOS, Ctrl elsewhere.
 *
 * Example: useHotkey("mod+Enter", run, !busy && !!file)
 */
export function useHotkey(combo: string, handler: Handler, when: boolean = true) {
  useEffect(() => {
    if (!when) return;
    const parts = combo.toLowerCase().split("+").map((p) => p.trim());
    const needMod = parts.includes("mod");
    const needShift = parts.includes("shift");
    const needAlt = parts.includes("alt");
    const key = parts[parts.length - 1];

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const editable = (e.target as HTMLElement | null)?.isContentEditable;
      // Allow shortcuts in inputs only if mod is held (e.g. Cmd+Enter)
      if (!needMod && (tag === "INPUT" || tag === "TEXTAREA" || editable)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (needMod !== mod) return;
      if (needShift !== e.shiftKey) return;
      if (needAlt !== e.altKey) return;
      if (e.key.toLowerCase() !== key && (key !== "esc" || e.key !== "Escape")) return;

      e.preventDefault();
      handler(e);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, handler, when]);
}

/** Detect macOS for displaying the right modifier symbol. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modKey(): string {
  return isMac() ? "⌘" : "Ctrl";
}

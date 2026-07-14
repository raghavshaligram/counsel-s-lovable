/**
 * Persist the user's preference for the canvas floating toolbar:
 * floating (default) or pinned to the top of the canvas as a docked strip.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "vault:toolbar-pinned";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useToolbarPin(): [boolean, (v: boolean) => void] {
  const [pinned, setPinnedState] = useState(false);

  // Read after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    setPinnedState(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setPinnedState(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPinned = useCallback((v: boolean) => {
    setPinnedState(v);
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  return [pinned, setPinned];
}

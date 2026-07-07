/**
 * Per-document Bates settings store.
 *
 * Settings persist in localStorage keyed by "<filename>::<size>" so reopening
 * the same document restores the configured prefix/start/etc. Shared between
 * the Document Settings inspector and the Export dialog, so the toggle in
 * Export reflects the same config the user sees in Document Settings.
 */
import { useEffect, useState, useCallback } from "react";
import type { BatesOpts, BatesPosition, BatesColor } from "@/lib/batch/ops/bates";

export type BatesSettings = BatesOpts & {
  on: boolean;
  /** Set when "Apply to active tab" successfully burned Bates into the tab bytes. */
  appliedAt?: number;
  /** Fingerprint of the settings at the moment they were applied. */
  appliedFingerprint?: string;
};

export const BATES_DEFAULT: BatesSettings = {
  on: false,
  prefix: "ABC",
  suffix: "",
  startAt: 1,
  digits: 6,
  position: "br",
  fontSize: 10,
  color: "black",
  margin: 24,
};

/**
 * Deterministic fingerprint of the settings that affect the *stamp itself*.
 * Used to detect whether the current settings would produce a different
 * stamp than the one already applied to the tab, so the export dialog can
 * suppress a second (identical) stamp but still allow re-stamping when the
 * user has changed something.
 */
export function computeBatesFingerprint(s: BatesSettings): string {
  const parts: (string | number)[] = [
    s.prefix ?? "",
    s.suffix ?? "",
    s.startAt,
    s.digits,
    s.position,
    s.fontSize,
    s.color,
    s.margin ?? 24,
  ];
  return parts.join("|");
}

const LS_KEY = "counselpdf:bates-settings";

function load(): Record<string, BatesSettings> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function save(all: Record<string, BatesSettings>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function docKey(file: { name: string; size: number } | null): string | null {
  return file ? `${file.name}::${file.size}` : null;
}

export function getBatesSettings(key: string | null): BatesSettings {
  if (!key) return { ...BATES_DEFAULT };
  const all = load();
  return { ...BATES_DEFAULT, ...(all[key] ?? {}) };
}

// Tiny pub/sub so two consumers (Doc Settings + Export Dialog) stay in sync
// without prop-drilling through the whole workspace shell.
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function setBatesSettings(key: string | null, next: BatesSettings) {
  if (!key) return;
  const all = load();
  all[key] = next;
  save(all);
  emit();
}

export function useBatesSettings(
  key: string | null,
): [BatesSettings, (patch: Partial<BatesSettings>) => void] {
  const [val, setVal] = useState<BatesSettings>(() => getBatesSettings(key));
  useEffect(() => {
    setVal(getBatesSettings(key));
    const sub = () => setVal(getBatesSettings(key));
    listeners.add(sub);
    return () => {
      listeners.delete(sub);
    };
  }, [key]);
  const update = useCallback(
    (patch: Partial<BatesSettings>) => {
      const merged = { ...getBatesSettings(key), ...patch };
      setBatesSettings(key, merged);
    },
    [key],
  );
  return [val, update];
}

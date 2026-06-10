/**
 * Insight preferences — lightweight learning layer.
 *
 * Tracks which insight kinds a user accepts vs dismisses, so the
 * Suggestions Strip and Command Palette can lead with patterns that
 * matter to *this* user. Persisted to localStorage; never leaves the
 * device.
 */

import type { Insight, InsightKind } from "./insights";

const KEY = "vault.intel.prefs.v1";

type Pref = { accepts: number; dismisses: number; lastSeen: number };
type Store = Partial<Record<InsightKind, Pref>>;

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

function write(s: Store) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota — ignore */
  }
}

export function recordInsightAction(kind: InsightKind, action: "accept" | "dismiss") {
  const s = read();
  const cur = s[kind] ?? { accepts: 0, dismisses: 0, lastSeen: 0 };
  if (action === "accept") cur.accepts += 1;
  else cur.dismisses += 1;
  cur.lastSeen = Date.now();
  s[kind] = cur;
  write(s);
}

/**
 * Stable sort by (acceptScore desc, original order). Hides insight kinds
 * the user has dismissed 3× in a row with zero accepts.
 */
export function rankInsights(insights: Insight[]): Insight[] {
  const s = read();
  const score = (k: InsightKind) => {
    const p = s[k];
    if (!p) return 0;
    return p.accepts - p.dismisses * 0.5;
  };
  return insights
    .filter((i) => {
      const p = s[i.kind];
      return !(p && p.accepts === 0 && p.dismisses >= 3);
    })
    .map((i, idx) => ({ i, idx, k: score(i.kind) }))
    .sort((a, b) => b.k - a.k || a.idx - b.idx)
    .map((x) => x.i);
}

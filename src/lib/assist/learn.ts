/**
 * On-device learning for the AI Assist router.
 *
 * All state lives in a SINGLE localStorage key, capped at ~8 KB. Nothing
 * is synced, sent, or observable to anyone else. The three signal maps
 * are used ONLY by the assist router (never by the workspace command bar
 * or by verified tool logic).
 *
 *  - clarifyPicks: after "Did you mean…?" / "Which one?" answered by the
 *    user, we remember the winner keyed by normalized query. Confidence
 *    ≥ 2 means "route straight to that tool next time — skip clarify".
 *  - followUps:  after showing a tool-help card, we count when the user
 *    clicks the primary "Open X" action. Not directly consumed yet —
 *    reserved for surfacing "Open X" as the primary action.
 *  - lanePrefs:  for bare-noun ambiguous queries ("contract"), remember
 *    whether the user consistently picks literal / semantic / action.
 */

export type AssistLane = "literal" | "semantic" | "action" | "help";

interface ClarifyPick {
  toolId: string;
  count: number;
  lastAt: number;
}
interface LanePref {
  literal: number;
  semantic: number;
  action: number;
}

export interface LearnState {
  v: 1;
  clarifyPicks: Record<string, ClarifyPick>;
  followUps: Record<string, number>;
  lanePrefs: Record<string, LanePref>;
}

const KEY = "vault.assist.learn.v1";
const MAX_BYTES = 8 * 1024;
const DECAY_MS = 90 * 24 * 60 * 60 * 1000; // forget picks older than 90d

function empty(): LearnState {
  return { v: 1, clarifyPicks: {}, followUps: {}, lanePrefs: {} };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadLearnState(): LearnState {
  if (!isBrowser()) return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as LearnState;
    if (!parsed || parsed.v !== 1) return empty();
    // Decay stale clarify picks so old habits don't pin new routes.
    const now = Date.now();
    for (const k of Object.keys(parsed.clarifyPicks ?? {})) {
      const p = parsed.clarifyPicks[k];
      if (!p || now - p.lastAt > DECAY_MS) delete parsed.clarifyPicks[k];
    }
    return {
      v: 1,
      clarifyPicks: parsed.clarifyPicks ?? {},
      followUps: parsed.followUps ?? {},
      lanePrefs: parsed.lanePrefs ?? {},
    };
  } catch {
    return empty();
  }
}

function save(state: LearnState): void {
  if (!isBrowser()) return;
  try {
    let json = JSON.stringify(state);
    // Simple cap — if we overflow, drop the smallest clarifyPicks first.
    if (json.length > MAX_BYTES) {
      const entries = Object.entries(state.clarifyPicks).sort((a, b) => a[1].count - b[1].count);
      while (json.length > MAX_BYTES && entries.length > 0) {
        const [k] = entries.shift()!;
        delete state.clarifyPicks[k];
        json = JSON.stringify(state);
      }
    }
    window.localStorage.setItem(KEY, json);
  } catch {
    /* quota / private mode — best effort only */
  }
}

export function normalizeQueryKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6) // key on the first ~6 tokens so long queries still match
    .join(" ");
}

/**
 * If the user has picked the same tool ≥ 2 times for this query, return
 * that tool id — the router should short-circuit clarify.
 */
export function preferredToolFor(queryKey: string, state?: LearnState): string | null {
  const s = state ?? loadLearnState();
  const p = s.clarifyPicks[queryKey];
  if (p && p.count >= 2) return p.toolId;
  return null;
}

/**
 * Bare-noun ambiguous queries: return the lane the user consistently
 * picks (≥ 2 with a lead of ≥ 1 over the runner-up).
 */
export function preferredLaneFor(
  nounKey: string,
  state?: LearnState,
): AssistLane | null {
  const s = state ?? loadLearnState();
  const p = s.lanePrefs[nounKey];
  if (!p) return null;
  const ranked: Array<[AssistLane, number]> = [
    ["literal" as AssistLane, p.literal ?? 0],
    ["semantic" as AssistLane, p.semantic ?? 0],
    ["action" as AssistLane, p.action ?? 0],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const topLane: AssistLane = ranked[0][0];
  const topCount: number = ranked[0][1];
  const runner: number = ranked[1]?.[1] ?? 0;
  if (topCount >= 2 && topCount - runner >= 1) return topLane;
  return null;
}

/** Record that the user resolved a clarify by picking this tool. */
export function recordClarifyPick(queryKey: string, toolId: string): void {
  if (!queryKey || !toolId) return;
  const s = loadLearnState();
  const prev = s.clarifyPicks[queryKey];
  s.clarifyPicks[queryKey] = {
    toolId,
    count: prev && prev.toolId === toolId ? prev.count + 1 : 1,
    lastAt: Date.now(),
  };
  save(s);
}

/** Record that the user opened the tool from a help card. */
export function recordFollowUp(toolId: string, action = "open"): void {
  if (!toolId) return;
  const key = `${toolId}__${action}`;
  const s = loadLearnState();
  s.followUps[key] = (s.followUps[key] ?? 0) + 1;
  save(s);
}

/** Record the user's lane choice for a bare-noun ambiguous query. */
export function recordLanePick(nounKey: string, lane: AssistLane): void {
  if (!nounKey || lane === "help") return;
  const s = loadLearnState();
  const prev = s.lanePrefs[nounKey] ?? { literal: 0, semantic: 0, action: 0 };
  prev[lane] = (prev[lane] ?? 0) + 1;
  s.lanePrefs[nounKey] = prev;
  save(s);
}

/** Wipe every learned signal — invoked from the account menu. */
export function resetLearnState(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

# Conversational Assist — my recommendation

From a user's perspective, the failure mode we must avoid is *silent* misrouting: the assistant guessed "semantic search" when you meant "literal find" and you had no way to tell. Slash commands (`/find`, `/ask`, `/do`) fix that but ask users to learn syntax — nobody does. Pure rulebooks are brittle at edges.

The right pattern is **transparent routing with cheap correction**: the assistant picks one lane, *says* which lane in one line, and offers one-click switches to the other lanes when a query could plausibly mean more than one thing. This is how ChatGPT, Raycast, and Perplexity all handle the same problem — and it slots directly into the follow-up context we just shipped.

## Scope

- **AI Assist panel only.** Workspace command bar (`classifyCommandSemantic`) is untouched.
- **Literal search: open document only.** Uses existing PDF text extraction.
- **No new AI model.** MiniLM stays the only embedder; NER stays the only detector.
- Hard guardrails from prior turn still hold: PDF viewer, tab lifecycle, editor canvas, `samplePageBg`, verified redaction — off limits.

## The four lanes

Every submit resolves to exactly one of these, and the assistant tells you which one it picked:

1. **Literal find** — exact/whole-word/regex text search inside the open PDF. Free. Results are page+snippet chips that jump the viewer.
2. **Semantic search / Q&A** — meaning-based, routed to the existing Private AI assist surface (Pre-Discovery). Pro-gated as today.
3. **Tool action** — opens/uses a verified tool (Redact, Sanitize, Bates, etc.). Existing routing.
4. **Help / topic** — tool explanation or cross-cutting topic (pricing, offline, privacy). Existing.

## Routing rules (transparent, not brittle)

Applied in order; first match wins. Each rule is a *reason* the panel can show to the user.

| # | Signal | Lane | Confidence |
|---|--------|------|------------|
| 1 | Quoted text: `find "contract"`, `search 'John Smith'` | Literal | High |
| 2 | Explicit literal cue: `the word X`, `the phrase X`, `exact match X`, `regex /…/` | Literal | High |
| 3 | Existing exact tool/topic match (already shipped) | Action / Topic | High |
| 4 | Action verb + noun (`redact SSNs`, `stamp bates`, `sanitize this`) | Action | High |
| 5 | Help language (`what is X`, `how do I`, `why`) | Help/Topic | High |
| 6 | Content descriptor (`find sensitive contracts`, `passages about damages`, `clauses that mention X`) | Semantic | Medium |
| 7 | Bare noun / short phrase (`contracts`, `payment amounts`) | **Ambiguous** — literal is default, semantic and Redact offered as chips | Low |
| 8 | Fuzzy tool typo (already shipped) | Action | Medium |
| 9 | Nothing matches with confidence | Ambiguous — chip row with top 2 lanes | — |

The user always sees a one-line explanation of which lane fired ("Searching for the exact word *contract*…", "Interpreting as a meaning-based search…") plus a chip row to switch lanes.

## Conversational memory (extends prior work)

`AssistCtx` already tracks `lastEntryId` / `lastTopicId` / `lastQuery`. Add:

- `lastFindTerm?: string` and `lastFindMatches?: { page: number; snippet: string }[]`
- `lastLane?: "literal" | "semantic" | "action" | "help"`

This enables follow-ups the user has been asking for:

- After literal find "contract" → "now redact them" stages those matches into Redact (Pro gate applies for bulk).
- After semantic "find sensitive contracts" → "which pages" summarises pages from the previous answer.
- After "what is Redact" → "how do I do that" opens Redact (already works from the last turn).

Context resets on: explicit new subject in a different lane, panel close, or the "Ask something else" chip.

## Panel additions (no layout change)

- New `find-results` step kind: title + N chips (`Page 3 · "…this contract shall…"`) that call `openTool` with a page jump, plus a "Redact all matches" action (Pro-gated, hands off to Redact staging).
- Every answer keeps the existing meta chip ("Free • Runs offline • Nothing leaves your device").
- Existing `clarify` / `clarify-typo` step kinds absorb the new "which lane?" case — no new UI primitive.

## Files touched

- `src/lib/assist/router.ts` — add lane detection (rules 1, 2, 6, 7), extend `AssistClassification` with `kind: "literal" | "semantic"` and `lane` reason strings; extend `AssistCtx` with the fields above; add cross-lane sticky logic (if last was literal and follow-up starts with "redact" / "them" / "these" → action on last matches).
- `src/lib/assist/knowledge-base.ts` — no schema change; add anchor examples covering literal-vs-semantic phrasing so the embedding path stays honest.
- `src/lib/assist/find.ts` — **new**. Thin wrapper around existing `src/lib/chat/pdf-extract.ts` producing `{ page, snippet }[]` for a plain string, with whole-word and regex options.
- `src/components/workspace/agent-panel.tsx` — new `find-results` step; `showFindAnswer` / `showSemanticAnswer` handlers; pass extended `AssistCtx`; render lane reason line; wire "Redact all matches" to the existing Redact staging events (`redact:unstage-det` sibling — a `redact:stage-matches` event, or reuse pattern-bulk-redact flow).
- `scripts/verify-assist-router.ts` — extend with lane cases: `find "contract"` → literal; `find sensitive contracts` → semantic; `contracts` → ambiguous; `redact them` after literal → action with staged term.

## What this deliberately does NOT do

- No slash-command syntax. No hidden modes.
- No new gating. Semantic still Pro. Bulk Redact still Pro. Everything else free.
- No touching the workspace command bar, viewer, or canvas.
- No cloud LLM. On-device only, per project constitution.

## Verification

Node classifier script (extends existing) asserts:

- `find "contract"` → literal, term=`contract`
- `search for the word John` → literal, term=`John`
- `find sensitive contracts` → semantic
- `contracts` → ambiguous, top options include literal + semantic
- `redact SSNs` → action `redact`
- Follow-ups (ctx.lane=literal, term=`contract`): `now redact them` → action `redact` with `contextFrom` carrying the term; `which pages` → summary of previous matches; `more info` → sticky Redact help (regression from last turn)

All 20 prior cases must still pass.

Ship after typecheck + all classifier cases green.

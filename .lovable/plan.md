## What we're building (v2 — expanded)

Four things, all constrained by the same guardrails: PDF viewer, open-tab lifecycle, editor canvas, and `samplePageBg` stay untouched. No changes to verified tool logic.

1. **Smarter clarification** — when the router doesn't understand, ask a *specific* follow-up ("count them? find them? redact them?") instead of a bare "Did you mean…?". Never route unknown NL like "count the social security numbers" into Pre-Discovery.
2. **On-device learning** — the assistant quietly remembers your picks (only in your browser) and stops asking the same question twice.
3. **Need help? / Request a feature** — two chips above the command bar → modal → DB + email via Resend.
4. **Pre-Discovery indexing fix** — no more "Indexing passages…" that never ends. Cache, cancel, ETA, and a progressive first-pass so search works fast.

---

## Part 1 — Smarter clarification (assist router)

**Problem:** today's fallback shows one guessed tool and a "Cancel" — that's how "count ssn" landed on Court Readiness in your screenshot, and how earlier phrasings leaked into Pre-Discovery.

**Change in `src/lib/assist/router.ts`:**

Add a new `clarify-ask` classification that carries a short question + up to 4 lane chips derived from what the query *looks like*, not what a fuzzy match guessed:

- If the query contains a **PII noun** (ssn, social security, phone, email, dob, credit card, address, name, dates) with **no clear verb**, ask:
  > *"Do you want to **find**, **count**, or **redact** the SSNs in this document?"*
  Chips: `Find matches` (literal), `Count matches` (literal + count summary), `Redact all` (Redact tool), `Ask something else`.
- If the query contains a **verb** the router doesn't recognize (`analyze`, `summarize`, `extract`, `list`, `count`) with any noun, ask:
  > *"I can do a few things with '{query}'. Which one?"* — chips built from the eligible lanes.
- Only when no signal at all → the current typo/clarify path (existing `clarify-typo`).

**New "count" affordance:** the literal-find lane already returns `matches[]`. When the user picks `Count matches`, the panel shows a compact card: "**N matches for 'SSN'** across pages {…}" with a chip to open Redact for those matches — no full page-by-page dump.

**Pre-Discovery gate:** semantic search (Pro) is proposed only when the query is genuinely open-ended ("who signed this", "arguments about jurisdiction"). PII-shaped queries never propose Pre-Discovery. This alone stops the accidental indexing trigger.

Router tests in `scripts/verify-assist-router.ts` extended with fixtures like `count ssn`, `count the social security numbers`, `find phone numbers`, `analyze this contract`, `list every date`.

---

## Part 2 — On-device learning (localStorage only)

`src/lib/assist/learn.ts` (new). One localStorage key `vault.assist.learn.v1`, capped ~8 KB, time-decayed.

Three signal maps:

- `clarifyPicks[queryKey] → { toolId, count, lastAt }` — every "Did you mean…?" / "Which one?" answer bumps the winner. Confidence ≥ 2 → skip clarify next time, route straight to that lane.
- `followUps[toolId__nextAction] → count` — after "what is redact" → if the user clicks "Open Redact", bump it. Next help answer promotes "Open Redact" to primary.
- `lanePrefs[nounKey] → { literal, semantic, action }` — bare-noun ambiguity ("contract") learns the user's default lane over 2+ picks.

Wired in `router.ts` (read) + `agent-panel.tsx` (write on every chip click). No account sync. A "Reset assistant learning" row in the account menu clears the key.

Verification in `scripts/verify-assist-router.ts`: run the same fixtures with an empty `learn` snapshot (assert current behavior) and with a synthetic learned snapshot (assert honored).

---

## Part 3 — Need help? / Request a feature

**Placement:** two small chips directly above the workspace command bar in `workspace-shell.tsx`. Tokens only, no new palette. `?` opens Help.

### Database — one migration

`public.support_requests`:

- Columns: `id`, `user_id` (nullable, FK `auth.users`), `type` (`'help' | 'feature'`), `title`, `message`, `name`, `email`, `plan`, `page`, `user_agent`, `status` (`'new'` default), `created_at`, `updated_at`.
- GRANTs: `INSERT` to `anon` + `authenticated` (so signed-out users can still ask); `SELECT/UPDATE/DELETE` to `authenticated` gated by owner-only RLS; `ALL` to `service_role`.
- Owner check reuses the existing `OWNER_USER_ID` pattern from `hq.functions.ts` (no new admin model).
- `updated_at` trigger reuses `public.set_updated_at()`.

### Server functions & route

- `src/lib/support.functions.ts`
  - `submitSupportRequest` — `createServerFn`, no `requireSupabaseAuth` (works signed-out). Zod-validates, inserts the row via `supabaseAdmin` (dynamic import inside handler), then fires the email fetch. Always returns `{ ok: true }` even if email fails; DB failure surfaces as a soft toast but never traps the modal.
  - `hqListSupportRequests`, `hqUpdateSupportRequestStatus` — owner-gated, mirror existing `hq*` pattern.
- `src/routes/api/public/support-email.ts` — internal HMAC-verified POST route (secret `SUPPORT_INTERNAL_SECRET` generated via `generate_secret`). Sends via Resend using `RESEND_API_KEY` (I'll request via `add_secret` after approval), sender `onboarding@resend.dev`, recipient looked up server-side from `OWNER_USER_ID` (no separate admin-email secret needed).

Subjects: `[CounselPDF] Help request from {name}` / `[CounselPDF] Feature request — {title}`. Body: plain text + minimal HTML with name/email/plan/page/user-agent/message. No React Email.

### UI

- `src/components/workspace/support-modal.tsx` — one component, two modes.
  - Help: name/email read-only (from profile), message (10–2000 chars).
  - Feature: name/email read-only, title (3–120), message (10–2000).
  - Signed-out fallback: name/email become editable + required.
- Single confirmation state ("Thanks — we've received your message and will get back to you"), Esc closes, never stuck.

### /hq

New fifth tab `Support`:
- Columns: type badge · name · email · title/message preview · plan · page · created_at · status.
- Filters: type (all/help/feature), status (all/new/in-progress/done).
- Sort by `created_at` desc.
- Row click → drawer with full message + status dropdown → `hqUpdateSupportRequestStatus`.

---

## Part 4 — Pre-Discovery indexing fix

**Root cause (from reading `pre-discovery-panel.tsx` + `discovery/client.ts` + `embed.worker.ts`):**
- Every open triggers a full MiniLM embedding pass over every ~300-char paragraph chunk in the doc.
- Batch size is 8, all in one worker, on the main-thread request/response chain.
- No cache across opens — re-opening the same PDF re-indexes from scratch.
- No cancel button — once "Indexing passages…" starts, the user is trapped until it finishes or they refresh.
- Large docs (500+ pages → 3–5k chunks) take multiple minutes on Basic-tier devices (no WebGPU / ≤ 4 cores).

**Fixes (do NOT touch the PDF viewer, editor canvas, tab lifecycle, or `samplePageBg`):**

1. **Persist the index per doc.** Cache `{ chunks, vectors }` keyed by `docKey` (already computed as `name::size::modified`) in IndexedDB. On open, if a valid cache exists, hydrate and skip the entire embedding pass. `discovery/client.ts` gains `loadIndex(docKey)` / `saveIndex(docKey, chunks, vectors)` helpers; the worker gains a `hydrate` message.
2. **Progressive first pass.** Instead of blocking on all chunks, index the first N (default 200) chunks and unlock search immediately with a subtle "Indexing continues in background — {done}/{total}" chip. The remaining chunks stream in via the same worker at low priority (batch 8, 30 ms yield). Existing searches transparently re-rank as more vectors arrive.
3. **Cancel button.** The indexing chip becomes an inline "Cancel" that posts a `{ kind: "abort", id }` to the worker, aborts the running batch loop, clears `indexed=false` and `indexProgress=null`, and toasts "Indexing paused — reopen the panel to resume".
4. **Honest ETA.** Compute chunks/sec from the first two batches and show "~{X}s remaining" using the same device-capability tier plumbing already added for Redact scans (Fast / Standard / Basic).
5. **Explicit opt-in for huge docs.** If `chunks.length > 1500` AND device is Basic tier, show a one-time confirm before starting: "This is a {N}-passage document. On this device semantic search will take about {est}. Continue?" with an "Index later" cancel that leaves the panel usable for the literal-only path.
6. **Guard against duplicate index starts.** A queued `buildIndex` call while one is already running becomes a no-op instead of stacking a second worker pass (a common contributor to the "app goes into indexing mode" feeling).

**Router side (ties back to Part 1):** semantic search is no longer proposed for PII-shaped queries, so "count ssn" never triggers Pre-Discovery indexing again. That path is reserved for genuinely open-ended questions.

**Files touched:**
- `src/lib/discovery/client.ts` — cache API, abort, progress hooks.
- `src/lib/discovery/embed.worker.ts` — abort message, progressive batching, hydrate.
- `src/components/workspace/pre-discovery-panel.tsx` — cache hydrate on mount, Cancel button, ETA chip, huge-doc confirm.

---

## Test plan

1. `count ssn` → assistant asks "**find**, **count**, or **redact** SSNs?" → pick **Count** → shows "N matches across pages …" → pick **Redact all** → opens Redact tool with matches pre-staged. Nothing touches Pre-Discovery.
2. Repeat `count ssn` next session → routes straight to the Count card (learned), no clarification.
3. Reset learning from account menu → next `count ssn` shows the clarify chips again.
4. "Need help?" chip → modal with name/email pre-filled → submit → confirmation → row in `/hq → Support` → owner receives Resend email. Same for "Request a feature" with title.
5. Open a large PDF twice in a row → first open indexes with cancel + ETA visible; second open hydrates from IndexedDB in <1 s and semantic search works immediately.
6. Start indexing → hit Cancel → "Indexing paused" toast, panel returns to idle, no zombie worker.

## Explicitly out of scope

- No changes to `classifyCommandSemantic` (workspace command bar itself).
- No new AI model download. MiniLM stays.
- No changes to canvas / viewer / open-tab lifecycle / `samplePageBg`.
- No React Email — the admin notification is a hand-rolled minimal template next to the route.
- No account-synced learning. Reset is the only knob.

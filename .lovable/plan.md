
# VaultPDF v2 — Final Plan (locked)

Locked answers to the three open questions:
- **Conservative perf mode** triggers at `navigator.deviceMemory ≤ 4`.
- **Ollama**: ship CSP snippet on `/vault` **and** auto-probe `http://localhost:11434/api/tags` once on first launch; if reachable, one-time prompt to add it as a provider.
- **Token meter** shows a *queued estimate* (greyed) before the call, then live actual cost during stream, then final settled cost on completion.

---

## Part A — BYOK Infrastructure

### A0. Encrypted vault
- Passkey-first, passphrase co-equal.
- **A0.1 PRF probe**: at enroll, request WebAuthn `prf` extension and verify `getClientExtensionResults().prf` returned. If absent → inline notice and fall back to passphrase + PBKDF2 (600k, SHA-256). Persist `unlockMode` per credential.
- Auto-generated Ed25519 signing key, stored encrypted. Public key + rotate/export in `/vault`.
- Document cache always encrypted (per-doc AES key wrapped by vault key).
- **A0.2 Key isolation**: raw `CryptoKey` never enters React state / Zustand / Context. Lives as module-scoped, non-exported variables inside `crypto-worker.ts`. Main thread holds opaque handle IDs only; ops via `postMessage`. Worker terminates on lock.
- **A0.3 Multi-tab coordination**: `navigator.locks.request("vault-unlock", …)` serializes unlock; `BroadcastChannel("vault-session")` sends the *wrapped* session key (sealed with each tab's ephemeral X25519 pubkey announced on open) so a second tab unlocks without re-prompting. Per-tab fallback if `locks` unavailable.

Files: `src/lib/vault/{crypto-worker.ts, store.ts, passkey.ts, signing.ts, tabs.ts}`, `src/components/vault/{UnlockDialog, KeyManager, SigningKeyPanel}.tsx`.

### A1. Provider adapters
`src/lib/ai/providers/{openai, anthropic, google, ollama, openai-compatible}.ts` — normalized `stream(messages, tools, signal)`, browser→provider direct.
- **A1.1 CSP**: defaults whitelist known hosts. `/vault` ships a copy-paste CSP + reverse-proxy snippet for custom endpoints. Ollama auto-probed at first launch.

### A2. Tool registry
Zod-schema wrappers, `permission: safe | confirm | destructive`. JSON-Schema export for any provider.

### A3. Agent runtime
State machine, AbortSignal, local cost meter.
- **A3.1 Chunk & Map**: if `doc.pages > 50`, whole-doc tools run map-reduce in a worker pool sized by `hardwareConcurrency`. 10-page chunks, partial results stream as `tool_progress` parts into chat, then reduce step opens `<ApprovalCard/>`.

### A4. Workspace state
Single in-memory `WorkspaceDoc`, IndexedDB-backed (encrypted).
- **A4.1 Debounced persistence**: 2s idle flush + flush on tab hide/lock. Atomic snapshots.
- **A4.2 Lazy extraction**: text/layout extracted on viewport entry or tool target. Cached `(docHash, page)`.

### A5. MCP (Phase 4, no infra cost)
Client-side MCP client + optional local `vaultpdf-mcp` Node script.

### A6. Trust
Strict CSP, network transparency log, tamper-evident export (Ed25519 + SHA-256 sidecar), PWA install.

### A7. Power-user
- `⌘K` palette.
- **A7.1 Registered commands**: `Redact PII`, `Lock Vault`, `Clear Cache`, `Switch Model`, `Open Recent`, `Export & Sign`, `Toggle Verifiable Mode`.
- URL-as-state, `?` cheatsheet, JSON pipelines.

---

## Part B — One-pass UI system

### B1. Information architecture
Collapse 24 routes → **3 surfaces**: `/`, `/workspace`, `/vault`. SEO tool routes stay as static marketing pages that deep-link into `/workspace?tool=…`.

### B2. Six tokens (locked)
`--ink --paper --canvas --vault --evidence --whisper`. No others.

### B3. Two type scales
Display serif (H1 + 11px small-caps section headers), body sans (13/14/16px), mono for numerals / hashes / page counts.

### B4. Grid & icons
8pt grid; icons 14px in chrome, 18px on canvas/CTAs. No 16/20.

### B5. Primitives (built once)
`AppShell, ToolHeader, ToolRail, ThumbStrip, DocumentCanvas, Inspector, CommandPalette, ApprovalCard, EmptyState`.

### B6. Workspace layout
`ToolRail · ThumbStrip · DocumentCanvas · Inspector(320px)`.

- **B6.1 Inspector split**: CSS grid, two independent scroll regions when chat is open. Tool panel (default 60%) + chat (default 40%), 1px `--whisper` drag handle with snap stops at 30/50/70%. Each region `overflow-y:auto`, min-heights enforced.
- **B6.2 Canvas overlay**: pending boxes, pulses, handles render to a single transparent `<canvas>` over the PDF render canvas. JS quadtree for hit-testing. 200 boxes / 100 pages stays at 60fps.

### B7. Per-tool Inspector contents — locked
Redact · Sign · Compare · Extract · OCR · Bates. Same serif small-caps headers, count-first pills, primary `--vault` button at bottom.

### B8. Verifiable-redaction
**Modifier** on Workspace (amber left rule, `VERIFIABLE` badge with mono SHA-256 prefix, `Sign & Export` button, mandatory exemption code, Certificate + Privilege Log toggles on by default). Not a separate route shape.

### B9. Motion
180ms layout transitions, 1.2s `--evidence` pulse on pending redactions, 160ms approval card slide. No toasts; status line in `AppShell`.

### B10. Empty / loading / error
Defined once. Empty = chrome at 40% opacity + centered dropzone. Loading = skeleton lines in Inspector, canvas stays interactive. Error = inline under affected section in `--evidence`.

### B11. Landing
Hero with mini-redaction demo, three trust pillars (Your keys / Your docs / Your machine), pricing (Free / Pro $9 / Legal $49), footer linking every SEO landing.

### B12. `/vault` settings
Unlock · AI providers · Signing key · Document cache · Network log · Pipelines · **CSP templates** panel (from A1.1).

### B13. Token meter
Monochrome chip in chat input header tray: `$0.042 · 2.1k tkn`. Queued estimate greyed → live actual during stream → settled on completion. Click expands a drawer reusing the providers section from `/vault`.

### B14. Resource-throttle UI (no new primitives)
- `AppShell` file label appends state in mono: `doc.pdf · 412 pgs (indexing…)`, `(OCR 38/412)`, `(redacting…)`.
- Off-viewport pages render as `--whisper` 1px-border placeholders with low-opacity dot grid.

---

## Part D — Performance (Phase 1, not deferred)

| ID | Rule | Where |
|---|---|---|
| D1 | All PDF parse / OCR / AES / diff in workers. | `src/lib/workers/` |
| D2 | Virtualized canvas: render current ±1 page; rest are placeholders. | `DocumentCanvas` |
| D3 | Low-res while scrolling/zooming; re-render 2–3x after 150ms idle. | `DocumentCanvas` |
| D4 | Lazy per-page text extract + 10-page AI streaming with live progress. | `agent.ts` + `WorkspaceDoc` |
| D5 | Mutations to in-memory ledger; 2s debounced IndexedDB flush. | `WorkspaceDoc` |
| — | Worker pool sized via `hardwareConcurrency`; chunk + cache budgets scale by `deviceMemory` (≤4 conservative, ≥8 aggressive). | All workers |

---

## Build order

1. **Phase 1 — Design system + perf primitives (1 wk)**
   Tokens, primitives, Inspector split, canvas overlay, virtualized renderer, worker scaffolding, low/high-res toggle. Migrate `/redact` as proof.

2. **Phase 2 — Vault + workspace (1–2 wks)**
   Crypto-worker, PRF probe, multi-tab broadcast, encrypted cache + debounced flush, lazy extract, `/workspace`, `/vault` (with CSP templates + Ollama probe). Migrate sign / extract / compare / ocr / bates as Inspector contents only.

3. **Phase 3 — Agent rails (1 wk)**
   Provider adapters, tool registry, agent runtime + Chunk & Map, approval cards, token meter, palette commands.

4. **Phase 4 — Trust + power (1 wk)**
   CSP defaults, network log, tamper-evident export, PWA, MCP client + local server script, JSON pipelines.

5. **Phase 5 — Landing + pricing (3 days)**.

UI is frozen after Phase 1. Phases 2–5 only add Inspector contents and backend logic. No re-skins.

---

## Out of scope
Lovable AI fallback, accounts, server-side sync, native mobile, real-time collab.

# Browser Storage Audit

Goal: confirm no important user data lives **only** in browser storage
(IndexedDB / localStorage), since browsers may evict either under disk
pressure. Documents themselves are intentionally never persisted to a
server — the exported PDF is the system of record.

## (a) IMPORTANT — DB is source of truth, browser is cache only

| Data | DB table | Browser cache | Re-sync on eviction |
|---|---|---|---|
| License / subscription | `subscriptions` (Supabase) | `counselpdf-license` IDB via `saveLicense` | `src/lib/use-license-activation.ts` revalidates on launch, auth events, focus, visibilitychange, online, and every 6h; also subscribes to realtime `postgres_changes` on the user's `subscriptions` row. Stored snapshot only ever **seeds** the UI; the live row overwrites it. |
| Firm templates | `firm_templates` | none (server-fn `listFirmTemplates` per open) | Refetched from DB on every menu open after invalidation. |
| Compliance certificates | `compliance_certificates` | none | `src/lib/certificates.functions.ts` reads from DB on demand. |
| Case sessions | `case_sessions` | none | `src/lib/case-sessions.functions.ts` reads from DB on demand. |

Verified: clearing IDB + localStorage and reloading while signed in
restores license, templates, certificates, and saved sessions from
Supabase. Only ephemeral UI prefs (below) are lost — by design.

## (b) DISPOSABLE — browser-only is fine

These are session/UI conveniences. Losing them resets defaults; nothing
the user authored is destroyed.

- `counselpdf-workspace` (IDB): workspace UI state, open-tabs list,
  per-document **sidecars** (annotations / page-ops / OCR layer),
  recent-file bytes (≤ 25 MB each, ≤ 120 MB total). Sidecars are a
  resume convenience — the exported PDF is the authoritative artifact.
- `counselpdf-tray` (IDB): tray document blobs, keyed by SHA-256.
- `counselpdf-annotate` (IDB): annotation cache.
- `counselpdf-welcome` (IDB): welcome-modal seen flag.
- `counselpdf-network-log` (IDB): trust/network log (transient).
- `localStorage`: usage counts, manual pins, inspector width, redact
  prefs, default export format, offline-mode flag, comment author name,
  bates seq counters, dismissed announcements, saved pipelines.

## Persistence request

`navigator.storage.persist()` is requested once on app boot from
`src/routes/__root.tsx` (`requestPersistentStorage`) and again from
`useLicenseActivation` after the license cache is written. This asks
the browser to upgrade the origin to "persistent" durability and
reduces eviction risk for the disposable caches above.

## Performance fixes

The empty-state "Resume recent matter" list and the rail's
`listRecents()` were the laggy hot paths. Causes and fixes:

1. **N+1 IDB reads** — `listRecents`, `addRecent`, `evict`, `dedupe`
   each ran `getAllKeys()` + one `get()` per key. Replaced with a
   single `getAll()` cursor read per transaction.
2. **No in-memory cache** — every render-time call re-ran the full
   IDB scan. Added a module-level `recentsMetaCache` invalidated on
   add/remove/clear, plus `subscribeRecents()` for live updates.
3. **Sync `listRecents` accessor** — `getCachedRecents()` returns the
   already-hydrated array synchronously for components that mount
   after first hydration.
4. **DB-backed lists already cache in component state** — the firm
   templates menu only refetches on open if its cache was invalidated
   by a save/delete.

Documents themselves stay in memory while open and are never sent to
a server.

# Rasterize rewrite — validation + implementation plan

## Do the five proposed steps hold up? (verified against code)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Replace `removePage`/`insertPage` with a fresh PDF rebuild | **Correct — this is the root cause of the 40× bloat** | `src/lib/workers/rasterize.worker.ts:197-206` does `outDoc.removePage(pageIdx); outDoc.insertPage(pageIdx, [w,h]); newPage.drawImage(img)`. pdf-lib's `removePage` only unlinks from `/Pages`; the original Page dict, its content stream, `/Resources` (fonts, embedded images, ICC, XObjects), plus any `/Outlines`, `/Names/Dests`, `/StructTreeRoot`, thumbnail, or link-annotation references stay reachable from the trailer and are re-serialized on `outDoc.save()`. pdf-lib has no GC pass. Every rasterized page adds a fresh JPEG on top of the retained originals. |
| 2 | Rasterize only pages that truly require it | **Partially already true, but weakened** | Worker loops over `pageRedactions.keys()` only (`rasterize.worker.ts:112`), not all pages — good. But when `mode: "always"` (used by the redact panel with `maxSecurity=true` and by `redaction-gate` fallback), every page in `pageRedactions` is rasterized regardless of whether the content-stream rewrite already cleared it. The `"fallback"` branch (lines 143-163) does a text-hit test and skips clean pages; `"always"` does not. |
| 3 | Ensure a page can never be rasterized twice | **Broken today** | `redaction-gate.ts:143-163` calls `rasterizeRedactedPagesInWorker` a *second* time with `mode: "always"` on `pageLeaks` after the initial burn. Nothing filters out pages already in `rasterizedPages` — a page that was rasterized in pass 1 and still shows a leak (which can happen because pass-1 output is verified) gets a *second* JPEG embedded, and the first page's Page dict from pass 1 stays reachable via the same `removePage` bug. Compounds inflation. |
| 4 | Preserve document metadata | **Must add explicitly** | A fresh-document rebuild via `PDFDocument.create()` starts with empty Info + no XMP. Must copy Title/Author/Subject/Keywords/Creator/Producer/CreationDate/ModDate from `srcDoc` (pdf-lib exposes these via `getTitle()`/`getAuthor()`/etc. on the loaded doc), otherwise Bates/PDF/A downstream and any user-visible metadata are lost. |
| 5 | Accept outlines/bookmarks may not survive | **Acceptable trade-off for this fix** | Copying `/Outlines`, `/Names/Dests`, `/StructTreeRoot` correctly requires deep-copying an indirect-object graph and rewriting all page references — that's what caused the bloat in the first place. Dropping them is the honest way to break the retention chain. Link annotations that target rasterized pages will also be dropped; on non-rasterized pages we keep them via `copyPages` (which does copy per-page annotations). |

**Bottom line:** all five points are correct. #1 + #3 together explain the 18 MB → 747 MB observation. #4 is a required addendum. #5 is the price of the fix.

## Implementation

### `src/lib/workers/rasterize.worker.ts` — full rewrite of `rasterize()`

Replace the current mutate-in-place loop with a fresh-document build:

```text
1. Load srcDoc via PDFDocument.load(bytes)  [needed for page sizes + copyPages]
2. Load pdfjsDoc via pdfjs.getDocument       [needed for rendering]
3. outDoc = await PDFDocument.create()
4. Copy metadata (Title, Author, Subject, Keywords, Creator, Producer,
   CreationDate, ModDate) from srcDoc → outDoc
5. Build a Set<number> `toRasterize` from pageRedactions.keys():
   - "always": every key
   - "fallback": only keys whose text-hit test finds an item inside a rect
   Log the two counts so the diagnostic answers "was every page rasterized?"
6. For pageIdx in 0..srcDoc.getPageCount()-1  (ascending, single pass):
     if pageIdx in toRasterize:
       render → JPEG (existing code, unchanged), embed, drawImage on new page
       jpegBytes = null; canvas released; page.cleanup()
     else:
       [copied] = await outDoc.copyPages(srcDoc, [pageIdx])
       outDoc.addPage(copied)
   → guarantees single pass, no duplicate, ascending order preserved
7. outBytes = await outDoc.save({ updateFieldAppearances: false })
8. Existing [rasterize:diagnostic] after-save log stays; add before/after
   byte counts for the copyPages branch too so we can see per-mode inflation.
```

Notes:
- Drop the current `pageOrder = keys().sort(desc)` — no longer needed once we build ascending.
- Keep the per-page `cleanup()` + `canvas = null` + `jpegBytes = null` releases (peak-memory bound stays at ~1 page).
- Keep the OffscreenCanvas + JPEG-quality-0.92 rendering exactly as-is; the fix is structural, not rendering.

### `src/lib/editor/redaction-gate.ts` — prevent double-rasterization (line 141-171)

Before calling `rasterizeRedactedPagesInWorker` in the fallback, filter `leakedPages` to **exclude** page indices already in `rasterizedPages`. A page that was rasterized in pass 1 and still shows a text leak is a verifier false-positive on rasterized content, not something a second JPEG will fix; log a warning and let the gate's throw path handle it. This closes the "rasterize twice" hole and stops pass-1 bloat from compounding.

### Out of scope for this plan (unchanged)

- `to-pdfa.ts` verify-memory fix (separate proposal already outstanding).
- The two `[pipeline:size]` tags that live in `export-dialog.tsx` but not on the redact-panel path — separate diagnostic-parity task.
- Preserving outlines / structure tree / name tree (explicitly deferred per point #5).

## Expected outcome

For the 18 MB / ~400-page reproducer with all pages rasterized once:
- Before: 747 MB (originals retained + full JPEG per page + gate second pass)
- After: ~30–80 MB (single JPEG per rasterized page, no retained originals, no double-burn)

## Risks

- Loss of outlines/bookmarks and cross-page link annotations on any document where at least one page is rasterized. Acceptable per point #5; call it out in the redact-panel toast if any page was rasterized.
- `copyPages` on a huge non-rasterized subset can still hold references to shared font/ICC objects; that's expected and desirable (it's how the file stays small), and it does not retain rasterized-page originals because those pages take the JPEG branch instead of `copyPages`.

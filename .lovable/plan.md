## Why non-white pages break

`samplePageBg` (editor-canvas.tsx L196–286) picks the **brightest well-represented cluster** in the ring around the glyph. That heuristic assumes "page is lighter than ink" — it works on white pages with dark ink, but inverts on the two cases in your screenshots:

- **Dark navy page, light glyphs (image 107):** the ring is dominated by the true dark page color, but anti-aliased edges of the light ink form a smaller high-luminance cluster. The `lum > best.lum` selector jumps onto that anti-alias cluster → cover painted near-white on navy → the bright band you see.
- **Dark teal page, white heading (image 108):** same failure mode, more severe because the glyphs are solid white. The brightest cluster IS the ink halo, so cover paints solid white over the heading area.

Root cause: "brightest cluster" is a page-color heuristic, not a background detector. On any page darker than its ink (dark themes, colored backgrounds, images), it deterministically selects ink halo instead of page.

## Fix plan — replace the selector with a true modal background

Only `samplePageBg` changes. No new call sites, no cover-rect changes, no resolver changes.

**1. Widen the ring's inner gap.** Skip the first `max(2, sh*0.15)` px next to the glyph bbox on all four sides before sampling. Anti-alias halo lives in that band; excluding it removes the ink-cluster contamination that makes brightness-picking necessary in the first place.

**2. Pick the true mode, not the brightest.** Replace the "brightest cluster ≥15% share" logic with: sort clusters by count, take the largest; if the top two are within 20% of each other in count, prefer the one whose luminance is **further from the glyph's own average luminance** (sampled once from inside the bbox). This makes the tie-breaker "least like ink" instead of "brightest", so it works on both light-on-dark and dark-on-light pages.

**3. Keep the ring-escalation loop.** Still retry with wider bands when a ring yields <20 opaque pixels — that path is fine.

**4. Last-resort pixel probe:** sample the point ~`sh*3` above AND `sh*3` below the bbox, return the one whose luminance is further from the glyph's average. Drops the `{r:1,g:1,b:1}` white fallback entirely.

## Verify

- Open the dark-navy doc from image 107 → click the "Problem with…" heading → cover reads as dark navy, not bright cyan.
- Open the dark-teal "AI Package Blueprint" doc from image 108 → click the heading → cover reads as dark teal, heading text stays white; no white band.
- Re-open a plain white PDF (Soil & Raised Bed) → cover still reads white; regression check.
- `bun test tests/fonts/*` stays green (unrelated but cheap sanity).

## Out of scope

Cover-rect geometry, font resolver, PDF viewer, tab lifecycle, `openPdf`, `/editor`, `/redact`. Only the body of `samplePageBg` and its inner-gap constant change (~30 lines in `editor-canvas.tsx`).

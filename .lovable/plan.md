**Answer:** No — what you’re seeing is not Acrobat-style editing. Acrobat/Foxit don’t put a white box behind text. They remove/replace the original text object, so the page background/images remain untouched and only the edited glyphs change.

**Current problem**
- The editor still uses a rectangle-based approach around the selected glyph (`cover` + `clearRect`).
- Even when the DOM cover is transparent, `clearRect` punches a transparent/white-looking rectangular hole in the canvas. On dark/image backgrounds this looks like a white background and not like real text editing.
- There is also leftover page-background sampling code and `bg` storage that keeps the old whiteout mental model alive.

**Plan**
1. **Stop punching rectangles into the visible canvas**
   - Remove the `ctx.clearRect(...)` edit-time erase path for text-edit.
   - Keep the text overlay transparent.
   - Remove the visible `text-edit-cover` layer entirely or make it non-rendering only.

2. **Render the PDF canvas Acrobat-style for edited text**
   - Build a per-page list of active `text-edit` source text runs.
   - When rendering the page canvas, use pdf.js `operationsFilter` to skip only the original text-show operation(s) that match the edited source text/bounds.
   - This makes the base page render as if that text object was removed, while images/background/vector art remain intact.

3. **Keep overlay text as the replacement glyphs only**
   - The editable textarea/div stays `background: transparent`, no cover fill, no sampled page bg.
   - Existing color preservation stays as-is.
   - Existing font matching/typography/export code is not changed.

4. **Add a safe fallback**
   - If operation-level removal cannot confidently match a text run, do not paint a white/colored rectangle.
   - Leave the transparent overlay and log a diagnostic instead of faking background with page color.

5. **Clean the old background logic from editor canvas only**
   - Remove `samplePageBg` usage for edit-text creation.
   - Stop writing meaningful `bg` for edit annotations except a harmless compatibility value required by the existing type/export model.
   - Update comments so the code no longer claims export/background sampling is part of edit behavior.

**Constraints preserved**
- No font resolver changes.
- No typography/baseline/letter-spacing changes.
- No annotation rendering changes outside removing the edit cover.
- No export pipeline changes.
- No OCR changes.
- No background sampling changes except removing it from edit-text behavior.
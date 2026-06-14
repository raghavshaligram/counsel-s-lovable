## Plan

1. **Capture the real font identity more accurately**
   - Use both pdf.js `textItem.fontName` and `textContent.styles[fontName].fontFamily` when detecting the source font.
   - Store the resolved source font name in the edit annotation so the toolbar and export know what was originally used.

2. **Improve weight/style detection**
   - Detect heavy/bold fonts from both the pdf.js font key and resolved font family, not just one string.
   - Treat names like `Bold`, `Black`, `Heavy`, `SemiBold`, `DemiBold`, `Medium`, and common subset font names as bold when appropriate.

3. **Fix the visible ghosting from heavy underlying text**
   - Keep edit-text locked to the original baseline/origin.
   - Separate the cover rectangle from the growing replacement text box: the cover should always target the original glyph bounds, not the flexible text box size.
   - Expand the cover slightly more for bold/heavy text so thick anti-aliased edges are fully hidden.

4. **Match the replacement font better**
   - Map detected serif display text like the attached example to the closest bundled serif replacement instead of falling back to a generic sans font.
   - Default edit replacements to the detected bold/italic style so a heavy original does not remain visible behind a lighter replacement.

5. **Export consistency**
   - Export will draw the background cover over the original glyph bounds first, then draw the replacement with the detected bundled font and weight.
   - The exported PDF should match the on-canvas result and avoid heavy original text showing through.
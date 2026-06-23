## Create a separate "Image Convert" tool

Split image conversion out of the unified Convert tool into its own dedicated tool in the left rail.

### Scope
- **New tool**: "Image Convert" — its own entry in the left rail (Convert group), its own inspector panel.
- **Convert tool**: revert/remove the image-conversion direction so it goes back to its prior responsibility (PDF↔other formats only, no image direction).
- No new routes, no second rail/panel. Reuse existing functions — do not rewrite logic.

### Behavior (same detection rules as before, just isolated)
Inspector detects the loaded input and shows the correct direction:

- **PDF loaded → "PDF to Images"**
  - Reuses existing `pdfToImages` function in `src/lib/pdf/to-images.ts`.
  - Controls: format (PNG / JPG), resolution/scale, page range (all / specific pages).
  - Output: one image per page, downloaded (zip if multi-page, matching current behavior).

- **Image(s) loaded → "Images to PDF"**
  - Reuses existing images-to-pdf function.
  - Controls: only what the existing function actually accepts (page size / fit if present, order).
  - Output: single PDF.

- **Nothing loaded / wrong type** → empty state explaining what to drop.

### Files to change
- `src/components/app-shell.tsx` — add `image-convert` tool entry in the Convert group.
- `src/components/workspace/tool-panels.tsx` — add `ImageConvertPanel` (lifted from the image branch currently inside `ConvertPanel`); remove the image branch from `ConvertPanel`.
- `src/components/workspace/workspace-shell.tsx` — route the new tool id to the new panel.
- No changes to `src/lib/pdf/to-images.ts` or the images-to-pdf lib (logic stays).

### Design rules
- Design tokens only, one inspector panel, on-device, nothing uploaded.
- No legacy routes restored (`/to-images`, `/images-to-pdf` stay deleted).

## Add "Pin toolbar to top" option

Give users a way to dock the floating canvas toolbar to the top of the canvas so it stops overlapping page content.

### UX
- Add a small pin/unpin icon button at the right end of the `FloatingToolbar` (next to undo/redo), with tooltip "Pin to top" / "Unpin (float)".
- Two states:
  - **Floating (default)** — current behavior: centered pill, `absolute top-2.5`, translucent shadow floats over page 1.
  - **Pinned** — bar becomes a full-width docked strip at the top of the canvas: `sticky top-0`, no translate/rounded pill, flush with canvas edges, subtle bottom border. Canvas content (`ContextualBar`, pages, OCR banner) shifts down so nothing renders underneath it.
- The current `ContextualBar` (second row for tool-specific chips) stacks directly under the toolbar in both modes.
- The OCR offer banner (line 1967) and any other top-anchored overlays reposition below the pinned bar automatically because they're siblings inside the same `<main>`.

### Persistence
- Store the preference in `localStorage` under `vault:toolbar-pinned` (boolean) via a tiny `useToolbarPin()` hook in `src/lib/workspace/toolbar-pin.ts`. Read once on mount (guarded for SSR), write on toggle. Persists across sessions and tabs.

### Files touched
- `src/lib/workspace/toolbar-pin.ts` — new hook (`useToolbarPin(): [pinned, setPinned]`).
- `src/components/workspace/workspace-shell.tsx`
  - Consume `useToolbarPin()` in `WorkspaceShell`.
  - Pass `pinned` + `onTogglePin` to `FloatingToolbar`.
  - When pinned, wrap the canvas top region so `FloatingToolbar` renders in normal flow (not `absolute`), and `ContextualBar` / OCR banner render below it. When floating, keep the current absolute layout and top offsets.
  - `FloatingToolbar` gets a new `Pin` icon button (from `lucide-react`) at the trailing edge and swaps its outer className between "floating pill" and "docked strip" based on the `pinned` prop.

### Out of scope
- No changes to left rail, right inspector, or any tool logic.
- No drag-to-reposition; just a two-state pin toggle, matching the user's request.

### Verification
1. Open a PDF → toolbar renders floating (default), tooltip on pin says "Pin to top".
2. Click pin → toolbar snaps to top as a full-width strip, page 1 no longer overlaps.
3. Reload page → toolbar remains pinned (localStorage).
4. Click unpin → returns to floating pill, `top-2.5` centered.
5. Switch tools while pinned → contextual bar still sits directly under the pinned strip; OCR banner still visible below both.

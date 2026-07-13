## Problem

When opening a password-protected PDF in the workspace, `workspace-shell.tsx` calls `pdfjs.getDocument({ data: bytes })` directly (line 1235). That throws a `PasswordException`, which falls into the generic catch at line 1277 and shows the misleading "The file may be damaged. Try to repair it?" toast. Repair on an encrypted PDF then fails too.

The project already has the right primitives:
- `openPdfjs()` in `src/lib/pdf/pdf-open.ts` wraps `getDocument` and throws a typed `EncryptedPdfError` when the file is password-protected (and `MalformedPdfError` when actually corrupt).
- `unlockPdf()` in `src/lib/unlock.ts` (used by `/unlock`) accepts a password and returns a decrypted `File`.

## Fix — scoped to the workspace open path

Edit only `src/components/workspace/workspace-shell.tsx`:

1. Replace the direct `pdfjs.getDocument({ data: bytes }).promise` call (~line 1235) with `openPdfjs(bytes)` from `@/lib/pdf/pdf-open`. Pass an `onPassword` handler that returns `null` so the first attempt fails fast with `EncryptedPdfError` — we want our own UI, not a `window.prompt`.

2. In the `catch (err)` block (~line 1277), branch on error type:
   - `err instanceof EncryptedPdfError` → show a distinct toast: *"This PDF is password-protected"* with an **Unlock** action. On click, open a small password dialog (reuse the pattern from `src/routes/unlock.tsx` — password input + show/hide eye, Enter to submit). On submit, call `unlockPdf(file, password)`; on `WrongPasswordError` re-prompt; on success, feed the returned unlocked `File` back through `onFiles(...)` (same mechanism the repair path already uses) so it opens normally in the same tab.
   - `err instanceof MalformedPdfError` (or any other error) → keep the existing "Couldn't open this PDF / Repair" toast unchanged.

3. For the password dialog: add lightweight local state in `WorkspaceShell` (`unlockPromptFile: File | null`) and render a small `Dialog` (shadcn, already used elsewhere in the shell) at the bottom of the component. Keep it minimal — input + Unlock + Cancel — no new files needed.

## Out of scope

- No changes to `pdf-open.ts`, `unlock.ts`, or `/unlock` route.
- No changes to `repair.ts` or the repair flow itself.
- No changes to any other open path (chat extract, redact, etc.) — this fix targets the workspace shell where the user reported the bug. Those paths already use `openPdfjs` and surface encryption cleanly.

## Verification

- Open a password-protected PDF in the workspace → password dialog appears (no "repair" toast).
- Enter correct password → PDF opens in the same tab.
- Enter wrong password → toast/inline error, dialog stays open.
- Open a genuinely corrupt PDF → existing "Repair" toast still appears.

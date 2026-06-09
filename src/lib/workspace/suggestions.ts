// Maps the last operation on a file to a "next step" recommendation
// for the activity rail. Includes Pro-locked suggestions for the upsell surface.

import type { OpKind, WorkspaceFile } from "./types";

export type Suggestion = {
  id: string;
  label: string;
  to: string;
  reason: string;
  pro?: boolean;
};

const FREE_NEXT: Partial<Record<OpKind, Suggestion[]>> = {
  ocr: [
    { id: "ocr-extract", label: "Extract text or tables", to: "/extract", reason: "Now that it's searchable, pull out the data." },
    { id: "ocr-chat", label: "Search inside this PDF", to: "/chat", reason: "Ask questions against the OCR'd text." },
  ],
  split: [
    { id: "split-merge", label: "Reorder & merge", to: "/merge", reason: "Build a new PDF from the splits." },
  ],
  rotate: [
    { id: "rotate-compress", label: "Compress the result", to: "/compress", reason: "Shrink before sharing." },
  ],
  sign: [
    { id: "sign-protect", label: "Password-protect it", to: "/protect", reason: "Lock the signed document." },
  ],
  watermark: [
    { id: "wm-protect", label: "Password-protect it", to: "/protect", reason: "Pair the stamp with encryption." },
  ],
  compress: [
    { id: "compress-protect", label: "Protect & share", to: "/protect", reason: "Smaller files are easier to email." },
  ],
  redact: [
    { id: "redact-protect", label: "Password-protect it", to: "/protect", reason: "Lock the sanitized copy." },
  ],
  "images-to-pdf": [
    { id: "i2p-ocr", label: "Make it searchable (OCR)", to: "/ocr", reason: "Scanned pages need OCR." },
  ],
  "to-images": [],
  add: [
    { id: "add-rotate", label: "Rotate pages", to: "/rotate" , reason: "Fix orientation first." },
    { id: "add-split", label: "Split into pages", to: "/split", reason: "Break out the pages you need." },
  ],
};

const PRO_NEXT: Partial<Record<OpKind, Suggestion[]>> = {
  redact: [
    { id: "pro-cert", label: "Generate Compliance Certificate", to: "/redact?cert=1", reason: "Court-ready proof of destruction.", pro: true },
  ],
  ocr: [
    { id: "pro-batch-ocr", label: "Batch OCR queue", to: "/ocr?batch=1", reason: "Process multiple files at once.", pro: true },
  ],
  sign: [
    { id: "pro-bates", label: "Add Bates numbering", to: "/bates", reason: "Sequential legal page numbers.", pro: true },
  ],
  extract: [
    { id: "pro-privilege", label: "Scan for privileged terms", to: "/redact?scan=1", reason: "Flag privilege before sharing.", pro: true },
  ],
};

export function suggestionsForFile(file: WorkspaceFile | null): Suggestion[] {
  if (!file) return [];
  const last = file.ops[file.ops.length - 1];
  if (!last) return FREE_NEXT.add ?? [];
  const free = FREE_NEXT[last.kind] ?? [];
  const pro = PRO_NEXT[last.kind] ?? [];
  return [...free, ...pro];
}


# PDF Object-Graph Audit — Stage-Diff Focused

**Primary goal:** pinpoint which export stage introduces duplicated resources. This is a debugging instrument, not a user-facing feature. UI is minimal; output is structured data optimized for diffing stages.

## Core idea: resource identity across stages

An indirect object's `ref` (`"12 0 R"`) changes between stages (rewrite/rasterize/pdf-a each rebuild the object table). The stable identity is the **stream content hash** (SHA-256 of raw stream bytes). We track every stream by hash across stages, so we can answer:

- Which hashes exist in stage N+1 but not stage N? → introduced by that stage
- Which hashes went from 1 copy in stage N to 154 copies in stage N+1? → **that stage duplicated them**
- Which hashes disappeared? → cleaned up (or dropped)

That question — *"which stage inflated the copy count"* — is what the audit is built to answer.

## What gets built

### 1. `src/lib/pdf/audit-object-graph.ts`

```ts
export type AuditStage = "source" | "rewrite" | "rasterize" | "pdfa" | "final";
export type ResKind = "Image" | "Form" | "FontFile" | "ContentStream" | "AnnotAP" | "Other";

export interface StreamRecord {
  sha256: string;              // full hex — identity key across stages
  kind: ResKind;
  bytes: number;               // raw stream length (identical for all copies)
  copies: number;              // # of distinct indirect objects with this hash in THIS stage
  refs: string[];              // every indirect ref carrying this hash (full list, not sampled)
  refCounts: number[];         // parallel array: inbound ref count per entry in `refs`
  pages: number[];             // page indices touching any copy
  hint?: string;               // /Filter, /Length1, image dims, font name, etc.
}

export interface StageAudit {
  stage: AuditStage;
  fileBytes: number;
  totalIndirectObjects: number;
  streams: Map<string, StreamRecord>;   // key = sha256
  bytesByKind: Record<ResKind, number>;
  copiesByKind: Record<ResKind, number>;
  uniqueByKind: Record<ResKind, number>;
}

export async function auditStage(bytes: Uint8Array, stage: AuditStage): Promise<StageAudit>;
```

Implementation:
- `pdf-lib` `PDFDocument.load(bytes, { updateMetadata: false })`, walk `context.enumerateIndirectObjects()`.
- For each stream: `crypto.subtle.digest("SHA-256", contents)` (full hex).
- Single recursive pass over every dict/array to build a `Map<refString, number>` of inbound references, then join by ref.
- Classify in this order: Image → AnnotAP (streams reached via `/Annots[*]/AP/(N|R|D)`) → Form → FontFile → ContentStream (page `/Contents`) → Other.

### 2. Stage-to-stage diff (the primary output)

```ts
export interface HashDelta {
  sha256: string;
  kind: ResKind;
  bytesEach: number;
  copiesBefore: number;         // 0 = introduced by this transition
  copiesAfter: number;          // 0 = removed by this transition
  copiesDelta: number;
  wastedBytesDelta: number;     // bytesEach * max(0, copiesDelta)
  hint?: string;
  sampleRefsAfter: string[];
}

export interface StageDiff {
  from: AuditStage; to: AuditStage;
  fileBytesDelta: number;
  bytesByKindDelta: Record<ResKind, number>;
  introduced: HashDelta[];      // copiesBefore === 0 && copiesAfter > 0
  duplicated: HashDelta[];      // copiesBefore > 0 && copiesAfter > copiesBefore  ← the answer
  removed: HashDelta[];         // copiesAfter === 0
  unchanged: number;            // count only
}

export function diffStages(a: StageAudit, b: StageAudit): StageDiff;
```

`duplicated`, sorted by `wastedBytesDelta` desc, directly answers "which stage multiplied this resource". If a FontFile2 with hash `abc…` shows `copiesBefore=1, copiesAfter=154` in the `rewrite → rasterize` diff, we've localized the bug to the rasterize stage without further guessing.

### 3. Capture at every stage — always on, in dev

- **Hook**: `src/lib/editor/export.ts` gets an `onStageBytes?: (stage, bytes) => Promise<void> | void` callback invoked immediately after each pipeline stage produces bytes. Awaited so the pipeline can't advance until audit finishes (keeps memory bounded — we don't hold N stage snapshots simultaneously; only the audit map, which is tiny).
- **Store**: `src/lib/pdf/audit-store.ts` — module-scoped `{ perRun: StageAudit[]; diffs: StageDiff[] }`; cleared at export start.
- **Trigger**: enabled whenever `import.meta.env.DEV` OR `localStorage.getItem("vault:audit") === "1"`. Zero overhead when off (callback simply not attached).
- **Output**: written to `console.groupCollapsed("[audit] rewrite → rasterize")` with `console.table(diff.duplicated)` per stage transition, AND stashed on `window.__vaultAudit` for interactive inspection. This is the primary consumption path — devtools, not UI.

### 4. Minimal UI hook (debugging only)

In `src/components/workspace/tool-panels.tsx`, extend the existing raster dialog with **one** additional collapsed section: "Object-graph audit" showing:
- One row per stage transition with `fileBytesDelta` and top duplicated hash (kind, bytesEach, copiesBefore→copiesAfter).
- "Copy JSON" button that dumps `{ perRun, diffs }` — full data, no truncation — for pasting into a bug report.

No tabs, no charts, no formatting polish. Everything richer lives in the console log and `window.__vaultAudit`.

### 5. No changes to detection / rewrite / rasterize / pdfa logic

Purely additive. `export.ts` gains one optional callback; nothing else changes.

## Files touched

- **new** `src/lib/pdf/audit-object-graph.ts` — `auditStage` + `diffStages` + types
- **new** `src/lib/pdf/audit-store.ts` — per-run capture, console logging, `window.__vaultAudit`
- **edit** `src/lib/editor/export.ts` — `onStageBytes` callback at each pipeline boundary
- **edit** `src/components/workspace/tool-panels.tsx` — attach callback in DEV / when flag set; add minimal audit section + Copy JSON button to existing dialog

## Verification

Run scan+export on the 3000-page fixture:
1. Console shows one `[audit] X → Y` group per stage transition.
2. Exactly one `duplicated` group in one transition dominates `wastedBytesDelta` — that transition is the culprit stage.
3. `window.__vaultAudit.diffs` is inspectable in devtools; `Copy JSON` produces a self-contained artifact.
4. Expected finding: `rewrite → rasterize` (or `rasterize → pdfa`) shows a FontFile2 hash going 1 → 159 copies, explaining ~430 MB of the 762 MB. If the culprit is a different stage, the same output localizes it just as directly.

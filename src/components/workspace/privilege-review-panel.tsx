/**
 * Privilege Review panel (Pro / Legal rail).
 *
 * Isolated tool panel — does NOT touch the viewer, tab lifecycle, editor
 * canvas, or samplePageBg. Reads the active tab's PDF bytes to extract text
 * per page, runs on-device pattern detection for privilege / work-product /
 * counsel signals, and lets the attorney build a privilege log.
 *
 * IMPORTANT: findings are SUGGESTIONS. Privilege determinations require
 * attorney judgment — nothing is auto-concluded here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ScanSearch,
  AlertTriangle,
  Info,
  Download,
  Shield,
  RefreshCw,
  Search,
  StickyNote,
  Sparkles,
} from "lucide-react";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";
import { getPdfjs } from "@/lib/pdf/worker";
import { importChunk } from "@/lib/chunk-import";
import { PRIVILEGE_TERMS_RE, runNer } from "@/lib/pdf/ner";
import type { ToolPanelCtx } from "./tool-panels";
import { cn } from "@/lib/utils";

/* --------------------------- Detection ---------------------------------- */

export type FindingType =
  | "attorney-client"
  | "work-product"
  | "confidentiality-legend"
  | "counsel-name"
  | "law-firm"
  | "law-firm-email"
  | "privilege-phrase";

const TYPE_LABEL: Record<FindingType, string> = {
  "attorney-client": "Attorney–client",
  "work-product": "Work product",
  "confidentiality-legend": "Confidentiality legend",
  "counsel-name": "Counsel name",
  "law-firm": "Law firm",
  "law-firm-email": "Law-firm email",
  "privilege-phrase": "Privilege phrase",
};

const BASIS_HINT: Record<FindingType, string> = {
  "attorney-client": "Attorney–client communication",
  "work-product": "Attorney work product",
  "confidentiality-legend": "Marked confidential",
  "counsel-name": "Communication involves counsel",
  "law-firm": "Correspondence with law firm",
  "law-firm-email": "Email correspondence with counsel",
  "privilege-phrase": "Privilege / confidentiality indicator",
};

export type PrivilegeFinding = {
  id: string;
  type: FindingType;
  /** 1-based. */
  page: number;
  /** Where on the page (0..1). Used to detect header/footer legends. */
  yFrac?: number;
  /** Char offsets into the page's linearized text — used for merging. */
  matchStart: number;
  matchEnd: number;
  /** Exact matched phrase (already word-trimmed). */
  match: string;
  /** Short readable context on either side of the match. */
  before: string;
  after: string;
  /** True when the match sits inside a negated clause ("not privileged"). */
  negated?: boolean;
};

const ATTORNEY_CLIENT_RE = /\battorney[\s-]client(?:\s+privileg\w*)?\b/gi;
const WORK_PRODUCT_RE = /\b(?:attorney\s+)?work[\s-]product\b|\bprepared\s+in\s+anticipation\s+of\s+litigation\b/gi;
const LEGEND_RE = /\b(?:privileged\s+and\s+confidential|confidential(?:ity)?\s*(?:notice|legend)?|do\s+not\s+disclose|for\s+internal\s+use\s+only|under\s+seal)\b/gi;
const LAW_FIRM_RE =
  /\b([A-Z][A-Za-z&.,'’\-]+(?:\s+[A-Z][A-Za-z&.,'’\-]+){0,4})\s+(LLP|PLLC|LLC|P\.?C\.?|Chartered|Law\s+Group|Law\s+Firm|Attorneys(?:\s+at\s+Law)?)\b/g;
const EMAIL_RE = /\b[\w.+\-]+@([\w-]+(?:\.[\w-]+)+)\b/g;
const LAW_DOMAIN_HINT = /(law|legal|attorneys?|counsel|advocates?|solicitors?)/i;
const ESQ_RE = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+),?\s+Esq\.?\b/g;
const ATTORNEY_FOR_RE = /\bAttorney(?:s)?\s+(?:for|at\s+law)\b[^\n]{0,80}/gi;

// Words that, appearing shortly before a match, invert its meaning.
const NEGATION_RE = /\b(?:no|not|never|without|non[- ]?|isn'?t|aren'?t|wasn'?t|weren'?t|doesn'?t|don'?t|didn'?t|nothing)\b/i;

// Prefer the more specific type when two matches overlap.
const TYPE_PRIORITY: Record<FindingType, number> = {
  "attorney-client": 100,
  "work-product": 95,
  "confidentiality-legend": 90,
  "law-firm-email": 80,
  "law-firm": 70,
  "counsel-name": 60,
  "privilege-phrase": 40,
};

/**
 * Build a clean snippet: expand to word boundaries, then take up to
 * `wordsEach` whitespace-delimited tokens on either side of the match. Never
 * starts mid-word. Prepends/appends an ellipsis when text was trimmed.
 */
function buildSnippet(
  source: string,
  start: number,
  end: number,
  wordsEach = 10,
): { before: string; match: string; after: string } {
  // Expand the match itself to full word boundaries so we never quote
  // "ed legal advice".
  let ms = start;
  while (ms > 0 && /\S/.test(source[ms - 1] ?? "")) ms--;
  let me = end;
  while (me < source.length && /\S/.test(source[me] ?? "")) me++;
  const match = source.slice(ms, me).replace(/\s+/g, " ").trim();

  // Pull up to ~200 chars each side, then trim to `wordsEach` words.
  const leftRaw = source.slice(Math.max(0, ms - 240), ms).replace(/\s+/g, " ");
  const rightRaw = source.slice(me, Math.min(source.length, me + 240)).replace(/\s+/g, " ");

  const leftTokens = leftRaw.trim().split(" ").filter(Boolean);
  const rightTokens = rightRaw.trim().split(" ").filter(Boolean);

  const trimmedLeft = leftTokens.slice(-wordsEach);
  const trimmedRight = rightTokens.slice(0, wordsEach);

  const before =
    (leftTokens.length > trimmedLeft.length ? "… " : "") +
    trimmedLeft.join(" ") +
    (trimmedLeft.length ? " " : "");
  const after =
    (trimmedRight.length ? " " : "") +
    trimmedRight.join(" ") +
    (rightTokens.length > trimmedRight.length ? " …" : "");

  return { before, match, after };
}

function detectNegation(source: string, matchStart: number): boolean {
  const window = source.slice(Math.max(0, matchStart - 40), matchStart);
  if (!NEGATION_RE.test(window)) return false;
  // Guard against "not only privileged" flipping meaning back — cheap heuristic.
  if (/\bnot\s+only\b/i.test(window)) return false;
  return true;
}

function pushMatches(
  out: PrivilegeFinding[],
  page: number,
  text: string,
  re: RegExp,
  type: FindingType,
  itemLookup: (offset: number) => number | undefined,
): void {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    const snip = buildSnippet(text, m.index, m.index + m[0].length);
    out.push({
      id: `pr-${type}-${page}-${m.index}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      page,
      yFrac: itemLookup(m.index),
      matchStart: m.index,
      matchEnd: m.index + m[0].length,
      match: snip.match,
      before: snip.before,
      after: snip.after,
      negated: detectNegation(text, m.index),
    });
  }
}

/**
 * Merge overlapping / adjacent matches on the same page. When two matches
 * touch, we keep the higher-priority type and drop the lower one — this
 * kills the "PRIVILEGED & CONFIDENTIAL flagged 4 times" noise.
 */
function mergeOverlapping(findings: PrivilegeFinding[]): PrivilegeFinding[] {
  const byPage = new Map<number, PrivilegeFinding[]>();
  for (const f of findings) {
    const arr = byPage.get(f.page) ?? [];
    arr.push(f);
    byPage.set(f.page, arr);
  }
  const merged: PrivilegeFinding[] = [];
  for (const [, arr] of byPage) {
    arr.sort((a, b) => a.matchStart - b.matchStart);
    const kept: PrivilegeFinding[] = [];
    for (const f of arr) {
      const prev = kept[kept.length - 1];
      // Treat matches within 8 chars of each other as the same region.
      if (prev && f.matchStart <= prev.matchEnd + 8) {
        const winner = TYPE_PRIORITY[f.type] > TYPE_PRIORITY[prev.type] ? f : prev;
        const loser = winner === f ? prev : f;
        // Extend the winner's range to cover both matches.
        winner.matchStart = Math.min(winner.matchStart, loser.matchStart);
        winner.matchEnd = Math.max(winner.matchEnd, loser.matchEnd);
        // If negation is present on either flag it — attorney should see it.
        winner.negated = winner.negated || loser.negated;
        kept[kept.length - 1] = winner;
      } else {
        kept.push(f);
      }
    }
    merged.push(...kept);
  }
  // Preserve page order for stable rendering.
  merged.sort((a, b) => a.page - b.page || a.matchStart - b.matchStart);
  return merged;
}

async function scanPrivilege(
  file: File,
  opts: { deep: boolean; onProgress?: (p: { page: number; total: number }) => void } = { deep: false },
): Promise<PrivilegeFinding[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: PrivilegeFinding[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      opts.onProgress?.({ page: i, total: doc.numPages });
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items as Array<{
        str: string;
        transform: number[];
        width: number;
        height: number;
      }>;

      // Build linearized page text AND per-item char-range map so we can
      // recover the y-position of any regex match.
      const pageH = viewport.height || 1;
      const parts: string[] = [];
      const itemRanges: Array<{ start: number; end: number; yFrac: number }> = [];
      let cursor = 0;
      for (const it of items) {
        const s = it.str ?? "";
        if (!s) continue;
        const y = it.transform?.[5] ?? 0;
        const yFrac = (pageH - y) / pageH;
        parts.push(s);
        itemRanges.push({ start: cursor, end: cursor + s.length, yFrac });
        cursor += s.length + 1; // +1 for the joining space below
      }
      const pageText = parts.join(" ");
      const lookupY = (offset: number): number | undefined => {
        // Small linear scan — item counts per page are modest.
        for (const r of itemRanges) if (offset >= r.start && offset <= r.end) return r.yFrac;
        return undefined;
      };

      pushMatches(out, i, pageText, ATTORNEY_CLIENT_RE, "attorney-client", lookupY);
      pushMatches(out, i, pageText, WORK_PRODUCT_RE, "work-product", lookupY);
      pushMatches(out, i, pageText, LAW_FIRM_RE, "law-firm", lookupY);
      pushMatches(out, i, pageText, ESQ_RE, "counsel-name", lookupY);
      pushMatches(out, i, pageText, ATTORNEY_FOR_RE, "counsel-name", lookupY);

      // Legend / confidentiality phrases — if the match sits in the header
      // or footer band, classify as a boilerplate legend; otherwise it stays
      // as a general privilege phrase.
      const legendRe = new RegExp(LEGEND_RE.source, "gi");
      let lm: RegExpExecArray | null;
      while ((lm = legendRe.exec(pageText)) !== null) {
        const yFrac = lookupY(lm.index);
        const isLegend = yFrac !== undefined && (yFrac < 0.15 || yFrac > 0.85);
        const snip = buildSnippet(pageText, lm.index, lm.index + lm[0].length);
        out.push({
          id: `pr-legend-${i}-${lm.index}-${Math.random().toString(36).slice(2, 6)}`,
          type: isLegend ? "confidentiality-legend" : "privilege-phrase",
          page: i,
          yFrac,
          matchStart: lm.index,
          matchEnd: lm.index + lm[0].length,
          match: snip.match,
          before: snip.before,
          after: snip.after,
          negated: detectNegation(pageText, lm.index),
        });
      }

      // Law-firm-looking emails.
      const emailRe = new RegExp(EMAIL_RE.source, "g");
      let em: RegExpExecArray | null;
      while ((em = emailRe.exec(pageText)) !== null) {
        const domain = em[1] || "";
        if (!LAW_DOMAIN_HINT.test(domain)) continue;
        const snip = buildSnippet(pageText, em.index, em.index + em[0].length);
        out.push({
          id: `pr-email-${i}-${em.index}-${Math.random().toString(36).slice(2, 6)}`,
          type: "law-firm-email",
          page: i,
          yFrac: lookupY(em.index),
          matchStart: em.index,
          matchEnd: em.index + em[0].length,
          match: snip.match,
          before: snip.before,
          after: snip.after,
        });
      }

      // General privilege terms not already covered.
      const genRe = new RegExp(PRIVILEGE_TERMS_RE.source, "gi");
      let gm: RegExpExecArray | null;
      while ((gm = genRe.exec(pageText)) !== null) {
        const t = gm[0].toLowerCase();
        if (/attorney[\s-]client/.test(t)) continue;
        if (/work[\s-]product/.test(t)) continue;
        const snip = buildSnippet(pageText, gm.index, gm.index + gm[0].length);
        out.push({
          id: `pr-phrase-${i}-${gm.index}-${Math.random().toString(36).slice(2, 6)}`,
          type: "privilege-phrase",
          page: i,
          yFrac: lookupY(gm.index),
          matchStart: gm.index,
          matchEnd: gm.index + gm[0].length,
          match: snip.match,
          before: snip.before,
          after: snip.after,
          negated: detectNegation(pageText, gm.index),
        });
      }
    }

    if (opts.deep) {
      // Deep scan — NER over the first ~40k chars of concatenated text to
      // surface counsel names that don't carry an "Esq." title. Best-effort:
      // model init can fail; don't fail the whole scan when it does.
      try {
        const chunks: { page: number; text: string; base: number }[] = [];
        let total = 0;
        for (let i = 1; i <= doc.numPages && total < 40_000; i++) {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const items = content.items as Array<{ str: string }>;
          const t = items.map((x) => x.str ?? "").join(" ");
          chunks.push({ page: i, text: t, base: total });
          total += t.length + 1;
        }
        const joined = chunks.map((c) => c.text).join("\n");
        const ents = await runNer(joined);
        const pageOf = (offset: number) => {
          let curs = 0;
          for (const c of chunks) {
            const next = curs + c.text.length + 1;
            if (offset < next) return c.page;
            curs = next;
          }
          return chunks[chunks.length - 1]?.page ?? 1;
        };
        for (const e of ents) {
          if (e.type !== "PER" && e.type !== "ORG") continue;
          if (e.score < 0.6) continue;
          if (e.type === "ORG" && !/\b(LLP|PLLC|LLC|P\.?C\.?|Law|Attorneys?|Counsel|Chambers)\b/i.test(e.text)) {
            continue;
          }
          out.push({
            id: `pr-ner-${e.type}-${e.start}-${Math.random().toString(36).slice(2, 6)}`,
            type: e.type === "ORG" ? "law-firm" : "counsel-name",
            page: pageOf(e.start),
            matchStart: e.start,
            matchEnd: e.end,
            match: e.text.trim(),
            before: "",
            after: "",
          });
        }
      } catch (err) {
        console.warn("[privilege-review] NER deep scan failed", err);
      }
    }
  } finally {
    // Fire-and-forget doc destroy — never await, never block the panel.
    try { void (doc as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ignore */ }
  }

  return mergeOverlapping(out);
}


/* --------------------------- Per-file marks ------------------------------ */

type MarkStatus = "unreviewed" | "privileged" | "not-privileged";
type MarkRecord = { status: MarkStatus; notes: string; basis?: string };

function marksKey(file: File | null): string | null {
  if (!file) return null;
  return `vault.privilege.marks.${file.name}::${file.size}`;
}

function loadMarks(file: File | null): Record<string, MarkRecord> {
  const key = marksKey(file);
  if (!key || typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function saveMarks(file: File | null, marks: Record<string, MarkRecord>): void {
  const key = marksKey(file);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(marks));
  } catch { /* quota — ignore */ }
}

/* --------------------------- CSV export --------------------------------- */

function csvCell(s: string): string {
  const needsQuote = /[",\n]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function buildPrivilegeLog(
  findings: PrivilegeFinding[],
  marks: Record<string, MarkRecord>,
  fileName: string,
): string {
  // The exported log intentionally does NOT contain the raw snippet — the
  // point of a privilege log is to describe the withheld item without
  // reproducing its content.
  const rows = [
    ["Document", "Page", "Type", "Basis", "Notes"],
    ...findings
      .filter((f) => (marks[f.id]?.status ?? "unreviewed") === "privileged")
      .map((f) => {
        const m = marks[f.id];
        return [
          fileName,
          String(f.page),
          TYPE_LABEL[f.type],
          m?.basis?.trim() || BASIS_HINT[f.type],
          m?.notes?.trim() || "",
        ];
      }),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function downloadText(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------- Panel -------------------------------------- */

export function PrivilegeReviewPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorDispatch } = ctx;
  const navigate = useNavigate();
  const isPro = useIsPro();
  const requirePro = useRequirePro();

  const [findings, setFindings] = useState<PrivilegeFinding[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [scannedFileKey, setScannedFileKey] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, MarkRecord>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FindingType | "all">("all");
  const [deep, setDeep] = useState(false);
  const marksHydrated = useRef(false);

  const fileKey = file ? `${file.name}::${file.size}` : null;

  // Load persisted marks when file changes.
  useEffect(() => {
    marksHydrated.current = false;
    if (!file) {
      setMarks({});
      setFindings(null);
      setScannedFileKey(null);
      return;
    }
    setMarks(loadMarks(file));
    // Different file — clear stale findings.
    if (fileKey !== scannedFileKey) setFindings(null);
    marksHydrated.current = true;
  }, [file, fileKey, scannedFileKey]);

  // Persist marks on change.
  useEffect(() => {
    if (!marksHydrated.current) return;
    saveMarks(file, marks);
  }, [marks, file]);

  const runScan = useCallback(async () => {
    if (!file) return;
    if (!isPro && !requirePro("Privilege review", "/workspace?tool=privilege-scan")) return;
    setScanning(true);
    setProgress("Preparing…");
    try {
      const results = await scanPrivilege(file, {
        deep,
        onProgress: ({ page, total }) => setProgress(`Scanning page ${page} of ${total}…`),
      });
      setFindings(results);
      setScannedFileKey(fileKey);
      toast.success(
        results.length === 0
          ? "No privilege indicators found."
          : `${results.length} privilege indicator${results.length === 1 ? "" : "s"} — review before producing.`,
      );
    } catch (err) {
      console.error("[privilege-review] scan failed", err);
      toast.error("Privilege scan failed", { description: (err as Error).message });
    } finally {
      setScanning(false);
      setProgress("");
    }
  }, [file, isPro, requirePro, deep, fileKey]);

  const jumpTo = useCallback(
    (f: PrivilegeFinding) => {
      editorDispatch({ type: "SET_PAGE", n: Math.max(0, f.page - 1) });
    },
    [editorDispatch],
  );

  const setMark = useCallback(
    (id: string, patch: Partial<MarkRecord>) => {
      setMarks((prev) => {
        const cur = prev[id] ?? { status: "unreviewed" as MarkStatus, notes: "" };
        return { ...prev, [id]: { ...cur, ...patch } };
      });
    },
    [],
  );

  const filtered = useMemo(() => {
    if (!findings) return [];
    return typeFilter === "all" ? findings : findings.filter((f) => f.type === typeFilter);
  }, [findings, typeFilter]);

  const typeCounts = useMemo(() => {
    const counts = new Map<FindingType, number>();
    for (const f of findings ?? []) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    return counts;
  }, [findings]);

  const privilegedCount = useMemo(
    () => (findings ?? []).filter((f) => marks[f.id]?.status === "privileged").length,
    [findings, marks],
  );

  const exportLog = useCallback(
    (fmt: "csv" | "json") => {
      if (!findings || !file) return;
      if (privilegedCount === 0) {
        toast.info("No findings marked 'privileged' yet.", {
          description: "Mark items as privileged to include them in the log.",
        });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const base = `privilege-log-${file.name.replace(/\.pdf$/i, "")}-${stamp}`;
      if (fmt === "csv") {
        downloadText(`${base}.csv`, "text/csv", buildPrivilegeLog(findings, marks, file.name));
      } else {
        const rows = findings
          .filter((f) => (marks[f.id]?.status ?? "unreviewed") === "privileged")
          .map((f) => ({
            document: file.name,
            page: f.page,
            type: TYPE_LABEL[f.type],
            basis: (marks[f.id]?.basis?.trim()) || BASIS_HINT[f.type],
            notes: (marks[f.id]?.notes?.trim()) || "",
          }));
        downloadText(`${base}.json`, "application/json", JSON.stringify(rows, null, 2));
      }
      toast.success("Privilege log exported.");
    },
    [findings, file, marks, privilegedCount],
  );

  const handoffToRedact = useCallback(() => {
    if (!findings || findings.length === 0) return;
    const selected = findings.filter(
      (f) => marks[f.id]?.status === "privileged" && f.type !== "confidentiality-legend",
    );
    if (selected.length === 0) {
      toast.info("Select the findings you want to redact first.", {
        description: "Mark at least one item as privileged to hand off to Redact.",
      });
      return;
    }
    // Stash the flagged terms for the Redact panel to seed its keyword input.
    try {
      const terms = Array.from(
        new Set(selected.map((f) => f.snippet).filter(Boolean)),
      ).slice(0, 20);
      window.sessionStorage.setItem(
        "vault.privilege.handoff",
        JSON.stringify({ fileKey, terms, at: Date.now() }),
      );
    } catch { /* ignore */ }
    void navigate({ to: "/workspace", search: { tool: "redact" } as never });
    toast.message("Switched to Redact — apply marks where you've decided to redact rather than withhold.");
  }, [findings, marks, fileKey, navigate]);

  /* --------------------------- Render -------------------------------- */

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a PDF to scan it for privilege indicators.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header / intent */}
      <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] text-text-2">
        <div className="mb-1 flex items-center gap-1.5 text-foreground">
          <ScanSearch className="h-3.5 w-3.5 text-vault" aria-hidden />
          Privilege review
          {!isPro && <LockBadge className="ml-1" />}
        </div>
        Flags attorney–client, work-product, confidentiality legends, counsel
        names, and law-firm correspondence — so you can decide what to withhold
        or log before production. Runs on this device.
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11.5px] text-text-2">
        <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        <span>
          Privilege determinations require attorney review — these are flagged
          for your assessment, not auto-concluded.
        </span>
      </div>

      {/* Scan controls */}
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-[11.5px] text-text-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-vault"
            checked={deep}
            onChange={(e) => setDeep(e.target.checked)}
          />
          <span>
            Deep scan (on-device NER for counsel names) — slower first run.
          </span>
        </label>
        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90 disabled:opacity-50"
        >
          {scanning ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {progress || "Scanning…"}
            </>
          ) : findings ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Re-scan
            </>
          ) : (
            <>
              <Search className="h-3.5 w-3.5" aria-hidden />
              Scan for privilege
            </>
          )}
        </button>
      </div>

      {/* Assessment */}
      {findings && (
        <div className="rounded-md border border-border bg-surface-2 p-3 text-[12px] text-text-2">
          <div className="flex items-center gap-1.5 text-foreground">
            <Info className="h-3.5 w-3.5 text-vault" aria-hidden />
            <strong className="font-medium">{findings.length}</strong> privilege
            {findings.length === 1 ? " indicator" : " indicators"} found
            {findings.length > 0 && " — review before producing."}
          </div>
          {findings.length > 0 && (
            <div className="mt-2 text-[11.5px] text-text-muted">
              {privilegedCount} marked privileged · {findings.length - privilegedCount} unreviewed / not privileged
            </div>
          )}
        </div>
      )}

      {/* Type filter chips */}
      {findings && findings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <TypeChip
            label={`All (${findings.length})`}
            active={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
          />
          {Array.from(typeCounts.entries()).map(([t, n]) => (
            <TypeChip
              key={t}
              label={`${TYPE_LABEL[t]} (${n})`}
              active={typeFilter === t}
              onClick={() => setTypeFilter(t)}
            />
          ))}
        </div>
      )}

      {/* Findings list */}
      {findings && filtered.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {filtered.map((f) => {
            const m = marks[f.id] ?? { status: "unreviewed" as MarkStatus, notes: "" };
            const expanded = expandedId === f.id;
            return (
              <li
                key={f.id}
                className={cn(
                  "rounded-md border bg-surface-2 p-2 text-[11.5px]",
                  m.status === "privileged" && "border-vault/60 bg-vault/5",
                  m.status === "not-privileged" && "border-border/50 opacity-70",
                  m.status === "unreviewed" && "border-border",
                )}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => jumpTo(f)}
                    className="flex-1 text-left"
                    title={`Jump to page ${f.page}`}
                  >
                    <div className="flex items-center gap-1.5 text-foreground">
                      <span className="rounded bg-surface-3 px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-text-2">
                        {TYPE_LABEL[f.type]}
                      </span>
                      <span className="text-text-muted">p. {f.page}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-text-2">
                      {f.snippet}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : f.id)}
                    className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
                    title="Notes & basis"
                    aria-label="Notes & basis"
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <MarkButton
                    label="Privileged"
                    active={m.status === "privileged"}
                    tone="vault"
                    onClick={() => setMark(f.id, { status: "privileged" })}
                  />
                  <MarkButton
                    label="Not privileged"
                    active={m.status === "not-privileged"}
                    onClick={() => setMark(f.id, { status: "not-privileged" })}
                  />
                  {m.status !== "unreviewed" && (
                    <button
                      type="button"
                      onClick={() => setMark(f.id, { status: "unreviewed" })}
                      className="ml-auto text-[10.5px] text-text-muted hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className="mt-2 flex flex-col gap-1.5">
                    <input
                      type="text"
                      placeholder={`Basis (default: ${BASIS_HINT[f.type]})`}
                      value={m.basis ?? ""}
                      onChange={(e) => setMark(f.id, { basis: e.target.value })}
                      className="w-full rounded border border-border bg-surface-1 px-2 py-1 text-[11.5px] text-foreground placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-vault"
                    />
                    <textarea
                      placeholder="Notes (visible in exported log)"
                      value={m.notes}
                      onChange={(e) => setMark(f.id, { notes: e.target.value })}
                      rows={2}
                      className="w-full resize-y rounded border border-border bg-surface-1 px-2 py-1 text-[11.5px] text-foreground placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-vault"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {findings && findings.length === 0 && (
        <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
          No privilege indicators found. If the PDF is a scan, run Make
          Searchable first so text is available for scanning.
        </p>
      )}

      {/* Actions */}
      {findings && findings.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => exportLog("csv")}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export log (CSV)
            </button>
            <button
              type="button"
              onClick={() => exportLog("json")}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3"
              title="Export privilege log as JSON"
            >
              JSON
            </button>
          </div>
          <button
            type="button"
            onClick={handoffToRedact}
            disabled={privilegedCount === 0}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Shield className="h-3.5 w-3.5 text-vault" aria-hidden />
            Hand off to Redact instead
          </button>
          <p className="text-[10.5px] text-text-muted">
            The exported log lists page, type, and basis — never the full
            privileged content.
          </p>
        </div>
      )}
    </div>
  );
}

/* --------------------------- Sub-components ----------------------------- */

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-[2px] text-[10.5px] transition-colors",
        active
          ? "border-vault bg-vault/15 text-foreground"
          : "border-border bg-surface-2 text-text-2 hover:bg-surface-3",
      )}
    >
      {label}
    </button>
  );
}

function MarkButton({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "vault";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-[3px] text-[10.5px] transition-colors",
        active
          ? tone === "vault"
            ? "border-vault bg-vault text-vault-foreground"
            : "border-foreground/40 bg-surface-3 text-foreground"
          : "border-border bg-surface-1 text-text-2 hover:bg-surface-3",
      )}
    >
      {label}
    </button>
  );
}

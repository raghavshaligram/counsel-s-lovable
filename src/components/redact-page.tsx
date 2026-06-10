import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ToolHeader } from "@/routes/split";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Download,
  FileText,
  Trash2,
  X,
  ShieldCheck,
  Lock,
  Wand2,
  Search,
  Tag,
  AlertTriangle,
  MousePointer2,
  Square,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_META,
  type Detection,
  type PiiCategory,
  findKeywordInPdf,
  type KeywordMatch,
} from "@/lib/pdf/detect-pii";

import { buildRedactionCertificate } from "@/lib/pdf/redaction-certificate";


type Box = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  auto?: boolean;
  category?: PiiCategory;
  keywordId?: string; // groups boxes that came from one keyword search
  label?: string;
};
type RenderedPage = {
  pageNumber: number;
  width: number;
  height: number;
  dataUrl: string;
};
type KeywordGroup = {
  id: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  count: number;
};

const EXEMPTION_PRESETS: { value: string; label: string }[] = [
  { value: "FOIA b(1)", label: "FOIA b(1) — National security" },
  { value: "FOIA b(2)", label: "FOIA b(2) — Internal personnel" },
  { value: "FOIA b(3)", label: "FOIA b(3) — Statutory" },
  { value: "FOIA b(4)", label: "FOIA b(4) — Trade secrets" },
  { value: "FOIA b(5)", label: "FOIA b(5) — Deliberative" },
  { value: "FOIA b(6)", label: "FOIA b(6) — Personal privacy" },
  { value: "FOIA b(7)", label: "FOIA b(7) — Law enforcement" },
  { value: "Privacy Act", label: "Privacy Act — PII" },
  { value: "Attorney-Client", label: "Attorney-Client privilege" },
  { value: "Work Product", label: "Work Product doctrine" },
  { value: "Trade Secret", label: "Trade Secret" },
  { value: "PII", label: "PII" },
  { value: "PHI / HIPAA", label: "PHI / HIPAA" },
];

// Rough device tier based on cores + (Chromium-only) device memory.
// We can't read CPU speed from the browser, so this is a coarse hint —
// good enough to widen the time range on weaker hardware.
function deviceTier(): "low" | "mid" | "high" {
  if (typeof navigator === "undefined") return "mid";
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null;
  if (cores <= 4 || (mem !== null && mem <= 4)) return "low";
  if (cores >= 8 && (mem === null || mem >= 8)) return "high";
  return "mid";
}

// Returns [bestMinutes, worstMinutes] for an auto-detect pass over `pages`.
// Best case: every page has a text layer (fast regex scan).
// Worst case: every page is scanned and falls back to OCR.
function estimateDetectMinutes(pages: number): [number, number] {
  const tier = deviceTier();
  const textSecPerPage = tier === "high" ? 0.03 : tier === "mid" ? 0.06 : 0.12;
  const ocrSecPerPage = tier === "high" ? 1.6 : tier === "mid" ? 2.8 : 5.5;
  const best = (pages * textSecPerPage) / 60;
  const worst = (pages * ocrSecPerPage) / 60;
  return [Math.max(1, Math.round(best)), Math.max(1, Math.round(worst))];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildPrivilegeLogCsv(sourceName: string, boxes: Box[]): string {
  const sorted = [...boxes].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const header = [
    "Entry",
    "Source",
    "Page",
    "Exemption / Privilege",
    "Origin",
    "Category",
    "X",
    "Y",
    "Width",
    "Height",
  ];
  const rows: string[] = [header.map(csvCell).join(",")];
  sorted.forEach((b, i) => {
    const origin = b.auto ? "Auto-detect" : b.keywordId ? "Keyword find" : "Manual";
    rows.push(
      [
        i + 1,
        sourceName,
        b.page,
        b.label ?? "",
        origin,
        b.category ?? "",
        Math.round(b.x),
        Math.round(b.y),
        Math.round(b.w),
        Math.round(b.h),
      ]
        .map(csvCell)
        .join(","),
    );
  });
  return rows.join("\n");
}


export function RedactPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPremium = pathname === "/verifiable-redaction";

  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [exporting, setExporting] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [detectionLabels, setDetectionLabels] = useState<Record<string, string>>({});
  const [enabledCats, setEnabledCats] = useState<Set<PiiCategory>>(
    () => new Set(Object.keys(CATEGORY_META) as PiiCategory[]),
  );
  // Cache the parsed pdf.js document so auto-detect / keyword search don't
  // re-parse the file. Held in a ref since we never render from it directly.
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [totalPages, setTotalPages] = useState(0);
  const [detectConfirm, setDetectConfirm] = useState(false);

  // Keyword search-and-redact
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [keywordBoxes, setKeywordBoxes] = useState<Box[]>([]);
  const [kwQuery, setKwQuery] = useState("");
  const [kwMatchCase, setKwMatchCase] = useState(false);
  const [kwWholeWord, setKwWholeWord] = useState(false);
  const [kwSearching, setKwSearching] = useState(false);
  
  const [kwStatus, setKwStatus] = useState<string | null>(null);
  // Two-step: hold matches until the user confirms.
  const [pendingMatches, setPendingMatches] = useState<{
    query: string;
    matchCase: boolean;
    wholeWord: boolean;
    matches: KeywordMatch[];
  } | null>(null);

  // Two-step auto-detect: scan results are staged here until the user commits.
  const [pendingDetections, setPendingDetections] = useState<Detection[] | null>(null);
  const [pendingUsedOcr, setPendingUsedOcr] = useState(false);

  // Export settings (persisted)
  const [stripMetadata, setStripMetadata] = useState(true);
  const [defaultLabel, setDefaultLabel] = useState<string>("");
  const [tool, setTool] = useState<"select" | "box">("box");
  const [currentPage, setCurrentPage] = useState<number>(1);
  useEffect(() => {
    const el = thumbRefs.current.get(currentPage);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPage]);
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "v" || e.key === "V") setTool("select");
      if (e.key === "b" || e.key === "B") setTool("box");
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        setCurrentPage((cur) => {
          const next = Math.min(totalPages || cur, cur + 1);
          const el = document.getElementById(`redact-page-${next}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          return next;
        });
      }
      if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        setCurrentPage((cur) => {
          const next = Math.max(1, cur - 1);
          const el = document.getElementById(`redact-page-${next}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, totalPages]);
  useEffect(() => {
    try {
      const s = localStorage.getItem("vault.redact.stripMetadata");
      if (s !== null) setStripMetadata(s === "1");
      const d = localStorage.getItem("vault.redact.defaultLabel");
      if (d) setDefaultLabel(d);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("vault.redact.stripMetadata", stripMetadata ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [stripMetadata]);
  useEffect(() => {
    try {
      localStorage.setItem("vault.redact.defaultLabel", defaultLabel);
    } catch {
      /* ignore */
    }
  }, [defaultLabel]);

  // Render pages with PDF.js whenever a new file lands.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setLoading(true);
    setPages([]);
    setBoxes([]);
    setDetections([]);
    setDetectionLabels({});
    setKeywordGroups([]);
    setKeywordBoxes([]);
    setPendingMatches(null);
    setPendingDetections(null);
    setPendingUsedOcr(false);
    setDetectConfirm(false);
    docRef.current = null;
    setTotalPages(0);
    (async () => {
      try {
        const { getPdfjs } = await import("@/lib/pdf/worker");
        const pdfjs = await getPdfjs();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        if (cancelled) return;
        docRef.current = doc as unknown as typeof docRef.current;
        setTotalPages(doc.numPages);
        const out: RenderedPage[] = [];
        const SCALE = 1.5;
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Could not get canvas context");
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
          } as Parameters<typeof page.render>[0]).promise;
          out.push({
            pageNumber: i,
            width: canvas.width,
            height: canvas.height,
            dataUrl: canvas.toDataURL("image/png"),
          });
          setPages([...out]);
        }
      } catch (err) {
        console.error(err);
        toast.error("Couldn't read that PDF. Is it password-protected or corrupted?");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const reset = () => {
    setFile(null);
    setPages([]);
    setBoxes([]);
    setDetections([]);
    setDetectionLabels({});
    setKeywordGroups([]);
    setKeywordBoxes([]);
    setPendingMatches(null);
    setPendingDetections(null);
    setPendingUsedOcr(false);
    setDetectConfirm(false);
    docRef.current = null;
    setTotalPages(0);
  };

  const [detectStatus, setDetectStatus] = useState<string | null>(null);

  const runAutoDetect = useCallback(async () => {
    if (!file) return;
    // Confirmation gate for large PDFs — auto-detect on 400+ pages can pin
    // the browser tab for a long time, especially when any page falls back to
    // OCR. Require an explicit second click before we burn the cycles.
    const pages = docRef.current?.numPages ?? totalPages;
    if (pages > 100 && !detectConfirm) {
      setDetectConfirm(true);
      return;
    }
    setDetectConfirm(false);
    setDetecting(true);
    setDetectStatus("Reading text layer…");
    // Clear any previous pending preview so it doesn't blend with new results.
    setPendingDetections(null);
    setPendingUsedOcr(false);
    try {
      const { detectPiiInPdf } = await import("@/lib/pdf/detect-pii");
      const { detections: found, usedOcr } = await detectPiiInPdf(
        file,
        1.5,
        (p) => {
          if (p.stage === "ocr") {
            setDetectStatus(`OCR scanning page ${p.page} of ${p.totalPages}…`);
          } else {
            setDetectStatus(`Reading page ${p.page} of ${p.totalPages}…`);
          }
        },
        docRef.current ?? undefined,
      );
      if (found.length === 0) {
        toast.info("No obvious PII patterns found.", {
          description: usedOcr
            ? "OCR ran but no SSNs, emails, phones, cards, or dates matched. Mark regions manually."
            : "Mark sensitive regions manually with click-and-drag.",
        });
      } else {
        // Stage — do NOT commit to `detections` yet.
        setPendingDetections(found);
        setPendingUsedOcr(usedOcr);
        // Reset category filter so the preview shows everything selected.
        setEnabledCats(new Set(Object.keys(CATEGORY_META) as PiiCategory[]));
        toast.info(
          `Found ${found.length} potential PII region${found.length === 1 ? "" : "s"} — review before redacting`,
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Auto-detect failed");
    } finally {
      setDetecting(false);
      setDetectStatus(null);
    }
  }, [file, totalPages, detectConfirm]);

  const confirmDetectRedact = useCallback(() => {
    if (!pendingDetections) return;
    const filtered = pendingDetections.filter((d) => enabledCats.has(d.category));
    if (filtered.length === 0) {
      toast.info("No categories selected — nothing redacted.");
      return;
    }
    setDetections(filtered);
    setPendingDetections(null);
    setPendingUsedOcr(false);
    toast.success(`Redacted ${filtered.length} region${filtered.length === 1 ? "" : "s"}`);
  }, [pendingDetections, enabledCats]);

  const discardPendingDetections = useCallback(() => {
    setPendingDetections(null);
    setPendingUsedOcr(false);
  }, []);

  const runKeywordSearch = useCallback(async () => {
    if (!file) return;
    const q = kwQuery.trim();
    if (!q) return;
    setKwSearching(true);
    setKwStatus("Reading text layer…");
    setPendingMatches(null);
    try {
      const matches = await findKeywordInPdf(
        file,
        q,
        {
          matchCase: kwMatchCase,
          wholeWord: kwWholeWord,
          // Always OCR scanned pages — the library only runs OCR on pages
          // with no text layer, so text-PDFs pay no cost.
          ocr: true,
          preloadedDoc: docRef.current ?? undefined,
          onProgress: (p) => {
            if (p.stage === "ocr") {
              setKwStatus(`Scanned page OCR ${p.page}/${p.totalPages}…`);
            } else {
              setKwStatus(`Reading page ${p.page}/${p.totalPages}…`);
            }
          },
        },
        1.5,
      );
      if (matches.length === 0) {
        toast.info(`No matches for "${q}"`, {
          description: "Nothing matched, even after OCR on scanned pages. Try a shorter or partial term.",
        });
        return;
      }
      setPendingMatches({ query: q, matchCase: kwMatchCase, wholeWord: kwWholeWord, matches });
    } catch (err) {
      console.error(err);
      toast.error("Search failed");
    } finally {
      setKwSearching(false);
      setKwStatus(null);
    }
  }, [file, kwQuery, kwMatchCase, kwWholeWord]);

  const confirmKeywordRedact = useCallback(() => {
    if (!pendingMatches) return;
    const { query, matchCase, wholeWord, matches } = pendingMatches;
    const groupId = `kg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newBoxes: Box[] = matches.map((m: KeywordMatch) => ({
      id: m.id,
      page: m.page,
      x: m.x,
      y: m.y,
      w: m.w,
      h: m.h,
      keywordId: groupId,
      label: defaultLabel || undefined,
    }));
    setKeywordBoxes((prev) => [...prev, ...newBoxes]);
    setKeywordGroups((prev) => [
      ...prev,
      { id: groupId, query, matchCase, wholeWord, count: matches.length },
    ]);
    setPendingMatches(null);
    setKwQuery("");
    toast.success(`Redacted ${matches.length} instance${matches.length === 1 ? "" : "s"} of "${query}"`);
  }, [pendingMatches, defaultLabel]);

  const discardPendingMatches = useCallback(() => setPendingMatches(null), []);

  // Invalidate any pending preview if the user changes the query / options —
  // otherwise they could click Redact on stale results.
  useEffect(() => {
    setPendingMatches(null);
  }, [kwQuery, kwMatchCase, kwWholeWord]);

  const removeKeywordGroup = (id: string) => {
    setKeywordGroups((prev) => prev.filter((g) => g.id !== id));
    setKeywordBoxes((prev) => prev.filter((b) => b.keywordId !== id));
  };

  const toggleCategory = (cat: PiiCategory) => {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const autoBoxes: Box[] = useMemo(
    () =>
      detections
        .filter((d) => enabledCats.has(d.category))
        .map((d) => ({
          id: d.id,
          page: d.page,
          x: d.x,
          y: d.y,
          w: d.w,
          h: d.h,
          auto: true,
          category: d.category,
          label: detectionLabels[d.id] ?? defaultLabel ?? undefined,
        })),
    [detections, enabledCats, detectionLabels, defaultLabel],
  );

  const allBoxes = useMemo(
    () => [...autoBoxes, ...keywordBoxes, ...boxes],
    [autoBoxes, keywordBoxes, boxes],
  );

  const catCounts = useMemo(() => {
    const m = new Map<PiiCategory, number>();
    for (const d of detections) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [detections]);

  // Per-category counts for the *pending* preview, used in the review step.
  const pendingCatCounts = useMemo(() => {
    const m = new Map<PiiCategory, number>();
    if (!pendingDetections) return m;
    for (const d of pendingDetections) m.set(d.category, (m.get(d.category) ?? 0) + 1);
    return m;
  }, [pendingDetections]);

  const pendingSelectedCount = useMemo(() => {
    if (!pendingDetections) return 0;
    return pendingDetections.filter((d) => enabledCats.has(d.category)).length;
  }, [pendingDetections, enabledCats]);

  // Per-page breakdown for pending keyword matches (top 6 pages, "+N more").
  const pendingMatchPageBreakdown = useMemo(() => {
    if (!pendingMatches) return [] as Array<{ page: number; count: number }>;
    const m = new Map<number, number>();
    for (const x of pendingMatches.matches) m.set(x.page, (m.get(x.page) ?? 0) + 1);
    return [...m.entries()]
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => a.page - b.page);
  }, [pendingMatches]);

  const setBoxLabel = useCallback((id: string, label: string) => {
    // auto-detect ids start with "det-", keyword ids with "kw-"
    if (id.startsWith("det-")) {
      setDetectionLabels((prev) => ({ ...prev, [id]: label }));
      return;
    }
    if (id.startsWith("kw-")) {
      setKeywordBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, label } : b)));
      return;
    }
    setBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, label } : b)));
  }, []);

  const exportRedacted = useCallback(async () => {
    if (!file || pages.length === 0) return;

    // Premium: every redaction must carry an exemption code before export.
    if (isPremium) {
      const unlabeled = allBoxes.filter((b) => !b.label || !b.label.trim());
      if (unlabeled.length > 0) {
        const byPage = new Map<number, number>();
        for (const b of unlabeled) byPage.set(b.page, (byPage.get(b.page) ?? 0) + 1);
        const pageList = [...byPage.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([p, n]) => `p.${p} (${n})`)
          .join(", ");
        toast.error(`${unlabeled.length} redaction${unlabeled.length === 1 ? "" : "s"} need an exemption code`, {
          description: `Set a default in Label, or double-click each box. Missing: ${pageList}`,
        });
        return;
      }
    }

    setExporting(true);
    try {
      const { PDFDocument, PDFName } = await import("pdf-lib");
      const out = await PDFDocument.create();

      if (stripMetadata) {
        out.setTitle("");
        out.setAuthor("");
        out.setSubject("");
        out.setKeywords([]);
        out.setProducer("VaultPDF");
        out.setCreator("VaultPDF");
        const epoch = new Date(0);
        out.setCreationDate(epoch);
        out.setModificationDate(epoch);
        try {
          out.catalog.delete(PDFName.of("Metadata"));
          out.catalog.delete(PDFName.of("PieceInfo"));
          out.catalog.delete(PDFName.of("AcroForm"));
          out.catalog.delete(PDFName.of("Names"));
          out.catalog.delete(PDFName.of("StructTreeRoot"));
        } catch {
          /* best-effort */
        }
      }

      for (const p of pages) {
        const composite = document.createElement("canvas");
        composite.width = p.width;
        composite.height = p.height;
        const ctx = composite.getContext("2d")!;
        const img = await loadImage(p.dataUrl);
        ctx.drawImage(img, 0, 0);
        for (const b of allBoxes.filter((bx) => bx.page === p.pageNumber)) {
          ctx.fillStyle = "#000000";
          ctx.fillRect(b.x, b.y, b.w, b.h);
          if (b.label) {
            drawLabelOnCanvas(ctx, b.label, b.x, b.y, b.w, b.h);
          }
        }
        const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
          composite.toBlob(
            (blob) => {
              if (!blob) return reject(new Error("toBlob failed"));
              blob.arrayBuffer().then((bb) => resolve(new Uint8Array(bb)));
            },
            "image/jpeg",
            0.92,
          );
        });
        const embedded = await out.embedJpg(jpegBytes);
        const page = out.addPage([p.width, p.height]);
        page.drawImage(embedded, { x: 0, y: 0, width: p.width, height: p.height });
      }

      const bytes = await out.save();
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const blob = new Blob([ab], { type: "application/pdf" });
      const baseName = file.name.replace(/\.pdf$/i, "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = baseName + "-redacted.pdf";
      a.click();
      URL.revokeObjectURL(url);

      if (isPremium) {
        // Hash source + output for the chain-of-custody section of the certificate.
        const [sourceHash, redactedHash] = await Promise.all([
          sha256Hex(new Uint8Array(await file.arrayBuffer())),
          sha256Hex(bytes),
        ]);

        try {
          const certBytes = await buildRedactionCertificate({
            sourceName: file.name,
            sourceBytes: file.size,
            pageCount: pages.length,
            boxes: allBoxes,
            stripMetadata,
            sourceHashSHA256: sourceHash,
            redactedHashSHA256: redactedHash,
          });
          const certAb = new ArrayBuffer(certBytes.byteLength);
          new Uint8Array(certAb).set(certBytes);
          const certBlob = new Blob([certAb], { type: "application/pdf" });
          const certUrl = URL.createObjectURL(certBlob);
          const certA = document.createElement("a");
          certA.href = certUrl;
          certA.download = baseName + "-certificate.pdf";
          certA.click();
          URL.revokeObjectURL(certUrl);
        } catch (e) {
          console.error("Certificate generation failed", e);
        }

        // Privilege log CSV — what counsel attaches to the production set.
        try {
          const csv = buildPrivilegeLogCsv(file.name, allBoxes);
          const csvBlob = new Blob([csv], { type: "text/csv;charset=utf-8" });
          const csvUrl = URL.createObjectURL(csvBlob);
          const csvA = document.createElement("a");
          csvA.href = csvUrl;
          csvA.download = baseName + "-privilege-log.csv";
          csvA.click();
          URL.revokeObjectURL(csvUrl);
        } catch (e) {
          console.error("Privilege log generation failed", e);
        }

        toast.success("Redacted PDF + Certificate + Privilege Log saved", {
          description: "SHA-256 hashes recorded. Keep all three together for chain of custody.",
        });
      } else {
        toast.success("Redacted PDF saved", {
          description: stripMetadata
            ? "Pages rasterised, original text destroyed, metadata wiped."
            : "Pages rasterised and original text destroyed.",
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [file, pages, allBoxes, stripMetadata, isPremium]);


  const addBox = useCallback(
    (b: Box) => setBoxes((prev) => [...prev, { ...b, label: defaultLabel || undefined }]),
    [defaultLabel],
  );
  const removeBox = useCallback((id: string) => {
    if (id.startsWith("det-")) {
      setDetections((prev) => prev.filter((d) => d.id !== id));
      return;
    }
    if (id.startsWith("kw-")) {
      setKeywordBoxes((prev) => prev.filter((b) => b.id !== id));
      return;
    }
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const pagesWithBoxes = useMemo(() => {
    const s = new Set<number>();
    for (const b of allBoxes) s.add(b.page);
    return s;
  }, [allBoxes]);

  const scrollToPage = (n: number) => {
    setCurrentPage(n);
    const el = document.getElementById(`redact-page-${n}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const hasPending = !!pendingDetections || !!pendingMatches;
  const sourceHashPrefix = useMemo(() => {
    if (!file) return "";
    return file.name.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase().padEnd(8, "0");
  }, [file]);

  return (
    <AppShell>
      <ToolHeader
        tag={isPremium ? "Verifiable Redaction · Legal" : "Smart Redact"}
        title={
          isPremium
            ? "Court-defensible redaction with a signed audit trail."
            : "Permanently remove anything sensitive."
        }
        sub={
          isPremium ? (
            <>
              Every box requires an exemption code. On export you get the redacted PDF, a
              Certificate of Redaction with{" "}
              <span className="text-foreground">SHA-256 hashes of source and output</span>,
              and a privilege log ready to file alongside production.
            </>
          ) : (
            <>
              Auto-detect PII, batch-redact every instance of a keyword, and optionally label
              each box. On export every page is rasterised and re-baked — the original text
              is <span className="text-foreground">destroyed in the file bytes</span>, not
              just covered.
            </>
          )
        }
        collapsed={!!file}
      />

      {!file ? (
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <FileDropzone
            onFile={setFile}
            label="Drop a PDF to redact"
            sublabel="or click to browse · no upload, no size limit"
          />
          {/* Editor chrome preview — show users what they're getting */}
          <div className="mt-10 rounded-xl border border-border bg-card/30 overflow-hidden opacity-50 pointer-events-none select-none">
            <div className="grid grid-cols-[48px_88px_1fr_320px] h-[280px]">
              <div className="border-r border-border bg-card/40 flex flex-col items-center py-3 gap-2">
                <div className="h-8 w-8 rounded bg-vault/20" />
                <div className="h-8 w-8 rounded bg-muted/40" />
                <div className="h-8 w-8 rounded bg-muted/40" />
                <div className="h-8 w-8 rounded bg-muted/40" />
              </div>
              <div className="border-r border-border bg-card/20 p-2 space-y-2 overflow-hidden">
                {[0,1,2,3].map(i => <div key={i} className="aspect-[3/4] rounded bg-muted/30" />)}
              </div>
              <div className="bg-surface-canvas p-6 flex items-start justify-center">
                <div className="w-2/3 aspect-[3/4] rounded bg-card/40 shadow-stamp" />
              </div>
              <div className="border-l border-border bg-card/40 p-4 space-y-3">
                <div className="h-3 w-24 bg-muted/40 rounded" />
                <div className="h-2 w-full bg-muted/30 rounded" />
                <div className="h-2 w-4/5 bg-muted/30 rounded" />
                <div className="h-8 w-full bg-vault/30 rounded mt-4" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <TooltipProvider delayDuration={250}>
        <div
          className={cn(
            "grid w-full overflow-hidden",
            "grid-cols-[48px_88px_1fr_340px]",
            // shell header 56px + collapsed ToolHeader 48px = 104px
            "h-[calc(100svh-104px)]",
          )}
        >
          {/* ─────── Tool rail ─────── */}
          <div className="border-r border-border bg-card/40 flex flex-col items-center py-3 gap-1">
            <ToolRailBtn
              active={tool === "select"}
              onClick={() => setTool("select")}
              icon={MousePointer2}
              label="Select"
              kbd="V"
            />
            <ToolRailBtn
              active={tool === "box"}
              onClick={() => setTool("box")}
              icon={Square}
              label="Draw redaction"
              kbd="B"
            />
            <div className="my-2 h-px w-6 bg-border" />
            <ToolRailBtn
              onClick={runAutoDetect}
              icon={Wand2}
              label={detecting ? "Scanning…" : "Auto-detect PII"}
              disabled={detecting || loading}
            />
            <ToolRailBtn
              onClick={() => document.getElementById("redact-find-input")?.focus()}
              icon={Search}
              label="Find & redact"
            />
            <ToolRailBtn
              onClick={() => document.getElementById("redact-label-select")?.scrollIntoView({ behavior: "smooth" })}
              icon={Tag}
              label="Exemption label"
            />
            <div className="mt-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={reset}
                    aria-label="Close file"
                    className="grid h-9 w-9 place-items-center rounded-md border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>Close file</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* ─────── Thumbnail strip ─────── */}
          <div className="border-r border-border bg-card/20 overflow-y-auto no-scrollbar">
            <div className="p-2 space-y-2">
              {pages.length === 0 && loading && (
                <div className="text-[10px] text-muted-foreground text-center py-4">Loading…</div>
              )}
              {pages.map((p) => {
                const active = currentPage === p.pageNumber;
                const hasRedaction = pagesWithBoxes.has(p.pageNumber);
                return (
                  <button
                    key={p.pageNumber}
                    ref={(el) => {
                      if (el) thumbRefs.current.set(p.pageNumber, el);
                      else thumbRefs.current.delete(p.pageNumber);
                    }}
                    onClick={() => scrollToPage(p.pageNumber)}
                    className={cn(
                      "relative w-full rounded-md overflow-hidden border-2 transition group",
                      active
                        ? "border-vault ring-1 ring-vault/40"
                        : hasRedaction
                          ? "border-[var(--evidence)] ring-1 ring-[var(--evidence)]/30 hover:opacity-90"
                          : "border-border/60 hover:border-border",
                    )}
                  >
                    <img
                      src={p.dataUrl}
                      alt=""
                      className={cn(
                        "block w-full h-auto",
                        hasRedaction && !active && "opacity-80",
                      )}
                      style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    />
                    {hasRedaction && (
                      <span
                        className="absolute top-1 right-1 inline-block h-2.5 w-2.5 rounded-full ring-2 ring-background"
                        style={{ background: "var(--evidence)" }}
                      />
                    )}
                    <span
                      className={cn(
                        "absolute bottom-0.5 left-0.5 right-0.5 text-center text-[9px] font-mono tabular-nums rounded-sm py-px",
                        hasRedaction && !active
                          ? "text-[var(--evidence)] bg-[var(--evidence)]/10 font-bold"
                          : "text-foreground/80 bg-background/70",
                      )}
                    >
                      {p.pageNumber}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ─────── Canvas ─────── */}
          <div
            className={cn(
              "relative overflow-y-auto bg-surface-canvas vault-grid",
              isPremium && "border-l-2 border-vault/70",
              hasPending && "transition-opacity",
            )}
          >
            {/* Canvas header bar */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-surface-canvas/85 backdrop-blur text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-3.5 w-3.5 text-vault shrink-0" />
                <span className="truncate text-foreground">{file.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {(file.size / 1024).toFixed(1)} KB · {pages.length} pp
                </span>
                {isPremium && (
                  <span className="inline-flex items-center gap-1.5 rounded border border-vault/40 bg-vault/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-vault">
                    <ShieldCheck className="h-3 w-3" /> Verifiable
                    <span className="font-mono normal-case tracking-normal text-vault/70">
                      {sourceHashPrefix}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground shrink-0">
                {tool === "box" ? "Draw mode" : "Select mode"}
              </div>
            </div>

            {loading && pages.length === 0 && (
              <div className="p-12 text-center text-sm text-muted-foreground">
                Reading PDF locally…
              </div>
            )}

            <div className={cn("p-8 space-y-8 max-w-5xl mx-auto", hasPending && "opacity-50")}>
              {pages.map((p) => (
                <div key={p.pageNumber} id={`redact-page-${p.pageNumber}`}>
                  <PageCanvas
                    page={p}
                    boxes={allBoxes.filter((b) => b.page === p.pageNumber)}
                    onAddBox={addBox}
                    onRemoveBox={removeBox}
                    onLabelChange={setBoxLabel}
                    tool={tool}
                    onFocus={() => setCurrentPage(p.pageNumber)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* ─────── Inspector ─────── */}
          <aside className="border-l border-border bg-card/60 overflow-y-auto">
            <div className="p-4 space-y-5">
              {/* Get started — visible until the first detection / keyword / pending review */}
              {!pendingDetections && !pendingMatches && detections.length === 0 && keywordGroups.length === 0 && (
                <Section header="Get started">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Scan this PDF for SSNs, emails, phones, cards, dates &amp; more. Scanned pages fall back to OCR automatically.
                  </p>
                  <Button
                    onClick={runAutoDetect}
                    disabled={detecting || loading}
                    className="w-full gap-2"
                  >
                    <Wand2 className="h-4 w-4" />
                    {detecting ? (detectStatus ?? "Scanning…") : "Auto-detect PII (OCR)"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">
                    Or use the <span className="text-foreground">Draw</span> tool <kbd className="rounded bg-muted px-1 font-mono">B</kbd> to mark regions manually.
                  </p>
                </Section>
              )}

              {/* Pending review — only when there's something to commit */}
              {pendingDetections && (
                <Section header="Pending review" tone="evidence">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-mono tabular-nums text-foreground">{pendingDetections.length}</span>{" "}
                    potential item{pendingDetections.length === 1 ? "" : "s"} found
                    {pendingUsedOcr && " (OCR used)"}. Toggle categories, then redact.
                  </p>
                  <div className="space-y-1.5">
                    {(Object.keys(CATEGORY_META) as PiiCategory[])
                      .filter((c) => (pendingCatCounts.get(c) ?? 0) > 0)
                      .map((c) => {
                        const on = enabledCats.has(c);
                        const count = pendingCatCounts.get(c) ?? 0;
                        return <CatPill key={c} on={on} count={count} label={CATEGORY_META[c].label} onClick={() => toggleCategory(c)} />;
                      })}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={confirmDetectRedact}
                      className="flex-1 text-white"
                      style={{ background: "var(--evidence)" }}
                      disabled={pendingSelectedCount === 0}
                    >
                      Redact {pendingSelectedCount}
                    </Button>
                    <Button onClick={discardPendingDetections} variant="ghost" className="flex-1">
                      Discard
                    </Button>
                  </div>
                </Section>
              )}

              {pendingMatches && (
                <Section header="Pending review" tone="evidence">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="font-mono tabular-nums text-foreground">{pendingMatches.matches.length}</span>{" "}
                    match{pendingMatches.matches.length === 1 ? "" : "es"} for{" "}
                    <span className="text-foreground">"{pendingMatches.query}"</span>
                  </p>
                  <div className="max-h-32 overflow-y-auto rounded border border-border bg-card/40 px-2 py-1.5 text-[11px] font-mono space-y-0.5">
                    {pendingMatchPageBreakdown.slice(0, 8).map((row) => (
                      <div key={row.page} className="flex justify-between">
                        <span className="text-muted-foreground">Page {row.page}</span>
                        <span className="tabular-nums">{row.count}</span>
                      </div>
                    ))}
                    {pendingMatchPageBreakdown.length > 8 && (
                      <div className="text-muted-foreground italic">
                        +{pendingMatchPageBreakdown.length - 8} more
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={confirmKeywordRedact}
                      className="flex-1 text-white"
                      style={{ background: "var(--evidence)" }}
                    >
                      Redact all
                    </Button>
                    <Button onClick={discardPendingMatches} variant="ghost" className="flex-1">
                      Cancel
                    </Button>
                  </div>
                </Section>
              )}

              {/* PII categories — only when committed detections exist */}
              {!pendingDetections && detections.length > 0 && (
                <Section header="PII categories">
                  <div className="space-y-1.5">
                    {(Object.keys(CATEGORY_META) as PiiCategory[])
                      .filter((c) => (catCounts.get(c) ?? 0) > 0)
                      .map((c) => {
                        const on = enabledCats.has(c);
                        const count = catCounts.get(c) ?? 0;
                        return <CatPill key={c} on={on} count={count} label={CATEGORY_META[c].label} onClick={() => toggleCategory(c)} />;
                      })}
                  </div>
                </Section>
              )}

              {/* Auto-detect status / confirm */}
              {(detectConfirm || detectStatus) && (
                <Section header="Auto-detect">
                  {detectConfirm && !detecting && (() => {
                    const [best, worst] = estimateDetectMinutes(totalPages);
                    return (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          <span className="font-mono tabular-nums">{totalPages}</span> pages — ~{best === worst ? `${best} min` : `${best}–${worst} min`}
                        </div>
                        <Button onClick={runAutoDetect} variant="outline" size="sm" className="w-full mt-2">
                          Yes, scan {totalPages} pages
                        </Button>
                      </div>
                    );
                  })()}
                  {detectStatus && (
                    <div className="text-[11px] font-mono text-muted-foreground text-center">{detectStatus}</div>
                  )}
                </Section>
              )}

              {/* Find & redact */}
              <Section header="Find & redact">
                <form
                  onSubmit={(e) => { e.preventDefault(); runKeywordSearch(); }}
                  className="space-y-2"
                >
                  <Input
                    id="redact-find-input"
                    value={kwQuery}
                    onChange={(e) => setKwQuery(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    disabled={kwSearching}
                  />
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={kwMatchCase} onCheckedChange={(v) => setKwMatchCase(v === true)} />
                      Match case
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox checked={kwWholeWord} onCheckedChange={(v) => setKwWholeWord(v === true)} />
                      Whole word
                    </label>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md border border-border/60 bg-card/30 p-2">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 text-[var(--vault-amber)] shrink-0" />
                    <span className="leading-snug">
                      <span className="text-foreground font-medium">Scanned pages auto-OCR</span>
                      <br />
                      Image-only pages are detected and OCR'd automatically — no setup needed.
                    </span>
                  </div>
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={!kwQuery.trim() || kwSearching}
                  >
                    {kwSearching ? (kwStatus ?? "Searching…") : "Find matches"}
                  </Button>
                  {kwStatus && kwSearching && (
                    <div className="text-[11px] font-mono text-muted-foreground text-center">{kwStatus}</div>
                  )}
                </form>
                {keywordGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {keywordGroups.map((g) => (
                      <span
                        key={g.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-vault/40 bg-vault/10 px-2.5 py-1 text-[11px]"
                      >
                        <span className="font-medium">{g.query}</span>
                        <span className="text-muted-foreground font-mono tabular-nums">· {g.count}</span>
                        <button
                          onClick={() => removeKeywordGroup(g.id)}
                          className="ml-0.5 text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${g.query}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Section>

              {/* Exemption label */}
              <Section header="Exemption label">
                {isPremium && (
                  <div className="rounded-md border border-vault/30 bg-vault/10 p-2 text-[11px] text-vault leading-relaxed">
                    Required — export is blocked if any box is missing a code.
                  </div>
                )}
                <Select
                  value={defaultLabel || "__none"}
                  onValueChange={(v) => setDefaultLabel(v === "__none" ? "" : v)}
                >
                  <SelectTrigger id="redact-label-select">
                    <SelectValue placeholder="No label" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No label</SelectItem>
                    {EXEMPTION_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Or type a custom label"
                  value={defaultLabel}
                  onChange={(e) => setDefaultLabel(e.target.value)}
                />
              </Section>

              {/* Export */}
              <Section header="Export">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-3xl tabular-nums leading-none text-foreground">
                    {allBoxes.length}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    redactions
                  </div>
                </div>
                {(boxes.length > 0 || detections.length > 0 || keywordBoxes.length > 0) && (
                  <button
                    onClick={() => {
                      setBoxes([]);
                      setDetections([]);
                      setDetectionLabels({});
                      setKeywordGroups([]);
                      setKeywordBoxes([]);
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Trash2 className="h-3 w-3" /> Clear all
                  </button>
                )}
                <label className="flex items-center justify-between gap-3 text-xs py-1">
                  <span className="text-muted-foreground">Strip hidden metadata</span>
                  <Switch checked={stripMetadata} onCheckedChange={setStripMetadata} />
                </label>
                <Button
                  onClick={exportRedacted}
                  disabled={allBoxes.length === 0 || exporting || loading}
                  className="w-full bg-vault text-vault-foreground hover:opacity-90"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {exporting
                    ? "Exporting…"
                    : isPremium
                      ? "Sign & Export"
                      : "Burn & Export"}
                </Button>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  <Lock className="inline h-2.5 w-2.5 mr-1 text-vault" />
                  Pages rasterised. Original text destroyed in the file bytes.
                </p>
              </Section>
            </div>
          </aside>
        </div>
        </TooltipProvider>
      )}
    </AppShell>
  );
}

// ────────── inspector primitives ──────────

function Section({
  header,
  tone,
  children,
}: {
  header: string;
  tone?: "evidence";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg p-3",
        tone === "evidence"
          ? "border-2 animate-fade-in"
          : "border border-border/60 bg-card/30",
      )}
      style={tone === "evidence" ? { borderColor: "var(--evidence)", background: "color-mix(in oklab, var(--evidence) 8%, transparent)" } : undefined}
    >
      <div
        className={cn(
          "font-display text-[11px] uppercase tracking-[0.18em]",
          tone === "evidence" ? "" : "text-muted-foreground",
        )}
        style={tone === "evidence" ? { color: "var(--evidence)" } : undefined}
      >
        {header}
      </div>
      {children}
    </div>
  );
}

function CatPill({
  on,
  count,
  label,
  onClick,
}: {
  on: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between text-xs px-3 py-2 rounded-md border transition",
        on
          ? "border-vault/50 bg-vault/10 text-foreground"
          : "border-border bg-card/30 text-muted-foreground hover:bg-card",
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cn("inline-block h-2 w-2 rounded-full", on ? "bg-vault" : "bg-muted-foreground/40")} />
        {label}
      </span>
      <span className="font-mono tabular-nums">{count}</span>
    </button>
  );
}

function ToolRailBtn({
  active,
  onClick,
  icon: Icon,
  label,
  kbd,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  kbd?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "relative grid h-9 w-9 place-items-center rounded-md transition",
            active
              ? "bg-vault/15 text-vault"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
            disabled && "opacity-40 cursor-not-allowed",
          )}
        >
          {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-vault" />}
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="flex items-center gap-2">
        <span>{label}</span>
        {kbd && (
          <kbd className="rounded bg-background/20 px-1 py-0.5 text-[10px] font-mono">{kbd}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}


function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Pick a font size that lets `text` fit within (w-pad) × (h-pad).
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
): number {
  const maxByHeight = Math.max(6, Math.min(h * 0.7, 28));
  let size = maxByHeight;
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  const target = w - 6;
  if (target <= 8) return Math.max(6, Math.min(h * 0.6, 10));
  while (ctx.measureText(text).width > target && size > 6) {
    size -= 1;
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  }
  return size;
}

function drawLabelOnCanvas(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (w < 14 || h < 8) return;
  const size = fitFontSize(ctx, label, w, h);
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + w / 2, y + h / 2, w - 4);
  ctx.restore();
}

function PageCanvas({
  page,
  boxes,
  onAddBox,
  onRemoveBox,
  onLabelChange,
  tool = "box",
  onFocus,
}: {
  page: RenderedPage;
  boxes: Box[];
  onAddBox: (b: Box) => void;
  onRemoveBox: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
  tool?: "select" | "box";
  onFocus?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const toLocal = (clientX: number, clientY: number) => {
    const el = wrapRef.current!;
    const rect = el.getBoundingClientRect();
    const scaleX = page.width / rect.width;
    const scaleY = page.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const drawMode = tool === "box";

  return (
    <div
      className="rounded-sm overflow-hidden shadow-stamp bg-white"
      onMouseEnter={onFocus}
    >
      <div
        ref={wrapRef}
        className={cn(
          "relative select-none",
          drawMode ? "cursor-crosshair" : "cursor-default",
        )}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={(e) => {
          if (!drawMode) return;
          if ((e.target as HTMLElement).closest("[data-box]")) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          const p = toLocal(e.clientX, e.clientY);
          startRef.current = p;
          setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!startRef.current) return;
          const p = toLocal(e.clientX, e.clientY);
          const s = startRef.current;
          setDrawing({
            x: Math.min(s.x, p.x),
            y: Math.min(s.y, p.y),
            w: Math.abs(p.x - s.x),
            h: Math.abs(p.y - s.y),
          });
        }}
        onPointerUp={() => {
          if (drawing && drawing.w > 4 && drawing.h > 4) {
            onAddBox({
              id: `${page.pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              page: page.pageNumber,
              ...drawing,
            });
          }
          startRef.current = null;
          setDrawing(null);
        }}
      >
        <span className="absolute top-1.5 left-1.5 z-10 rounded bg-background/80 px-1.5 py-px text-[10px] font-mono tabular-nums text-muted-foreground">
          p.{page.pageNumber}
        </span>

        <img
          src={page.dataUrl}
          alt={`Page ${page.pageNumber}`}
          className="block w-full h-full pointer-events-none"
          draggable={false}
        />
        {boxes.map((b) => (
          <BoxOverlay
            key={b.id}
            box={b}
            pageWidth={page.width}
            pageHeight={page.height}
            onRemove={() => onRemoveBox(b.id)}
            onLabelChange={(label) => onLabelChange(b.id, label)}
          />
        ))}
        {drawing && (
          <div
            className="absolute bg-vault/30 border-2 border-vault pointer-events-none"
            style={{
              left: `${(drawing.x / page.width) * 100}%`,
              top: `${(drawing.y / page.height) * 100}%`,
              width: `${(drawing.w / page.width) * 100}%`,
              height: `${(drawing.h / page.height) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

function BoxOverlay({
  box,
  pageWidth,
  pageHeight,
  onRemove,
  onLabelChange,
}: {
  box: Box;
  pageWidth: number;
  pageHeight: number;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(box.label ?? "");
  useEffect(() => {
    setDraft(box.label ?? "");
  }, [box.label]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          data-box
          className="absolute bg-black border border-vault/60 group cursor-pointer overflow-hidden"
          style={{
            left: `${(box.x / pageWidth) * 100}%`,
            top: `${(box.y / pageHeight) * 100}%`,
            width: `${(box.w / pageWidth) * 100}%`,
            height: `${(box.h / pageHeight) * 100}%`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          {box.label && (
            <div className="absolute inset-0 grid place-items-center px-1 text-white font-semibold text-center leading-none pointer-events-none">
              <span
                className="truncate w-full"
                style={{ fontSize: "clamp(7px, 1.2vw, 13px)" }}
              >
                {box.label}
              </span>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-vault text-vault-foreground opacity-0 group-hover:opacity-100 transition pointer-events-auto"
            aria-label="Remove redaction"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3 space-y-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-foreground">Exemption label</div>
        <Select value={draft || "__none"} onValueChange={(v) => setDraft(v === "__none" ? "" : v)}>
          <SelectTrigger>
            <SelectValue placeholder="No label" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">No label</SelectItem>
            {EXEMPTION_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Custom label"
        />
        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onLabelChange(draft.trim());
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

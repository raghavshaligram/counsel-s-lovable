import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_META,
  type Detection,
  type PiiCategory,
  findKeywordInPdf,
  type KeywordMatch,
} from "@/lib/pdf/detect-pii";

import { softwareAppSchema } from "@/lib/seo/tool-schema";

export const Route = createFileRoute("/redact")({
  head: () => ({
    meta: [
      { title: "Smart Redact — VaultPDF" },
      {
        name: "description",
        content:
          "Permanently remove sensitive content from PDFs. AI PII auto-detection, keyword batch redact, exemption codes — 100% in your browser.",
      },
      { property: "og:title", content: "Smart Redact — VaultPDF" },
      {
        property: "og:description",
        content:
          "Redact PDFs without uploading them. Auto-detect PII, find-and-redact-all, FOIA exemption labels, true content removal.",
      },
      { property: "og:url", content: "/redact" },
    ],
    links: [{ rel: "canonical", href: "/redact" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "VaultPDF Smart Redact",
            url: "/redact",
            description:
              "AI-detected PII redaction with keyword batching and legal exemption codes. Content is permanently removed in your browser.",
          }),
        ),
      },
    ],
  }),
  component: RedactPage,
});

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

function RedactPage() {
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

  // Keyword search-and-redact
  const [keywordGroups, setKeywordGroups] = useState<KeywordGroup[]>([]);
  const [keywordBoxes, setKeywordBoxes] = useState<Box[]>([]);
  const [kwQuery, setKwQuery] = useState("");
  const [kwMatchCase, setKwMatchCase] = useState(false);
  const [kwWholeWord, setKwWholeWord] = useState(false);
  const [kwSearching, setKwSearching] = useState(false);

  // Export settings (persisted)
  const [stripMetadata, setStripMetadata] = useState(true);
  const [defaultLabel, setDefaultLabel] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"detect" | "find" | "label">("detect");
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
    (async () => {
      try {
        const { getPdfjs } = await import("@/lib/pdf/worker");
        const pdfjs = await getPdfjs();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
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
  };

  const [detectStatus, setDetectStatus] = useState<string | null>(null);

  const runAutoDetect = useCallback(async () => {
    if (!file) return;
    setDetecting(true);
    setDetectStatus("Reading text layer…");
    try {
      const { detectPiiInPdf } = await import("@/lib/pdf/detect-pii");
      const { detections: found, usedOcr } = await detectPiiInPdf(file, 1.5, (p) => {
        if (p.stage === "ocr") {
          setDetectStatus(`OCR scanning page ${p.page} of ${p.totalPages}…`);
        } else {
          setDetectStatus(`Reading page ${p.page} of ${p.totalPages}…`);
        }
      });
      setDetections(found);
      if (found.length === 0) {
        toast.info("No obvious PII patterns found.", {
          description: usedOcr
            ? "OCR ran but no SSNs, emails, phones, cards, or dates matched. Mark regions manually."
            : "Mark sensitive regions manually with click-and-drag.",
        });
      } else {
        toast.success(
          `Found ${found.length} likely PII region${found.length === 1 ? "" : "s"}`,
          {
            description: usedOcr
              ? "Some pages were scanned — OCR was used. Review categories on the right."
              : "Review and toggle categories on the right, then export.",
          },
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Auto-detect failed");
    } finally {
      setDetecting(false);
      setDetectStatus(null);
    }
  }, [file]);

  const runKeywordSearch = useCallback(async () => {
    if (!file) return;
    const q = kwQuery.trim();
    if (!q) return;
    setKwSearching(true);
    try {
      const matches = await findKeywordInPdf(
        file,
        q,
        { matchCase: kwMatchCase, wholeWord: kwWholeWord },
        1.5,
      );
      if (matches.length === 0) {
        toast.info(`No matches for "${q}"`, {
          description: "Tip: scanned PDFs have no text layer — run Auto-detect (OCR) first.",
        });
        return;
      }
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
        {
          id: groupId,
          query: q,
          matchCase: kwMatchCase,
          wholeWord: kwWholeWord,
          count: matches.length,
        },
      ]);
      setKwQuery("");
      toast.success(`Redacted ${matches.length} instance${matches.length === 1 ? "" : "s"} of "${q}"`);
    } catch (err) {
      console.error(err);
      toast.error("Search failed");
    } finally {
      setKwSearching(false);
    }
  }, [file, kwQuery, kwMatchCase, kwWholeWord, defaultLabel]);

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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.pdf$/i, "") + "-redacted.pdf";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Redacted PDF saved", {
        description: stripMetadata
          ? "Pages rasterised, original text destroyed, metadata wiped."
          : "Pages rasterised and original text destroyed. (Metadata kept per your setting.)",
      });
    } catch (err) {
      console.error(err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [file, pages, allBoxes, stripMetadata]);

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

  return (
    <AppShell>
      <ToolHeader
        tag="Smart Redact"
        title="Permanently remove anything sensitive."
        sub={
          <>
            Auto-detect PII, batch-redact every instance of a keyword, and stamp legal
            exemption codes on each box. On export every page is rasterised and re-baked —
            the original text is{" "}
            <span className="text-foreground">destroyed in the file bytes</span>, not just
            covered.
          </>
        }
        collapsed={!!file}
      />

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        {!file ? (
          <FileDropzone
            onFile={setFile}
            label="Drop a PDF to redact"
            sublabel="or click to browse · no upload, no size limit"
          />
        ) : (
          <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="h-4 w-4 text-vault shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB · {pages.length} page
                      {pages.length === 1 ? "" : "s"} loaded
                      {loading && pages.length > 0 && " · loading more…"}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  <X className="h-4 w-4 mr-1" /> Close
                </Button>
              </div>

              {loading && pages.length === 0 && (
                <div className="rounded-lg border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
                  Reading PDF locally…
                </div>
              )}

              <div className="space-y-6">
                {pages.map((p) => (
                  <PageCanvas
                    key={p.pageNumber}
                    page={p}
                    boxes={allBoxes.filter((b) => b.page === p.pageNumber)}
                    onAddBox={addBox}
                    onRemoveBox={removeBox}
                    onLabelChange={setBoxLabel}
                  />
                ))}
              </div>
            </div>

            <aside className="lg:sticky lg:top-20 rounded-xl border border-border bg-card/80 backdrop-blur-sm h-auto transition-all duration-500 ease-out overflow-hidden">
              {/* Global Header */}
              <div className="grid grid-cols-3 gap-1 px-3 py-3 border-b border-border">
                {[
                  { id: "detect" as const, icon: Wand2, label: "Detect" },
                  { id: "find" as const, icon: Search, label: "Find" },
                  { id: "label" as const, icon: Tag, label: "Label" },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all border",
                      activeTab === t.id
                        ? "bg-vault/15 text-vault border-vault/30"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border-transparent"
                    )}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Dynamic Content Area */}
              <div className="p-4 space-y-4">
                {activeTab === "detect" && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2 text-foreground font-medium text-sm">
                        <Wand2 className="h-4 w-4 text-vault" />
                        Auto-detect PII
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Scans for SSNs, emails, phones, cards, dates, IPs, IBANs. Falls back to
                        on-device OCR for scanned pages.
                      </p>
                    </div>
                    <Button
                      onClick={runAutoDetect}
                      disabled={detecting || loading}
                      variant="outline"
                      className="w-full"
                    >
                      <Wand2 className="h-3.5 w-3.5 mr-2" />
                      {detecting
                        ? "Scanning…"
                        : detections.length > 0
                          ? "Re-scan"
                          : "Scan this PDF"}
                    </Button>
                    {detectStatus && (
                      <div className="text-[11px] text-muted-foreground text-center">
                        {detectStatus}
                      </div>
                    )}
                    {detections.length > 0 && (
                      <div className="space-y-1.5">
                        {(Object.keys(CATEGORY_META) as PiiCategory[])
                          .filter((c) => (catCounts.get(c) ?? 0) > 0)
                          .map((c) => {
                            const on = enabledCats.has(c);
                            const count = catCounts.get(c) ?? 0;
                            return (
                              <button
                                key={c}
                                onClick={() => toggleCategory(c)}
                                className={`w-full flex items-center justify-between text-xs px-3 py-2 rounded-md border transition ${
                                  on
                                    ? "border-vault/50 bg-vault/10 text-foreground"
                                    : "border-border bg-card/30 text-muted-foreground hover:bg-card"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`inline-block h-2 w-2 rounded-full ${
                                      on ? "bg-vault" : "bg-muted-foreground/40"
                                    }`}
                                  />
                                  {CATEGORY_META[c].label}
                                </span>
                                <span className="tabular-nums">{count}</span>
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "find" && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2 text-foreground font-medium text-sm">
                        <Search className="h-4 w-4 text-vault" />
                        Find &amp; redact all
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Type a word or phrase — every match across all pages is redacted in one
                        click.
                      </p>
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        runKeywordSearch();
                      }}
                      className="space-y-2"
                    >
                      <Input
                        value={kwQuery}
                        onChange={(e) => setKwQuery(e.target.value)}
                        placeholder="e.g. Acme Corp"
                        disabled={kwSearching}
                      />
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={kwMatchCase}
                            onCheckedChange={(v) => setKwMatchCase(v === true)}
                          />
                          Match case
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={kwWholeWord}
                            onCheckedChange={(v) => setKwWholeWord(v === true)}
                          />
                          Whole word
                        </label>
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        className="w-full"
                        disabled={!kwQuery.trim() || kwSearching}
                      >
                        {kwSearching ? "Searching…" : "Redact all matches"}
                      </Button>
                    </form>
                    {keywordGroups.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {keywordGroups.map((g) => (
                          <span
                            key={g.id}
                            className="inline-flex items-center gap-1.5 rounded-full border border-vault/40 bg-vault/10 px-2.5 py-1 text-[11px]"
                          >
                            <span className="font-medium">{g.query}</span>
                            <span className="text-muted-foreground tabular-nums">
                              · {g.count}
                            </span>
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
                  </div>
                )}

                {activeTab === "label" && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center gap-2 text-foreground font-medium text-sm">
                        <Tag className="h-4 w-4 text-vault" />
                        Default exemption label
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        Stamped in white over every new redaction. Double-click any box to
                        override.
                      </p>
                    </div>
                    <Select
                      value={defaultLabel || "__none"}
                      onValueChange={(v) => setDefaultLabel(v === "__none" ? "" : v)}
                    >
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
                      placeholder="Or type a custom label"
                      value={defaultLabel}
                      onChange={(e) => setDefaultLabel(e.target.value)}
                    />
                    <div className="rounded-md border border-border bg-card/30 p-3 text-[11px] text-muted-foreground leading-relaxed">
                      <div className="flex items-center gap-1.5 text-foreground font-medium mb-1">
                        <ShieldCheck className="h-3 w-3 text-vault" />
                        How export works
                      </div>
                      Each page is rasterised, redactions and labels are baked in, and the image
                      replaces the page. With metadata stripping on, the info dict, XMP, form
                      fields, and structure tree are removed.
                    </div>
                  </div>
                )}

                {/* Persistent Summary Footer */}
                <div className="pt-3 border-t border-border space-y-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        Redactions
                      </div>
                      <div className="text-2xl font-display leading-none mt-1">
                        {allBoxes.length}
                      </div>
                    </div>
                    {(boxes.length > 0 ||
                      detections.length > 0 ||
                      keywordBoxes.length > 0) && (
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
                        <Trash2 className="h-3 w-3" /> Clear
                      </button>
                    )}
                  </div>
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
                    {exporting ? "Exporting…" : "Export redacted PDF"}
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
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
}: {
  page: RenderedPage;
  boxes: Box[];
  onAddBox: (b: Box) => void;
  onRemoveBox: (id: string) => void;
  onLabelChange: (id: string, label: string) => void;
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

  return (
    <div className="rounded-lg border border-border bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/60 text-xs text-muted-foreground">
        <span>Page {page.pageNumber}</span>
        <span>Drag to mark · double-click a box to label it</span>
      </div>
      <div
        ref={wrapRef}
        className="relative select-none cursor-crosshair"
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={(e) => {
          // Don't start a new drag when interacting with an existing box / popover
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

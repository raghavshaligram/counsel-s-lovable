import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, FileText, Lock, Scissors, X, RefreshCw } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { useHotkey, modKey } from "@/lib/use-hotkey";

export const Route = createFileRoute("/split")({
  head: () => ({
    meta: [
      { title: "Split PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Split a PDF by page ranges or extract individual pages. 100% client-side — your file never leaves the browser.",
      },
      { property: "og:title", content: "Split PDF — VaultPDF" },
      {
        property: "og:description",
        content: "Page ranges or one-page-per-file, in your browser. No upload.",
      },
      { property: "og:url", content: "/split" },
    ],
    links: [{ rel: "canonical", href: "/split" }],
  }),
  component: SplitPage,
});

type Mode = "ranges" | "each";

function SplitPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [mode, setMode] = useState<Mode>("ranges");
  const [ranges, setRanges] = useState("1-");
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setPageCount(doc.getPageCount());
      setRanges(`1-${doc.getPageCount()}`);
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const parsed = useMemo(() => parseRanges(ranges, pageCount), [ranges, pageCount]);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setRanges("1-");
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const src = await PDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const base = file.name.replace(/\.pdf$/i, "");

      if (mode === "each") {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (let i = 0; i < src.getPageCount(); i++) {
          const out = await PDFDocument.create();
          const [p] = await out.copyPages(src, [i]);
          out.addPage(p);
          const bytes = await out.save();
          zip.file(`${base}-p${String(i + 1).padStart(3, "0")}.pdf`, bytes);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${base}-pages.zip`);
        toast.success(`Saved ${src.getPageCount()} files in zip`);
      } else {
        if (parsed.groups.length === 0) {
          toast.error("Enter at least one valid range like 1-3, 5, 8-10");
          return;
        }
        if (parsed.groups.length === 1) {
          const idx = parsed.groups[0].map((n) => n - 1);
          const out = await PDFDocument.create();
          const pages = await out.copyPages(src, idx);
          pages.forEach((p) => out.addPage(p));
          const bytes = await out.save();
          downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${base}-split.pdf`);
          toast.success(`Saved ${idx.length} pages`);
        } else {
          const JSZip = (await import("jszip")).default;
          const zip = new JSZip();
          for (let g = 0; g < parsed.groups.length; g++) {
            const idx = parsed.groups[g].map((n) => n - 1);
            const out = await PDFDocument.create();
            const pages = await out.copyPages(src, idx);
            pages.forEach((p) => out.addPage(p));
            const bytes = await out.save();
            zip.file(`${base}-part${g + 1}.pdf`, bytes);
          }
          const blob = await zip.generateAsync({ type: "blob" });
          downloadBlob(blob, `${base}-split.zip`);
          toast.success(`Saved ${parsed.groups.length} files in zip`);
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Split failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <ToolHeader
        tag="Split"
        title="Split a PDF. Pages or ranges."
        sub="Extract pages 1–5 as one PDF. Or every page as its own file in a zip. Your file stays on this tab."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to split" sublabel="no upload, no page limit" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div className="flex gap-2">
                <ModeBtn active={mode === "ranges"} onClick={() => setMode("ranges")}>
                  By ranges
                </ModeBtn>
                <ModeBtn active={mode === "each"} onClick={() => setMode("each")}>
                  Every page as a file
                </ModeBtn>
              </div>

              {mode === "ranges" && (
                <div>
                  <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Ranges
                  </label>
                  <input
                    value={ranges}
                    onChange={(e) => setRanges(e.target.value)}
                    placeholder="e.g. 1-3, 5, 8-10"
                    className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {parsed.error ? (
                      <span className="text-destructive">{parsed.error}</span>
                    ) : parsed.groups.length === 0 ? (
                      "Enter pages like 1-3, 5, 8-10"
                    ) : parsed.groups.length === 1 ? (
                      `One file with ${parsed.groups[0].length} page${parsed.groups[0].length === 1 ? "" : "s"}`
                    ) : (
                      `${parsed.groups.length} files in a zip (${parsed.groups
                        .map((g) => g.length)
                        .join(" + ")} pages)`
                    )}
                  </div>
                </div>
              )}

              <Button
                onClick={run}
                disabled={busy}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full"
              >
                {busy ? "Splitting…" : (
                  <>
                    <Scissors className="h-4 w-4 mr-2" /> Split & download
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function parseRanges(input: string, total: number): { groups: number[][]; error?: string } {
  if (!total) return { groups: [] };
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { groups: [] };
  const groups: number[][] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d*))?$/);
    if (!m) return { groups: [], error: `"${part}" isn't a valid range` };
    const start = parseInt(m[1], 10);
    const endRaw = m[2];
    const end = endRaw === undefined ? start : endRaw === "" ? total : parseInt(endRaw, 10);
    if (start < 1 || end < 1 || start > total || end > total) {
      return { groups: [], error: `"${part}" is out of bounds (1–${total})` };
    }
    if (end < start) return { groups: [], error: `"${part}" goes backwards` };
    const pages: number[] = [];
    for (let i = start; i <= end; i++) pages.push(i);
    groups.push(pages);
  }
  return { groups };
}

export function ToolHeader({
  tag,
  title,
  sub,
  collapsed = false,
}: {
  tag: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto max-w-6xl px-5 md:px-8 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-[10px] uppercase tracking-[0.22em] text-vault shrink-0">
              {tag}
            </span>
            <span className="h-3 w-px bg-border shrink-0" />
            <h1 className="font-display text-sm md:text-base text-foreground truncate">
              {title}
            </h1>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground shrink-0">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3 w-3 text-vault" /> In-browser
            </span>
            <span className="h-3 w-px bg-border" />
            <span className="inline-flex items-center gap-1 normal-case tracking-normal">
              <kbd className="rounded border border-border bg-background/70 px-1 py-px text-[10px] font-mono">{modKey()}</kbd>
              <kbd className="rounded border border-border bg-background/70 px-1 py-px text-[10px] font-mono">Enter</kbd>
              <span className="text-muted-foreground/70">run</span>
            </span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-border">
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-10">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">Tool · {tag}</div>
            <h1 className="font-display text-4xl md:text-5xl leading-tight">{title}</h1>
            <p className="mt-3 text-muted-foreground max-w-2xl">{sub}</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground rounded-md border border-border bg-card/50 px-3 py-2">
            <Lock className="h-3.5 w-3.5 text-vault" /> Processed in your browser
          </div>
        </div>
      </div>
    </div>
  );
}

export function FileBar({
  file,
  info,
  onClose,
  onReplace,
}: {
  file: File;
  info?: string;
  onClose: () => void;
  onReplace?: (f: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc closes the current file
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-vault/10 text-vault shrink-0">
          <FileText className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground">
            {formatSize(file.size)}{info && ` · ${info}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onReplace && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onReplace(f);
                e.target.value = "";
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Replace
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} title="Close (Esc)">
          <X className="h-4 w-4 mr-1" /> Close
        </Button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-2 text-sm border transition ${
        active
          ? "border-vault/60 bg-vault/10 text-foreground"
          : "border-border bg-card/30 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Silence unused import warning
void Download;

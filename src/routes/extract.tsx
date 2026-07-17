import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ToolHeader } from "@/routes/split";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Download,
  FileText,
  Lock,
  Table2,
  X,
  FileSpreadsheet,
  FileJson,
  FileCode,
  ScanLine,
} from "lucide-react";
import {
  downloadXlsx,
  extractTables,
  rowsToCsv,
  type ExtractedTable,
} from "@/lib/pdf/extract-tables";

import { softwareAppSchema } from "@/lib/seo/tool-schema";

export const Route = createFileRoute("/extract")({
  head: () => ({
    meta: [
      { title: "Smart Table Extract — PDFMacro" },
      {
        name: "description",
        content:
          "Pull tables out of PDFs into clean Excel, CSV, or JSON. 100% in your browser, OCR fallback for scans.",
      },
      { property: "og:title", content: "Smart Table Extract — PDFMacro" },
      {
        property: "og:description",
        content:
          "Bank statements, invoices, lab reports — extracted into spreadsheets without uploading anything.",
      },
      { property: "og:url", content: "/extract" },
    ],
    links: [{ rel: "canonical", href: "/extract" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "PDFMacro Smart Table Extract",
            url: "/extract",
            description:
              "Detect tables in PDFs and export to Excel, CSV, or JSON. OCR fallback for scanned pages.",
          }),
        ),
      },
    ],
  }),
  component: ExtractPage,
});

function ExtractPage() {
  const [file, setFile] = useState<File | null>(null);
  const [tables, setTables] = useState<ExtractedTable[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [enabledPages, setEnabledPages] = useState<Set<number>>(new Set());

  const reset = () => {
    setFile(null);
    setTables([]);
    setStatus(null);
    setEnabledPages(new Set());
  };

  const run = useCallback(async (f: File) => {
    setFile(f);
    setTables([]);
    setBusy(true);
    setStatus("Reading PDF locally…");
    try {
      const results = await extractTables(f, 1.5, (p) => {
        setStatus(
          p.stage === "ocr"
            ? `OCR scanning page ${p.page} of ${p.totalPages}…`
            : `Reading page ${p.page} of ${p.totalPages}…`,
        );
      });
      setTables(results);
      setEnabledPages(new Set(results.map((r) => r.page)));
      if (results.length === 0) {
        toast.info("No tabular structure found in this PDF.");
      } else {
        toast.success(
          `Found tables on ${results.length} page${results.length === 1 ? "" : "s"}`,
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read that PDF. Is it password-protected?");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }, []);

  const selectedTables = useMemo(
    () => tables.filter((t) => enabledPages.has(t.page)),
    [tables, enabledPages],
  );

  const baseName = file?.name.replace(/\.pdf$/i, "") || "extract";

  const exportXlsx = async () => {
    if (selectedTables.length === 0) return;
    try {
      await downloadXlsx(selectedTables, `${baseName}.xlsx`);
      toast.success("Excel file saved");
    } catch (err) {
      console.error(err);
      toast.error("Excel export failed");
    }
  };

  const exportCsv = () => {
    if (selectedTables.length === 0) return;
    const parts = selectedTables.map(
      (t) => `# Page ${t.page}\n${rowsToCsv(t.rows)}`,
    );
    downloadBlob(parts.join("\n\n"), `${baseName}.csv`, "text/csv");
  };

  const exportJson = () => {
    if (selectedTables.length === 0) return;
    const json = JSON.stringify(
      selectedTables.map((t) => ({
        page: t.page,
        source: t.source,
        rows: t.rows,
      })),
      null,
      2,
    );
    downloadBlob(json, `${baseName}.json`, "application/json");
  };

  const togglePage = (p: number) => {
    setEnabledPages((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  return (
    <AppShell>
      <ToolHeader
        tag="Smart Table Extract"
        title="Tables out of PDFs. Clean. Instantly."
        sub="Bank statements, invoices, lab reports, SEC filings. Layout-aware detection with on-device OCR fallback for scans. Export to Excel, CSV, or JSON — your file never leaves the tab."
        collapsed={!!file}
      />

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        {!file ? (
          <FileDropzone
            onFile={run}
            label="Drop a PDF to extract tables"
            sublabel="text or scanned · no upload, no page limit"
          />
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-4 w-4 text-vault shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                    {tables.length > 0 &&
                      ` · tables on ${tables.length} page${tables.length === 1 ? "" : "s"}`}
                    {status && ` · ${status}`}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <X className="h-4 w-4 mr-1" /> Close
              </Button>
            </div>

            {busy && tables.length === 0 && (
              <div className="rounded-lg border border-border bg-card/30 p-12 text-center text-sm text-muted-foreground">
                <Table2 className="h-5 w-5 mx-auto mb-2 text-vault" />
                {status ?? "Working…"}
              </div>
            )}

            {tables.length > 0 && (
              <div className="grid lg:grid-cols-[1fr_280px] gap-6 items-start">
                <div className="space-y-8">
                  {tables.map((t) => (
                    <TablePreview
                      key={t.page}
                      table={t}
                      enabled={enabledPages.has(t.page)}
                      onToggle={() => togglePage(t.page)}
                    />
                  ))}
                </div>

                <aside className="lg:sticky lg:top-20 space-y-4">
                  <div className="rounded-lg border border-border bg-card/50 p-5">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                      Export
                    </div>
                    <div className="text-3xl font-display">{selectedTables.length}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      table{selectedTables.length === 1 ? "" : "s"} selected
                    </div>

                    <div className="mt-5 space-y-2">
                      <Button
                        onClick={exportXlsx}
                        disabled={selectedTables.length === 0}
                        className="w-full bg-vault text-vault-foreground hover:opacity-90 justify-start"
                      >
                        <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel (.xlsx)
                      </Button>
                      <Button
                        variant="outline"
                        onClick={exportCsv}
                        disabled={selectedTables.length === 0}
                        className="w-full justify-start"
                      >
                        <FileCode className="h-4 w-4 mr-2" /> CSV
                      </Button>
                      <Button
                        variant="outline"
                        onClick={exportJson}
                        disabled={selectedTables.length === 0}
                        className="w-full justify-start"
                      >
                        <FileJson className="h-4 w-4 mr-2" /> JSON
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
                    <div className="flex items-center gap-2 text-foreground font-medium mb-2">
                      <ScanLine className="h-3.5 w-3.5 text-vault" />
                      How it works
                    </div>
                    Text items are clustered by Y into rows, then by X into columns using gap
                    detection. Scanned pages fall back to on-device OCR. Toggle pages off to
                    exclude them from the export.
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function TablePreview({
  table,
  enabled,
  onToggle,
}: {
  table: ExtractedTable;
  enabled: boolean;
  onToggle: () => void;
}) {
  const cols = table.rows.reduce((m, r) => Math.max(m, r.length), 0);
  return (
    <div
      className={`rounded-lg border bg-card/30 overflow-hidden transition ${
        enabled ? "border-border" : "border-border/40 opacity-50"
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-card/60 text-xs">
        <label className="flex items-center gap-2 cursor-pointer text-xs shrink-0">
          <input
            type="checkbox"
            checked={enabled}
            onChange={onToggle}
            className="accent-vault"
          />
          <span className="text-foreground/90">Include in export</span>
        </label>
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <span className="text-muted-foreground shrink-0">Page {table.page}</span>
          <span className="text-muted-foreground shrink-0 hidden sm:inline">
            · {table.rows.length} row{table.rows.length === 1 ? "" : "s"} × {cols} col
            {cols === 1 ? "" : "s"}
          </span>
          {table.source === "ocr" && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-vault/15 text-vault text-[10px] uppercase tracking-wider shrink-0">
              <ScanLine className="h-3 w-3" /> OCR
            </span>
          )}
        </div>
      </div>
      <div
        className="overflow-x-auto max-h-[420px]"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "oklch(0.30 0.025 260) transparent",
        }}
      >
        <table className="w-full text-xs" style={{ tableLayout: "auto" }}>
          <tbody>
            {table.rows.slice(0, 200).map((row, ri) => (
              <tr
                key={ri}
                className={ri === 0 ? "bg-vault/5 font-medium" : "border-t border-border/60"}
              >
                {Array.from({ length: cols }).map((_, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-1.5 align-top text-foreground/90 break-words min-w-[6rem] max-w-[24rem]"
                  >
                    {row[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.rows.length > 200 && (
          <div className="text-[11px] text-muted-foreground px-3 py-2 border-t border-border">
            Showing first 200 of {table.rows.length} rows. Full table is in the export.
          </div>
        )}
      </div>
    </div>
  );
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

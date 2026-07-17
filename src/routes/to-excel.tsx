import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { Table2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { extractTables, downloadXlsx, type ExtractedTable, type ExtractProgress } from "@/lib/pdf/extract-tables";

export const Route = createFileRoute("/to-excel")({
  head: () => ({
    meta: [
      { title: "PDF to Excel — Extract Tables Locally · CounselPDF" },
      { name: "description", content: "Pull tables from any PDF into an editable .xlsx — heuristic layout detection with OCR fallback. 100% on-device." },
      { property: "og:title", content: "PDF → Excel — in your browser" },
      { property: "og:description", content: "Tables to .xlsx, no upload, no account." },
    ],
    links: [{ rel: "canonical", href: "/to-excel" }],
  }),
  component: ToExcelPage,
});

function ToExcelPage() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [tables, setTables] = useState<ExtractedTable[] | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setTables(null);
    try {
      const result = await extractTables(file, 1.5, (p) => setProgress(p));
      setTables(result);
      if (result.length === 0) {
        toast.warning("No tables detected in this PDF.");
      } else {
        toast.success(`Found ${result.length} table${result.length === 1 ? "" : "s"}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Extraction failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function download() {
    if (!tables || !file) return;
    await downloadXlsx(tables, file.name.replace(/\.pdf$/i, "") + ".xlsx");
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl px-5 md:px-8 py-12 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-vault/80 font-mono">
            <Table2 className="h-3 w-3" /> PDF → Excel
          </div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground leading-tight">
            Lift tables out of PDFs — into editable spreadsheets.
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Position-based clustering finds rows and columns. Falls back to on-device OCR for scanned pages.
          </p>
        </header>

        {!file ? (
          <FileDropzone onFile={(f) => { setFile(f); setTables(null); }} label="Drop a PDF" sublabel="invoices, statements, lab reports, SEC filings" />
        ) : (
          <div className="rounded-lg border border-border bg-card/40 p-5 flex items-center justify-between">
            <span className="font-mono text-sm truncate">{file.name}</span>
            <button onClick={() => { setFile(null); setTables(null); }} className="text-xs uppercase tracking-wider text-muted-foreground hover:text-evidence">Change</button>
          </div>
        )}

        {file && !tables && (
          <Button onClick={run} disabled={busy} className="w-full h-11 bg-vault text-vault-foreground hover:opacity-90">
            {busy ? (
              <span className="inline-flex items-center"><Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {progress ? `Scanning page ${progress.page} of ${progress.totalPages} · ${progress.stage.toUpperCase()}` : "Extracting…"}
              </span>
            ) : "Extract tables"}
          </Button>
        )}

        {tables && tables.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                {tables.length} table{tables.length === 1 ? "" : "s"} detected
              </div>
              <Button onClick={download} className="bg-vault text-vault-foreground hover:opacity-90">
                <Download className="h-4 w-4 mr-2" />
                Download .xlsx
              </Button>
            </div>
            <div className="space-y-6">
              {tables.map((t, idx) => (
                <div key={idx} className="rounded-lg border border-border bg-card/30 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-whisper text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono">
                    <span>Page {t.page} · {t.rows.length} rows × {t.rows[0]?.length ?? 0} cols</span>
                    <span className={t.source === "ocr" ? "text-evidence" : "text-vault"}>{t.source}</span>
                  </div>
                  <div className="overflow-x-auto max-h-72">
                    <table className="min-w-full text-xs">
                      <tbody>
                        {t.rows.slice(0, 50).map((row, ri) => (
                          <tr key={ri} className={ri === 0 ? "bg-canvas/60 font-medium" : ""}>
                            {row.map((cell, ci) => (
                              <td key={ci} className="border border-whisper/40 px-2 py-1 font-mono whitespace-nowrap">{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {t.rows.length > 50 && (
                      <div className="px-4 py-2 text-xs text-muted-foreground font-mono">
                        … {t.rows.length - 50} more rows in download
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Lock, ScanSearch, AlertTriangle, FileText } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { ToolHeader, FileBar, downloadBlob } from "@/routes/split";
import { getPdfjs } from "@/lib/pdf/worker";
import { findKeywordInPdf, type KeywordMatch } from "@/lib/pdf/detect-pii";

export const Route = createFileRoute("/privilege-scan")({
  head: () => ({
    meta: [
      { title: "Privilege Scan — VaultPDF" },
      {
        name: "description",
        content:
          "Scan a PDF for attorney–client, work product, and other privileged language before production. 100% in your browser.",
      },
      { property: "og:title", content: "Privilege Scan — VaultPDF" },
      {
        property: "og:description",
        content: "Catch privileged language before it leaves your office. Local text scan, optional highlight export.",
      },
      { property: "og:url", content: "/privilege-scan" },
    ],
    links: [{ rel: "canonical", href: "/privilege-scan" }],
  }),
  component: PrivilegeScanPage,
});

const DEFAULT_TERMS = [
  "attorney-client",
  "attorney client",
  "work product",
  "attorney work product",
  "privileged and confidential",
  "privileged",
  "confidential settlement",
  "subject to common interest",
  "joint defense",
  "do not disclose",
];

type Finding = { term: string; matches: KeywordMatch[] };

function PrivilegeScanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [termsRaw, setTermsRaw] = useState(DEFAULT_TERMS.join("\n"));
  const [scanning, setScanning] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [highlighting, setHighlighting] = useState(false);

  const terms = useMemo(
    () => termsRaw.split("\n").map((s) => s.trim()).filter(Boolean),
    [termsRaw],
  );

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setFindings(null);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      setPageCount(doc.getPageCount());
    } catch {
      toast.error("Couldn't open that PDF.");
      setFile(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setFindings(null);
  };

  const totalMatches = findings?.reduce((n, f) => n + f.matches.length, 0) ?? 0;

  const scan = async () => {
    if (!file || terms.length === 0) return;
    setScanning(true);
    setFindings(null);
    try {
      const results: Finding[] = [];
      for (const term of terms) {
        const matches = await findKeywordInPdf(file, term, { matchCase: false });
        if (matches.length > 0) results.push({ term, matches });
      }
      setFindings(results);
      if (results.length === 0) {
        toast.success("Clean — no privileged terms found.");
      } else {
        toast.warning(`${results.reduce((n, r) => n + r.matches.length, 0)} hits across ${results.length} term${results.length === 1 ? "" : "s"}`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Scan failed — is this a text PDF? Run OCR first for scans.");
    } finally {
      setScanning(false);
    }
  };

  const exportHighlighted = async () => {
    if (!file || !findings || findings.length === 0) return;
    setHighlighting(true);
    try {
      const pdfjs = await getPdfjs();
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const out = await PDFDocument.create();
      const SCALE = 1.5;

      // Group matches by page
      const byPage = new Map<number, KeywordMatch[]>();
      for (const f of findings) {
        for (const m of f.matches) {
          const arr = byPage.get(m.page) ?? [];
          arr.push(m);
          byPage.set(m.page, arr);
        }
      }

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;

        // Yellow highlights over matches
        const matches = byPage.get(i) ?? [];
        ctx.fillStyle = "rgba(255, 230, 0, 0.42)";
        for (const m of matches) {
          ctx.fillRect(m.x, m.y, m.w, m.h);
        }

        const jpegBytes = await new Promise<Uint8Array>((resolve, reject) => {
          canvas.toBlob(
            (b) => {
              if (!b) return reject(new Error("toBlob failed"));
              b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)));
            },
            "image/jpeg",
            0.9,
          );
        });
        const embedded = await out.embedJpg(jpegBytes);
        const p = out.addPage([canvas.width, canvas.height]);
        p.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      }

      const bytes = await out.save();
      const ab = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(ab).set(bytes);
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(new Blob([ab], { type: "application/pdf" }), `${base}-privilege-highlights.pdf`);
      toast.success("Highlighted PDF saved");
    } catch (err) {
      console.error(err);
      toast.error("Highlight export failed");
    } finally {
      setHighlighting(false);
    }
  };

  return (
    <AppShell>
      <ToolHeader
        tag="Privilege Scan"
        title="Catch privileged language before it leaves."
        sub="Scan a PDF's text layer for attorney–client, work product, and other tells. Optional yellow-highlight export."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to scan" sublabel="text PDFs only — run OCR first for scans" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} info={`${pageCount} page${pageCount === 1 ? "" : "s"}`} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Terms to look for (one per line)
                </label>
                <textarea
                  value={termsRaw}
                  onChange={(e) => setTermsRaw(e.target.value)}
                  rows={6}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {terms.length} term{terms.length === 1 ? "" : "s"} · case-insensitive substring match
                </div>
              </div>

              <Button
                onClick={scan}
                disabled={scanning || terms.length === 0}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full"
              >
                {scanning ? "Scanning…" : (
                  <>
                    <ScanSearch className="h-4 w-4 mr-2" /> Scan for privileged language
                  </>
                )}
              </Button>
            </div>

            {findings && (
              <div className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    {findings.length === 0 ? (
                      <span className="text-sm text-vault">No privileged terms found.</span>
                    ) : (
                      <>
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <span className="text-sm">
                          <span className="font-medium">{totalMatches}</span> match{totalMatches === 1 ? "" : "es"} across{" "}
                          <span className="font-medium">{findings.length}</span> term{findings.length === 1 ? "" : "s"}.
                        </span>
                      </>
                    )}
                  </div>
                  {findings.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={exportHighlighted}
                      disabled={highlighting}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      {highlighting ? "Building…" : "Download highlighted PDF"}
                    </Button>
                  )}
                </div>

                {findings.length > 0 && (
                  <div className="divide-y divide-border">
                    {findings.map((f) => (
                      <div key={f.term} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono text-sm">{f.term}</div>
                          <div className="text-xs text-muted-foreground">
                            {f.matches.length} hit{f.matches.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {f.matches.slice(0, 8).map((m) => (
                            <li key={m.id} className="flex gap-2">
                              <span className="font-mono shrink-0 text-vault">p.{m.page}</span>
                              <span className="truncate">&ldquo;{m.snippet}&rdquo;</span>
                            </li>
                          ))}
                          {f.matches.length > 8 && (
                            <li className="text-[11px] italic">…and {f.matches.length - 8} more</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Lock className="h-3 w-3 text-vault" /> Text extraction runs in this tab. Nothing is uploaded.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

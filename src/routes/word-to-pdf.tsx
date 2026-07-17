import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { convertWordToPdfBlob, type WordToPdfPageSize } from "@/lib/pdf/word-to-pdf";

export const Route = createFileRoute("/word-to-pdf")({
  head: () => ({
    meta: [
      { title: "Word to PDF — Convert DOCX to PDF — CounselPDF" },
      {
        name: "description",
        content:
          "Convert Word (.docx) documents to PDF entirely in your browser. Preserves headings, lists, tables and images — nothing uploaded.",
      },
      { property: "og:title", content: "Word to PDF — CounselPDF" },
      {
        property: "og:description",
        content: "Local DOCX → PDF conversion. No upload, ever.",
      },
      { property: "og:url", content: "/word-to-pdf" },
    ],
    links: [{ rel: "canonical", href: "/word-to-pdf" }],
  }),
  component: WordToPdfPage,
});

type PageSize = WordToPdfPageSize;
const PAGE_SIZES: Record<PageSize, { label: string }> = {
  letter: { label: "US Letter" },
  a4: { label: "A4" },
};

function WordToPdfPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>("letter");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const onFile = useCallback((f: File) => {
    if (!/\.docx$/i.test(f.name)) {
      toast.error("Only .docx files are supported. Convert .doc to .docx first.");
      return;
    }
    setFile(f);
  }, []);

  const reset = () => {
    setFile(null);
    setProgress("");
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setProgress("Reading document…");
    try {
      const { blob, pages } = await convertWordToPdfBlob(file, {
        pageSize,
        onProgress: setProgress,
      });
      const base = file.name.replace(/\.docx$/i, "");
      downloadBlob(blob, `${base}.pdf`);
      toast.success(`Converted ${pages} page${pages === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Conversion failed. Complex documents may not convert cleanly.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Word → PDF"
        title="Convert .docx documents to PDF."
        sub="Renders the document locally and exports a clean PDF. Headings, lists, tables and images preserved."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone
            onFile={onFile}
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            label="Drop a .docx file"
            sublabel="no upload"
          />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Page size</div>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={pageSize === "letter"} onClick={() => setPageSize("letter")}>
                    US Letter
                  </ModeBtn>
                  <ModeBtn active={pageSize === "a4"} onClick={() => setPageSize("a4")}>
                    A4
                  </ModeBtn>
                </div>
              </div>

              {busy && (
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] text-muted-foreground">
                  {progress || "Working…"}
                </div>
              )}

              <Button
                onClick={run}
                disabled={busy}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11"
              >
                <FileText className="h-4 w-4 mr-2" />
                {busy ? "Converting…" : "Convert & download PDF"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Converted in your browser. Nothing uploaded.
              </div>
              <div className="text-center text-[10px] text-muted-foreground/70 uppercase tracking-[0.18em]">
                Best for typical text documents. Complex Word layouts may shift.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

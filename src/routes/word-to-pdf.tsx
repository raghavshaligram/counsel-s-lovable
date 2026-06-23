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
      { title: "Word to PDF — Convert DOCX to PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Convert Word (.docx) documents to PDF entirely in your browser. Preserves headings, lists, tables and images — nothing uploaded.",
      },
      { property: "og:title", content: "Word to PDF — VaultPDF" },
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
      const mammoth: any = await import("mammoth/mammoth.browser.js" as any);
      const arr = await file.arrayBuffer();
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer: arr });

      setProgress("Rendering pages…");
      const { w: pw, h: ph } = PAGE_SIZES[pageSize];
      // Render at higher DPI for crisp text. 1pt = 1/72in; render at ~2x.
      const SCALE = 2;
      const pxWidth = Math.round(pw * (96 / 72)); // CSS px for an A4/Letter page
      const margin = 48; // pt margin in our CSS layout
      const contentPxWidth = pxWidth - margin * 2;

      // Build an offscreen container
      const host = document.createElement("div");
      host.style.cssText = [
        "position:fixed",
        "left:-99999px",
        "top:0",
        `width:${contentPxWidth}px`,
        "padding:0",
        "margin:0",
        "background:#ffffff",
        "color:#111111",
        "font-family: 'Helvetica Neue', Arial, sans-serif",
        "font-size:12pt",
        "line-height:1.45",
        "box-sizing:content-box",
      ].join(";");
      host.innerHTML = `
        <style>
          .vpdf-root h1{font-size:22pt;font-weight:700;margin:0 0 10pt}
          .vpdf-root h2{font-size:17pt;font-weight:700;margin:14pt 0 8pt}
          .vpdf-root h3{font-size:13pt;font-weight:700;margin:12pt 0 6pt}
          .vpdf-root p{margin:0 0 8pt}
          .vpdf-root ul,.vpdf-root ol{margin:0 0 8pt 20pt;padding:0}
          .vpdf-root li{margin:0 0 4pt}
          .vpdf-root table{border-collapse:collapse;width:100%;margin:8pt 0;font-size:11pt}
          .vpdf-root td,.vpdf-root th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}
          .vpdf-root img{max-width:100%;height:auto;display:block;margin:6pt 0}
          .vpdf-root a{color:#0a58ca;text-decoration:underline}
          .vpdf-root strong{font-weight:700}
          .vpdf-root em{font-style:italic}
          .vpdf-root blockquote{border-left:3pt solid #ccc;padding:0 10pt;margin:8pt 0;color:#444}
          .vpdf-root pre{background:#f5f5f5;padding:8pt;font-family:monospace;font-size:10pt;white-space:pre-wrap}
        </style>
        <div class="vpdf-root">${html || "<p><em>(empty document)</em></p>"}</div>
      `;
      document.body.appendChild(host);
      const root = host.querySelector(".vpdf-root") as HTMLElement;

      // Slice the rendered HTML into page-height chunks by walking top-level blocks.
      // Page content height in CSS px:
      const contentPxHeight = Math.round(ph * (96 / 72)) - margin * 2;

      const blocks = Array.from(root.children) as HTMLElement[];
      const pageDivs: HTMLElement[] = [];
      let current = document.createElement("div");
      current.className = "vpdf-page";
      current.style.cssText = `width:${contentPxWidth}px;`;
      let currentHeight = 0;
      const makePage = () => {
        if (current.childNodes.length > 0) pageDivs.push(current);
        current = document.createElement("div");
        current.className = "vpdf-page";
        current.style.cssText = `width:${contentPxWidth}px;`;
        currentHeight = 0;
      };

      // Move each block into the offscreen host, measure, and pack into pages.
      const packHost = document.createElement("div");
      packHost.style.cssText = host.style.cssText;
      packHost.innerHTML = host.querySelector("style")!.outerHTML + `<div class="vpdf-root"></div>`;
      document.body.appendChild(packHost);
      const packRoot = packHost.querySelector(".vpdf-root") as HTMLElement;

      for (const block of blocks) {
        packRoot.appendChild(block);
        const h = block.getBoundingClientRect().height;
        packRoot.removeChild(block);

        if (h > contentPxHeight) {
          // Too tall — accept overflow on its own page.
          if (currentHeight > 0) makePage();
          current.appendChild(block);
          makePage();
          continue;
        }
        if (currentHeight + h > contentPxHeight) makePage();
        current.appendChild(block);
        currentHeight += h;
      }
      makePage();
      packHost.remove();

      // Render each page div with html2canvas-pro
      const html2canvas = (await import("html2canvas-pro")).default;
      const pdf = await PDFDocument.create();

      for (let i = 0; i < pageDivs.length; i++) {
        setProgress(`Rendering page ${i + 1} of ${pageDivs.length}…`);
        const pageWrap = document.createElement("div");
        pageWrap.style.cssText = [
          "position:fixed",
          "left:-99999px",
          "top:0",
          `width:${pxWidth}px`,
          `height:${Math.round(ph * (96 / 72))}px`,
          `padding:${margin}px`,
          "background:#ffffff",
          "color:#111111",
          "font-family: 'Helvetica Neue', Arial, sans-serif",
          "font-size:12pt",
          "line-height:1.45",
          "box-sizing:border-box",
        ].join(";");
        pageWrap.innerHTML = host.querySelector("style")!.outerHTML;
        const wrapRoot = document.createElement("div");
        wrapRoot.className = "vpdf-root";
        wrapRoot.appendChild(pageDivs[i]);
        pageWrap.appendChild(wrapRoot);
        document.body.appendChild(pageWrap);

        const canvas = await html2canvas(pageWrap, {
          scale: SCALE,
          backgroundColor: "#ffffff",
          logging: false,
          useCORS: true,
        });
        pageWrap.remove();

        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const jpgBytes = await (await fetch(dataUrl)).arrayBuffer();
        const img = await pdf.embedJpg(jpgBytes);
        const page = pdf.addPage([pw, ph]);
        page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
      }

      host.remove();
      setProgress("Finalizing…");
      const bytes = await pdf.save();
      const base = file.name.replace(/\.docx$/i, "");
      downloadBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${base}.pdf`,
      );
      toast.success(`Converted ${pageDivs.length} page${pageDivs.length === 1 ? "" : "s"}`);
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

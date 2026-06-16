import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCw, RotateCcw } from "lucide-react";
import { FileBar, ModeBtn, ToolHeader } from "@/routes/split";
import { downloadBlob } from "@/lib/pdf/split";
import {
  getRotatePageCount,
  rotatePdf,
  type RotateAngle,
  type RotateScope,
} from "@/lib/pdf/rotate";
import { useHotkey } from "@/lib/use-hotkey";

export const Route = createFileRoute("/rotate")({
  head: () => ({
    meta: [
      { title: "Rotate PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Rotate all pages or specific page ranges by 90, 180, or 270 degrees. Fully client-side, no upload.",
      },
      { property: "og:title", content: "Rotate PDF — VaultPDF" },
      {
        property: "og:description",
        content: "Rotate pages instantly, in your browser. No upload.",
      },
      { property: "og:url", content: "/rotate" },
    ],
    links: [{ rel: "canonical", href: "/rotate" }],
  }),
  component: RotatePage,
});

type Scope = RotateScope;

function RotatePage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [angle, setAngle] = useState<RotateAngle>(90);
  const [scope, setScope] = useState<Scope>("all");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setPageCount(0);
      return;
    }
    (async () => {
      try {
        const n = await getRotatePageCount(file);
        if (!cancelled) setPageCount(n);
      } catch {
        if (!cancelled) {
          toast.error("Couldn't open that PDF.");
          setPageCount(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const onFile = useCallback((f: File) => {
    setFile(f);
  }, []);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await rotatePdf(file, { angle, scope, custom });
      downloadBlob(result.blob, result.filename);
      toast.success(
        `Rotated ${result.rotatedCount} page${result.rotatedCount === 1 ? "" : "s"}`,
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Rotate failed");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);


  return (
    <AppShell>
      <ToolHeader
        tag="Rotate"
        title="Rotate pages. All or some."
        sub="Fix sideways scans or upside-down pages in seconds. Choose all, odd, even, or specific page numbers."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to rotate" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar
              file={file}
              info={`${pageCount} page${pageCount === 1 ? "" : "s"}`}
              onClose={() => setFile(null)}
              onReplace={onFile}
            />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Angle
                </div>
                <div className="flex gap-2">
                  {([90, 180, 270] as const).map((a) => (
                    <ModeBtn key={a} active={angle === a} onClick={() => setAngle(a)}>
                      <span className="inline-flex items-center gap-1.5 justify-center">
                        {a === 270 ? <RotateCcw className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
                        {a}°
                      </span>
                    </ModeBtn>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Pages
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <ModeBtn active={scope === "all"} onClick={() => setScope("all")}>All</ModeBtn>
                  <ModeBtn active={scope === "odd"} onClick={() => setScope("odd")}>Odd</ModeBtn>
                  <ModeBtn active={scope === "even"} onClick={() => setScope("even")}>Even</ModeBtn>
                  <ModeBtn active={scope === "custom"} onClick={() => setScope("custom")}>Custom</ModeBtn>
                </div>
                {scope === "custom" && (
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="e.g. 1-3, 5, 8-10"
                    className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                )}
              </div>

              <Button onClick={run} disabled={busy} className="bg-vault text-vault-foreground hover:opacity-90 w-full">
                {busy ? "Rotating…" : "Rotate & download"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}


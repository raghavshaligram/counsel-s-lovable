import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCw, RotateCcw, Download } from "lucide-react";
import { PDFDocument, degrees } from "pdf-lib";
import { FileBar, ModeBtn, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { useActiveFile, useWorkspace } from "@/lib/workspace/store";

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

type Scope = "all" | "odd" | "even" | "custom";
type OutputMode = "replace" | "add";

function RotatePage() {
  const active = useActiveFile();
  const addFile = useWorkspace((s) => s.addFile);
  const replaceFileBytes = useWorkspace((s) => s.replaceFileBytes);
  const addDerivedFile = useWorkspace((s) => s.addDerivedFile);
  const recordOp = useWorkspace((s) => s.recordOp);

  const [pageCount, setPageCount] = useState(0);
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [scope, setScope] = useState<Scope>("all");
  const [custom, setCustom] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("add");
  const [busy, setBusy] = useState(false);

  // Refresh page count when the active file changes.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setPageCount(0);
      return;
    }
    (async () => {
      try {
        const doc = await PDFDocument.load(await active.blob.arrayBuffer(), {
          ignoreEncryption: true,
        });
        if (!cancelled) setPageCount(doc.getPageCount());
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
  }, [active]);

  const onFile = useCallback(
    async (f: File) => {
      await addFile(f);
    },
    [addFile],
  );

  const run = async () => {
    if (!active) return;
    setBusy(true);
    try {
      const srcBytes = new Uint8Array(await active.blob.arrayBuffer());
      const doc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
      const targets = resolveScope(scope, custom, doc.getPageCount());
      if (targets.error) {
        toast.error(targets.error);
        return;
      }
      const set = new Set(targets.indices);
      doc.getPages().forEach((p, i) => {
        if (set.has(i)) {
          const current = p.getRotation().angle ?? 0;
          p.setRotation(degrees((current + angle) % 360));
        }
      });
      const bytes = await doc.save();
      const base = active.name.replace(/\.pdf$/i, "");
      const outName = `${base}-rotated.pdf`;

      if (outputMode === "replace") {
        // Snapshot pre-op bytes for undo (only persisted when persistence is on).
        await recordOp(active.id, "rotate", srcBytes, {
          label: `Rotated ${set.size}p · ${angle}°`,
        });
        await replaceFileBytes(active.id, bytes, outName);
        toast.success(`Rotated ${set.size} page${set.size === 1 ? "" : "s"} (in place)`);
      } else {
        await addDerivedFile(active.id, bytes, outName, "rotate");
        toast.success(`Rotated ${set.size} page${set.size === 1 ? "" : "s"} (new file)`);
      }
    } catch (err) {
      console.error(err);
      toast.error("Rotate failed");
    } finally {
      setBusy(false);
    }
  };

  const downloadCurrent = () => {
    if (!active) return;
    downloadBlob(active.blob, active.name);
  };

  useHotkey("mod+Enter", () => { void run(); }, !!active && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Rotate"
        title="Rotate pages. All or some."
        sub="Fix sideways scans or upside-down pages in seconds. Choose all, odd, even, or specific page numbers."
        collapsed={!!active}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${active ? "max-w-5xl" : "max-w-3xl"}`}>
        {!active ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to rotate" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar
              file={asFile(active.blob, active.name)}
              info={`${pageCount} page${pageCount === 1 ? "" : "s"}`}
              onClose={() => void useWorkspace.getState().removeFile(active.id)}
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

              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Output
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <ModeBtn active={outputMode === "add"} onClick={() => setOutputMode("add")}>
                    Add to workspace
                  </ModeBtn>
                  <ModeBtn active={outputMode === "replace"} onClick={() => setOutputMode("replace")}>
                    Replace in place
                  </ModeBtn>
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {outputMode === "add"
                    ? "Keeps the original file alongside the rotated copy."
                    : "Updates the active file. Undo is available from the workspace rail."}
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={run} disabled={busy} className="bg-vault text-vault-foreground hover:opacity-90 flex-1">
                  {busy ? "Rotating…" : "Rotate"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadCurrent}
                  className="shrink-0"
                  title="Download current file"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/** FileBar expects a File — wrap the workspace Blob to keep the existing API. */
function asFile(blob: Blob, name: string): File {
  if (blob instanceof File && blob.name === name) return blob;
  return new File([blob], name, { type: blob.type || "application/pdf" });
}

function resolveScope(scope: Scope, custom: string, total: number): { indices: number[]; error?: string } {
  if (scope === "all") return { indices: Array.from({ length: total }, (_, i) => i) };
  if (scope === "odd")
    return { indices: Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 1) };
  if (scope === "even")
    return { indices: Array.from({ length: total }, (_, i) => i).filter((i) => (i + 1) % 2 === 0) };
  const out = new Set<number>();
  for (const part of custom.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return { indices: [], error: `"${part}" isn't valid` };
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end > total || end < start)
      return { indices: [], error: `"${part}" is out of bounds (1–${total})` };
    for (let i = start; i <= end; i++) out.add(i - 1);
  }
  if (out.size === 0) return { indices: [], error: "Enter at least one page" };
  return { indices: [...out] };
}

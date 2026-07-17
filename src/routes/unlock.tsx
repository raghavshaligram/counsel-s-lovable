import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, LockOpen, ShieldOff } from "lucide-react";
import { FileBar, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import { importChunk } from "@/lib/chunk-import";

export const Route = createFileRoute("/unlock")({
  head: () => ({
    meta: [
      { title: "Unlock PDF — Remove Password — PDFMacro" },
      {
        name: "description",
        content:
          "Remove a password from a PDF you own. Decryption happens entirely in your browser — the password is never transmitted.",
      },
      { property: "og:title", content: "Unlock PDF — PDFMacro" },
      {
        property: "og:description",
        content: "Strip the password from a PDF you have permission to open. 100% local.",
      },
      { property: "og:url", content: "/unlock" },
    ],
    links: [{ rel: "canonical", href: "/unlock" }],
  }),
  component: UnlockPage,
});

function UnlockPage() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setPassword("");
    setNeedsPassword(false);
    try {
      const { PDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
      // Try loading without password — if encrypted, this throws
      await PDFDocument.load(await f.arrayBuffer());
    } catch {
      // Probably encrypted — that's fine, prompt for password
      setNeedsPassword(true);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPassword("");
    setNeedsPassword(false);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { PDFDocument } = await importChunk(() => import("@cantoo/pdf-lib"));
      let src;
      try {
        src = await PDFDocument.load(await file.arrayBuffer(), {
          password: password || undefined,
        } as any);
      } catch (err: any) {
        if (/password/i.test(String(err?.message ?? err))) {
          toast.error("Wrong password. Try again.");
        } else {
          toast.error("Couldn't open that PDF.");
        }
        return;
      }

      // Rebuild without encryption by copying pages into a fresh document.
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${base}-unlocked.pdf`,
      );
      toast.success("Unlocked PDF downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Unlock failed");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);

  return (
    <AppShell>
      <ToolHeader
        tag="Unlock"
        title="Remove the password from a PDF you own."
        sub="Decryption runs locally. Your password is never uploaded — we couldn't even if we wanted to."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop an encrypted PDF" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar file={file} onClose={reset} onReplace={onFile} />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
              {needsPassword ? (
                <>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Open password
                  </div>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter the PDF password"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void run();
                        }
                      }}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-background/40 px-3 py-2.5 text-[12px] text-muted-foreground">
                  <ShieldOff className="h-4 w-4 mt-0.5 text-vault shrink-0" />
                  <div>
                    This PDF isn't password-protected — we'll just re-save a clean copy.
                  </div>
                </div>
              )}

              <Button
                onClick={run}
                disabled={busy || (needsPassword && !password)}
                className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11"
              >
                <LockOpen className="h-4 w-4 mr-2" />
                {busy ? "Unlocking…" : "Unlock & download"}
              </Button>
              <div className="text-center text-[11px] text-muted-foreground">
                🔒 Decrypted in your browser. Your password is never transmitted.
              </div>
              <div className="text-center text-[10px] text-muted-foreground/70 uppercase tracking-[0.18em]">
                Only unlock PDFs you have permission to open.
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

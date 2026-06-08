import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FileText, Lock, Search, X, Loader2, Zap, Sparkles } from "lucide-react";
import { softwareAppSchema } from "@/lib/seo/tool-schema";
import { extractPdfChunks, type PdfChunk } from "@/lib/chat/pdf-extract";
import { buildIndex, search, type Bm25Index, type SearchHit } from "@/lib/chat/bm25";
import { InstantAnswer } from "@/components/chat/InstantAnswer";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Search inside any PDF — Instant, Private, Offline · VaultPDF" },
      {
        name: "description",
        content:
          "Drop a PDF and search its contents instantly. Top-matching passages with page numbers — no upload, no account, no waiting.",
      },
      { property: "og:title", content: "Search inside a PDF — 100% in your browser" },
      {
        property: "og:description",
        content: "Instant local PDF search with page citations. Nothing leaves your tab.",
      },
      { property: "og:url", content: "/chat" },
    ],
    links: [{ rel: "canonical", href: "/chat" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "VaultPDF PDF Search",
            url: "/chat",
            description:
              "Instant browser-local PDF search with page citations. Files and queries never leave the tab.",
          }),
        ),
      },
    ],
  }),
  component: ChatPage,
});

interface Turn {
  id: string;
  question: string;
  hits: SearchHit[];
}

function ChatPage() {
  const [file, setFile] = useState<File | null>(null);
  const [, setChunks] = useState<PdfChunk[]>([]);
  const [index, setIndex] = useState<Bm25Index | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const onPdf = useCallback(async (f: File) => {
    setFile(f);
    setTurns([]);
    setExtracting(true);
    setExtractStatus("Reading PDF locally…");
    try {
      const cks = await extractPdfChunks(f, 1200, 150, (p, t) => {
        setExtractStatus(`Indexing page ${p} of ${t}…`);
      });
      if (cks.length === 0) {
        toast.error("No extractable text in this PDF. Scanned PDFs need OCR first.");
        setFile(null);
        return;
      }
      setChunks(cks);
      setChunkCount(cks.length);
      setIndex(buildIndex(cks));
      toast.success(`Indexed ${cks.length} passage${cks.length === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read that PDF.");
      setFile(null);
    } finally {
      setExtracting(false);
      setExtractStatus(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setChunks([]);
    setChunkCount(0);
    setIndex(null);
    setTurns([]);
  };

  const ask = useCallback(() => {
    const q = input.trim();
    if (!q || !index) return;
    setInput("");
    const hits = search(index, q, 4);
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), question: q, hits }]);
  }, [input, index]);

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">
                Tool · Search inside PDF <span className="ml-2 text-muted-foreground">Beta</span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl leading-tight">
                Find anything in your PDF.
                <br />
                <span className="text-vault italic">Instantly. Privately.</span>
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Drop a PDF, type a question, get the exact passages with page numbers in under
                50&nbsp;ms. No upload, no account, no AI download. Your file never leaves this tab.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground rounded-md border border-border bg-card/50 px-3 py-2">
              <Lock className="h-3.5 w-3.5 text-vault" />
              No upload · No API key
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
          <div className="space-y-4">
            {!file ? (
              <FileDropzone
                onFile={onPdf}
                label="Drop a PDF to search"
                sublabel="text-based PDFs · indexed locally · no download required"
              />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/50 px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="h-4 w-4 text-vault shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(1)} KB
                        {chunkCount > 0 && ` · ${chunkCount} passages indexed`}
                        {extractStatus && ` · ${extractStatus}`}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <X className="h-4 w-4 mr-1" /> Switch PDF
                  </Button>
                </div>

                {extracting && (
                  <div className="rounded-lg border border-border bg-card/30 p-8 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-5 w-5 mx-auto mb-2 text-vault animate-spin" />
                    {extractStatus ?? "Working…"}
                  </div>
                )}

                {!extracting && index && (
                  <div className="rounded-xl border border-border bg-card/30 flex flex-col h-[65vh] min-h-[460px]">
                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-6">
                      {turns.length === 0 ? (
                        <EmptyChat />
                      ) : (
                        turns.map((t) => (
                          <div key={t.id} className="space-y-3">
                            <div className="flex justify-end">
                              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-vault text-vault-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
                                {t.question}
                              </div>
                            </div>
                            <InstantAnswer hits={t.hits} query={t.question} />
                          </div>
                        ))
                      )}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        ask();
                      }}
                      className="border-t border-border p-3 flex items-center gap-2"
                    >
                      <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Search this PDF…"
                        className="flex-1 bg-transparent text-sm px-3 py-2 outline-none placeholder:text-muted-foreground/70"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!input.trim()}
                        className="bg-vault text-vault-foreground hover:opacity-90"
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="lg:sticky lg:top-20 space-y-4">
            <div className="rounded-lg border border-border bg-card/50 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-vault" /> Instant mode
              </div>
              <div className="text-sm">
                Top-matching passages from your PDF appear in under 50&nbsp;ms. Zero download, zero
                network, zero cost.
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/30 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" /> AI summaries
              </div>
              <div className="text-sm text-muted-foreground">
                On-device AI written answers are in development. For now, the instant passage
                results cover most "find the part that talks about X" questions.
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium mb-2">How it works</div>
              The PDF is parsed and indexed with BM25 inside your browser. Each query retrieves the
              top passages with page citations — instantly. Nothing is uploaded.
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function EmptyChat() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-12">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-vault/10 text-vault mb-3">
        <Zap className="h-4 w-4" />
      </div>
      <div className="text-foreground font-medium">Your PDF is indexed.</div>
      <div className="mt-1 max-w-sm">
        Try: <span className="text-foreground">"key findings"</span>,{" "}
        <span className="text-foreground">"payment terms"</span>, or{" "}
        <span className="text-foreground">"who is liable"</span>.
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText,
  Lock,
  Send,
  X,
  Sparkles,
  AlertTriangle,
  Loader2,
  Cpu,
  Zap,
} from "lucide-react";
import { softwareAppSchema } from "@/lib/seo/tool-schema";
import { extractPdfChunks, type PdfChunk } from "@/lib/chat/pdf-extract";
import { buildIndex, search, type Bm25Index, type SearchHit } from "@/lib/chat/bm25";
import { detectRuntime, type ChatRuntime } from "@/lib/chat/runtime-detect";
import { InstantAnswer } from "@/components/chat/InstantAnswer";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat with PDF in your browser — Free, Private, Offline · VaultPDF" },
      {
        name: "description",
        content:
          "Ask questions about any PDF. Instant answers from the document itself — no upload, no API key, no download required. Optional AI summary runs locally.",
      },
      { property: "og:title", content: "Chat with PDF — 100% in your browser" },
      {
        property: "og:description",
        content:
          "Instant local PDF search with page citations. Optional on-device LLM for written answers.",
      },
      { property: "og:url", content: "/chat" },
    ],
    links: [{ rel: "canonical", href: "/chat" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "VaultPDF Chat with PDF",
            url: "/chat",
            description:
              "Instant browser-local PDF search with optional on-device LLM. Files and questions never leave the tab.",
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
  // LLM-generated answer state, per-turn
  llm: { status: "idle" | "loading-model" | "generating" | "done" | "error"; text: string; error?: string };
}

type ModelState =
  | { kind: "uninit" }
  | { kind: "loading"; text: string; progress?: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function ChatPage() {
  const [file, setFile] = useState<File | null>(null);
  const [chunks, setChunks] = useState<PdfChunk[]>([]);
  const [index, setIndex] = useState<Bm25Index | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");

  // LLM worker — created only on first Generate click
  const [runtime, setRuntime] = useState<ChatRuntime | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ kind: "uninit" });
  const workerRef = useRef<Worker | null>(null);
  const pendingTurnRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

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
    setIndex(null);
    setTurns([]);
  };

  const ask = useCallback(() => {
    const q = input.trim();
    if (!q || !index) return;
    setInput("");
    const hits = search(index, q, 3);
    setTurns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        question: q,
        hits,
        llm: { status: "idle", text: "" },
      },
    ]);
  }, [input, index]);

  // Lazy worker creation. Returns the live worker.
  const ensureWorker = useCallback(async (): Promise<Worker> => {
    if (workerRef.current) return workerRef.current;

    const rt = await detectRuntime();
    setRuntime(rt);
    setModelState({
      kind: "loading",
      text: rt === "webgpu" ? "Initializing WebGPU…" : "Initializing WASM runtime…",
    });

    const worker = new Worker(new URL("../lib/chat/llm-worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setModelState({ kind: "loading", text: msg.text, progress: msg.progress });
        // Reflect on the pending turn so the per-turn UI shows progress too.
        setTurns((prev) =>
          prev.map((t) =>
            t.id === pendingTurnRef.current && t.llm.status === "loading-model"
              ? { ...t, llm: { ...t.llm, text: msg.text } }
              : t,
          ),
        );
      } else if (msg.type === "ready") {
        setModelState({ kind: "ready" });
      } else if (msg.type === "token") {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === msg.id
              ? { ...t, llm: { ...t.llm, status: "generating", text: t.llm.text + msg.delta } }
              : t,
          ),
        );
      } else if (msg.type === "done") {
        setTurns((prev) =>
          prev.map((t) => (t.id === msg.id ? { ...t, llm: { ...t.llm, status: "done" } } : t)),
        );
        pendingTurnRef.current = null;
      } else if (msg.type === "error") {
        setModelState({ kind: "error", message: msg.message });
        setTurns((prev) =>
          prev.map((t) =>
            t.id === pendingTurnRef.current
              ? { ...t, llm: { status: "error", text: t.llm.text, error: msg.message } }
              : t,
          ),
        );
        toast.error(msg.message);
        pendingTurnRef.current = null;
      }
    });

    worker.postMessage({ type: "init", runtime: rt });
    return worker;
  }, []);

  const generateForTurn = useCallback(
    async (turn: Turn) => {
      if (pendingTurnRef.current) {
        toast.info("Already generating another answer — please wait.");
        return;
      }
      pendingTurnRef.current = turn.id;
      const willLoad = modelState.kind !== "ready";

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turn.id
            ? { ...t, llm: { status: willLoad ? "loading-model" : "generating", text: "" } }
            : t,
        ),
      );

      try {
        const worker = await ensureWorker();
        // Wait until the model is ready before sending generate.
        if (modelState.kind !== "ready" && workerRef.current) {
          await new Promise<void>((resolve, reject) => {
            const onMsg = (e: MessageEvent) => {
              if (e.data?.type === "ready") {
                worker.removeEventListener("message", onMsg);
                resolve();
              } else if (e.data?.type === "error") {
                worker.removeEventListener("message", onMsg);
                reject(new Error(e.data.message));
              }
            };
            worker.addEventListener("message", onMsg);
          });
        }

        const context = turn.hits
          .map((h, i) => `[Source ${i + 1}, p. ${h.chunk.page}]\n${h.chunk.text}`)
          .join("\n\n");
        const system =
          "You answer questions strictly from the provided PDF excerpts. " +
          "Cite the page number for claims using [p. N]. " +
          "If the answer isn't in the excerpts, say so plainly. Be concise.";
        const userTurn = `PDF excerpts:\n\n${context || "(no relevant excerpts found)"}\n\nQuestion: ${turn.question}`;

        setTurns((prev) =>
          prev.map((t) => (t.id === turn.id ? { ...t, llm: { status: "generating", text: "" } } : t)),
        );

        worker.postMessage({
          type: "generate",
          id: turn.id,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userTurn },
          ],
          maxTokens: 512,
        });
      } catch (err: any) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turn.id
              ? { ...t, llm: { status: "error", text: "", error: err?.message ?? "Failed" } }
              : t,
          ),
        );
        pendingTurnRef.current = null;
      }
    },
    [ensureWorker, modelState],
  );

  return (
    <AppShell>
      <div className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-vault mb-3">
                Tool · Chat with PDF <span className="ml-2 text-muted-foreground">Beta</span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl leading-tight">
                Instant answers from your PDF.
                <br />
                <span className="text-vault italic">No download. No upload.</span>
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                Ask anything — top-matching passages with page numbers appear immediately. Want a
                written summary? An optional 200 MB AI model loads on demand, runs in your browser,
                and caches forever. Nothing ever leaves this tab.
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
                label="Drop a PDF to chat with it"
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
                        {chunks.length > 0 && ` · ${chunks.length} passages indexed`}
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
                          <TurnBlock
                            key={t.id}
                            turn={t}
                            onGenerate={() => generateForTurn(t)}
                            modelReady={modelState.kind === "ready"}
                          />
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
                        placeholder="Ask a question about this PDF…"
                        className="flex-1 bg-transparent text-sm px-3 py-2 outline-none placeholder:text-muted-foreground/70"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!input.trim()}
                        className="bg-vault text-vault-foreground hover:opacity-90"
                      >
                        <Send className="h-4 w-4" />
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

            <div className="rounded-lg border border-border bg-card/50 p-5">
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3 flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5 text-vault" /> AI mode (optional)
              </div>
              {modelState.kind === "uninit" && (
                <div className="text-sm text-muted-foreground">
                  Loads SmolLM2-360M (~200&nbsp;MB) the first time you tap{" "}
                  <span className="text-foreground">Generate written answer</span> on any reply.
                  Cached forever after.
                </div>
              )}
              {modelState.kind === "loading" && (
                <>
                  <div className="text-sm text-foreground">{modelState.text}</div>
                  <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-vault transition-all"
                      style={{ width: `${Math.round((modelState.progress ?? 0.05) * 100)}%` }}
                    />
                  </div>
                </>
              )}
              {modelState.kind === "ready" && (
                <div className="text-sm text-vault flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5" /> Model loaded ({runtime})
                </div>
              )}
              {modelState.kind === "error" && (
                <div className="text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{modelState.message}</span>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium mb-2">How it works</div>
              The PDF is parsed and indexed with BM25 inside your browser. Each question retrieves
              the top 3 passages with page citations — instantly. If you opt into the local AI,
              those passages are summarized by a small open-source model running in a Web Worker.
              No network calls after the model is cached.
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

function TurnBlock({
  turn,
  onGenerate,
  modelReady,
}: {
  turn: Turn;
  onGenerate: () => void;
  modelReady: boolean;
}) {
  return (
    <div className="space-y-3">
      {/* User question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-vault text-vault-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {turn.question}
        </div>
      </div>

      {/* Instant retrieval answer */}
      <InstantAnswer hits={turn.hits} query={turn.question} />

      {/* Optional written answer */}
      {turn.llm.status === "idle" && turn.hits.length > 0 && (
        <button
          onClick={onGenerate}
          className="group inline-flex items-center gap-2 rounded-md border border-vault/40 bg-vault/10 hover:bg-vault/20 text-vault px-3 py-2 text-xs font-medium transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate written answer
          <span className="text-[10px] uppercase tracking-[0.16em] text-vault/70 group-hover:text-vault">
            {modelReady ? "· model cached" : "· loads ~200 MB once"}
          </span>
        </button>
      )}

      {turn.llm.status === "loading-model" && (
        <div className="rounded-lg border border-vault/30 bg-vault/5 px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-vault" />
          {turn.llm.text || "Downloading model…"}
        </div>
      )}

      {(turn.llm.status === "generating" || turn.llm.status === "done") && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-secondary/70 text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
            {turn.llm.text || (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking locally…
              </span>
            )}
          </div>
        </div>
      )}

      {turn.llm.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive inline-flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> {turn.llm.error ?? "Generation failed"}
        </div>
      )}
    </div>
  );
}

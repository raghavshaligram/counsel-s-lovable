import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText,
  Lock,
  Send,
  X,
  Cpu,
  Sparkles,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { softwareAppSchema } from "@/lib/seo/tool-schema";
import { extractPdfChunks, type PdfChunk } from "@/lib/chat/pdf-extract";
import { buildIndex, search, type Bm25Index } from "@/lib/chat/bm25";
import {
  detectRuntime,
  approxDeviceMemoryGB,
  type ChatRuntime,
} from "@/lib/chat/runtime-detect";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat with PDF in your browser — Free, Private, Offline · VaultPDF" },
      {
        name: "description",
        content:
          "Ask questions about any PDF. The AI runs entirely in your browser via WebGPU — no upload, no API key, no server. Works offline after first load.",
      },
      { property: "og:title", content: "Chat with PDF — 100% in your browser" },
      {
        property: "og:description",
        content:
          "A local LLM answers questions about your PDF without ever leaving your tab. WebGPU + WASM fallback.",
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
              "Browser-local AI chat over your PDF. WebGPU when available, WASM fallback. Files and questions never leave the tab.",
          }),
        ),
      },
    ],
  }),
  component: ChatPage,
});

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: number[];
}

type LoadStatus =
  | { kind: "idle" }
  | { kind: "loading"; text: string; progress?: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function ChatPage() {
  const [file, setFile] = useState<File | null>(null);
  const [chunks, setChunks] = useState<PdfChunk[]>([]);
  const [index, setIndex] = useState<Bm25Index | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  const [runtime, setRuntime] = useState<ChatRuntime | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>({ kind: "idle" });

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const initStartedRef = useRef(false);
  const genIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Worker boot — strictly client-side
  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    let cancelled = false;
    (async () => {
      const rt = await detectRuntime();
      if (cancelled) return;
      setRuntime(rt);
      setStatus({
        kind: "loading",
        text: rt === "webgpu" ? "Initializing WebGPU model…" : "Initializing WASM model…",
      });

      const worker = new Worker(new URL("../lib/chat/llm-worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;

      worker.addEventListener("message", (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setStatus({ kind: "loading", text: msg.text, progress: msg.progress });
        } else if (msg.type === "ready") {
          setModelId(msg.modelId);
          setStatus({ kind: "ready" });
        } else if (msg.type === "token") {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role !== "assistant") return prev;
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + msg.delta },
            ];
          });
        } else if (msg.type === "done") {
          setGenerating(false);
        } else if (msg.type === "error") {
          setStatus({ kind: "error", message: msg.message });
          setGenerating(false);
          toast.error(msg.message);
        }
      });

      worker.postMessage({ type: "init", runtime: rt });
    })();

    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const onPdf = useCallback(async (f: File) => {
    setFile(f);
    setMessages([]);
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
    setMessages([]);
  };

  const ask = useCallback(() => {
    const q = input.trim();
    if (!q || !index || status.kind !== "ready" || generating) return;
    setInput("");

    const hits = search(index, q, 4);
    const context = hits
      .map((h, i) => `[Source ${i + 1}, p. ${h.chunk.page}]\n${h.chunk.text}`)
      .join("\n\n");
    const cites = Array.from(new Set(hits.map((h) => h.chunk.page))).sort((a, b) => a - b);

    const system =
      "You answer questions strictly from the provided PDF excerpts. " +
      "Cite the page number for any claim using the form [p. N]. " +
      "If the answer is not in the excerpts, reply that the document doesn't cover it. " +
      "Be concise.";
    const userTurn = `PDF excerpts:\n\n${context || "(no relevant excerpts found)"}\n\nQuestion: ${q}`;

    const history: Message[] = [
      ...messages,
      { role: "user", content: q },
      { role: "assistant", content: "", citations: cites },
    ];
    setMessages(history);
    setGenerating(true);

    const id = String(++genIdRef.current);
    workerRef.current?.postMessage({
      type: "generate",
      id,
      messages: [
        { role: "system", content: system },
        // Only send the new turn — the model has no useful memory of prior PDF
        // contexts and re-fetching context per turn keeps prompts tight.
        { role: "user", content: userTurn },
      ],
      maxTokens: 512,
    });
  }, [input, index, status, generating, messages]);

  const memWarn = useMemo(() => {
    const m = approxDeviceMemoryGB();
    return runtime === "wasm" && m !== null && m < 4;
  }, [runtime]);

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
                Ask your PDF anything.
                <br />
                <span className="text-vault italic">Locally.</span>
              </h1>
              <p className="mt-3 text-muted-foreground max-w-2xl">
                A small open-source AI runs entirely inside this tab. Your PDF and your questions
                never leave the browser. WebGPU when available, WASM fallback otherwise.
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
                sublabel="text-based PDFs · indexed locally for retrieval"
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
                  <div className="rounded-xl border border-border bg-card/30 flex flex-col h-[60vh] min-h-[420px]">
                    <div
                      ref={scrollRef}
                      className="flex-1 overflow-y-auto p-5 space-y-4"
                    >
                      {messages.length === 0 ? (
                        <EmptyChat />
                      ) : (
                        messages.map((m, i) => <MessageBubble key={i} message={m} />)
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
                        placeholder={
                          status.kind === "ready"
                            ? "Ask a question about this PDF…"
                            : "Waiting for model to finish loading…"
                        }
                        disabled={status.kind !== "ready" || generating}
                        className="flex-1 bg-transparent text-sm px-3 py-2 outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={status.kind !== "ready" || generating || !input.trim()}
                        className="bg-vault text-vault-foreground hover:opacity-90"
                      >
                        {generating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
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
                <Cpu className="h-3.5 w-3.5 text-vault" /> Local model
              </div>
              <div className="text-sm font-medium">
                {runtime === "webgpu"
                  ? "Llama-3.2-1B"
                  : runtime === "wasm"
                  ? "Qwen2.5-0.5B"
                  : "Detecting…"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Runtime: {runtime ?? "…"} {runtime === "wasm" && "(CPU)"}
              </div>

              {status.kind === "loading" && (
                <div className="mt-4">
                  <div className="text-xs text-muted-foreground mb-1.5">{status.text}</div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full bg-vault transition-all"
                      style={{
                        width: `${Math.round((status.progress ?? 0.05) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-2">
                    First load only · cached after
                  </div>
                </div>
              )}

              {status.kind === "ready" && (
                <div className="mt-4 flex items-center gap-2 text-xs text-vault">
                  <Sparkles className="h-3.5 w-3.5" /> Model loaded · ready
                </div>
              )}

              {status.kind === "error" && (
                <div className="mt-4 flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{status.message}</span>
                </div>
              )}
            </div>

            {memWarn && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200/90 leading-relaxed">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Low-memory device
                </div>
                Your device reports under 4 GB of RAM. WASM models may be slow or fail. For best
                results, try desktop Chrome on a machine with WebGPU.
              </div>
            )}

            <div className="rounded-lg border border-border bg-card/30 p-5 text-xs text-muted-foreground leading-relaxed">
              <div className="text-foreground font-medium mb-2">How it works</div>
              The PDF is parsed locally with PDF.js, broken into passages, and indexed with BM25.
              For each question, the top-matching passages are sent to a small open-source LLM
              running in a Web Worker. No network calls after the model is cached.
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
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="text-foreground font-medium">Your PDF is indexed.</div>
      <div className="mt-1 max-w-sm">
        Try: <span className="text-foreground">"Summarize the key findings"</span> or{" "}
        <span className="text-foreground">"What does it say about pricing?"</span>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-vault text-vault-foreground px-4 py-2.5 text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-2xl rounded-bl-sm bg-secondary/70 text-foreground px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed">
          {message.content || (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking locally…
            </span>
          )}
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>Context from</span>
            {message.citations.map((p) => (
              <span
                key={p}
                className="rounded-full bg-vault/10 text-vault px-2 py-0.5"
              >
                p. {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

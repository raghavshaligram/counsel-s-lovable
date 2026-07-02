/**
 * Pre-Discovery Review (Pro) — on-device semantic search over the active
 * document. Text is chunked from the loaded PDF (pdf.js), embedded in a
 * Web Worker via @huggingface/transformers (Xenova/all-MiniLM-L6-v2), and
 * cosine-matched against the query. Nothing leaves the device; the model
 * lazy-loads on first use, the index is cached in the worker per doc key.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Search, Loader2, AlertTriangle, Cpu } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";
import type { ToolPanelCtx } from "./tool-panels";
import {
  addDiscoveryDebug,
  capabilityCheck,
  getDiscoveryDebugLines,
  hasIndex,
  indexDocument,
  loadModel,
  queryIndex,
  subscribeDiscoveryDebug,
  type Hit,
  type LoadProgress,
} from "@/lib/discovery/client";

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const terms = Array.from(
    new Set(q.split(/\s+/).filter((t) => t.length >= 3)),
  ).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? (
      <mark
        key={i}
        className="rounded-sm bg-vault/25 px-0.5 text-text"
      >
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

// Note: earlier revisions stripped stopwords from the query before
// embedding. That broke phrasal semantics ("who are the attorneys" →
// "attorneys") and is intentionally removed — the full query is embedded
// as-is and cosine similarity handles common words on its own.

export function PreDiscoveryPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, editorDispatch } = ctx;
  const isPro = useIsPro();
  const requirePro = useRequirePro();

  const docKey = file ? `${file.name}::${file.size}::${file.lastModified}` : "";
  const capability = useMemo(() => capabilityCheck(), []);

  const [modelReady, setModelReady] = useState(false);
  const [loadStage, setLoadStage] = useState<string>("");
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const [indexed, setIndexed] = useState<boolean>(() =>
    docKey ? hasIndex(docKey) : false,
  );
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);

  const [query, setQuery] = useState("");
  const [querying, setQuerying] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [lastQuery, setLastQuery] = useState("");
  const [debugLines, setDebugLines] = useState<string[]>(() => getDiscoveryDebugLines());

  const indexedKeyRef = useRef<string>("");
  useEffect(() => subscribeDiscoveryDebug(setDebugLines), []);

  useEffect(() => {
    if (indexedKeyRef.current !== docKey) {
      indexedKeyRef.current = docKey;
      setIndexed(docKey ? hasIndex(docKey) : false);
      setHits([]);
      setLastQuery("");
    }
  }, [docKey]);

  const ensureModel = useCallback(async (): Promise<boolean> => {
    if (modelReady) return true;
    setLoadStage("Preparing on-device model…");
    try {
      await loadModel((p: LoadProgress) => {
        setLoadStage(
          p.stage === "progress"
            ? `Downloading model${p.file ? ` — ${p.file}` : ""}`
            : p.stage[0].toUpperCase() + p.stage.slice(1),
        );
        if (typeof p.progress === "number") setLoadPct(Math.round(p.progress));
      });
      setModelReady(true);
      setLoadStage("");
      setLoadPct(null);
      return true;
    } catch (err) {
      console.error("[pre-discovery] model load failed", err);
      toast.error("Couldn't load the on-device model", {
        description: err instanceof Error ? err.message : String(err),
      });
      setLoadStage("");
      setLoadPct(null);
      return false;
    }
  }, [modelReady]);

  const buildIndex = useCallback(async (): Promise<boolean> => {
    if (!file) return false;
    if (!requirePro("Pre-Discovery Review")) return false;
    if (!(await ensureModel())) return false;
    setIndexing(true);
    setIndexProgress({ done: 0, total: 0 });
    try {
      const { extractPdfChunks } = await import("@/lib/chat/pdf-extract");
      const raw = await extractPdfChunks(file, 900, 120);
      // extractPdfChunks emits 1-based pages; the editor uses 0-based.
      // Normalise to 0-based here so jumpTo and the "Page N" label both
      // agree with the actual page the passage came from.
      const chunks = raw.map((c, i) => ({
        ...c,
        page: c.page - 1,
        id: `${c.page - 1}:${i}`,
      }));
      if (chunks.length === 0) {
        toast.error("No extractable text — run Make Searchable (OCR) first.");
        setIndexing(false);
        setIndexProgress(null);
        return false;
      }
      const sample = [chunks[0], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]];
      console.log(
        "[pre-discovery] chunk/page sample",
        sample.map((c) => ({ page0: c.page, page1: c.page + 1, textHead: c.text.slice(0, 60) })),
      );
      addDiscoveryDebug("chunk/page sample", sample.map((c) => ({
        page0: c.page,
        page1: c.page + 1,
        textHead: c.text.slice(0, 120),
      })));
      setIndexProgress({ done: 0, total: chunks.length });
      await indexDocument(docKey, chunks, (done, total) =>
        setIndexProgress({ done, total }),
      );
      setIndexed(true);
      toast.success(`Indexed ${chunks.length} passages — search anything.`);
      return true;
    } catch (err) {
      console.error("[pre-discovery] index failed", err);
      toast.error("Indexing failed", {
        description: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  }, [file, docKey, ensureModel, requirePro]);

  const runQuery = useCallback(async () => {
    if (!file || !query.trim()) return;
    if (!requirePro("Pre-Discovery Review")) return;
    if (!indexed) {
      const ok = await buildIndex();
      if (!ok) return;
    } else if (!(await ensureModel())) return;
    setQuerying(true);
    try {
      // Embed the FULL original query — stopword stripping loses phrasal
      // context ("who are the attorneys" → "attorneys" tanks recall).
      // Embeddings handle common words natively; we only need thresholds
      // to keep unrelated chunks out.
      const q = query.trim();
      const results = await queryIndex(docKey, q, 20);
      // Pure cosine ranking on MiniLM (L2-normalised → dot product).
      // MiniLM cosines: ~0.15 unrelated, 0.25–0.35 loosely related,
      // 0.35+ clearly relevant. Keep an absolute floor to filter noise
      // and a relative gap so weak tail results don't survive when the
      // top match is strong.
      const MIN_ABS = 0.3;
      const REL_GAP = 0.75;
      const top = results[0]?.score ?? 0;
      const floor = Math.max(MIN_ABS, top * REL_GAP);
      const filtered = results.filter((r) => r.score >= floor).slice(0, 8);
      console.log(
        "[pre-discovery] query",
        JSON.stringify(q),
        "ranking=cosine(MiniLM)",
        "top",
        top.toFixed(3),
        "floor",
        floor.toFixed(3),
        "kept",
        filtered.length,
        "of",
        results.length,
        "sampleScores",
        results.slice(0, 5).map((r) => r.score.toFixed(3)),
      );
      addDiscoveryDebug("query filtered results", {
        query: q,
        ranking: "cosine(MiniLM embeddings)",
        top: +top.toFixed(3),
        floor: +floor.toFixed(3),
        kept: filtered.length,
        returned: results.length,
        top5: results.slice(0, 5).map((r) => ({
          page0: r.page,
          page1: r.page + 1,
          score: +r.score.toFixed(3),
          textHead: r.text.slice(0, 120),
        })),
      });
      setHits(filtered);
      setLastQuery(query.trim());
    } catch (err) {
      console.error("[pre-discovery] query failed", err);
      toast.error("Search failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQuerying(false);
    }
  }, [file, query, docKey, indexed, buildIndex, ensureModel, requirePro]);

  const jumpTo = useCallback(
    (page: number) => {
      // page is 0-based (see buildIndex). SET_PAGE expects 0-based.
      editorDispatch({ type: "SELECT_ANNO", id: null });
      editorDispatch({ type: "SET_PAGE", n: page });
    },
    [editorDispatch],
  );

  const copyDiagnostics = useCallback(async () => {
    const body = debugLines.length
      ? debugLines.join("\n")
      : "No Pre-Discovery diagnostics yet. Run a search first.";
    try {
      await navigator.clipboard.writeText(body);
      toast.success("Diagnostics copied");
    } catch {
      toast.error("Could not copy diagnostics");
    }
  }, [debugLines]);

  /* ---------- render ---------- */

  const header = (
    <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
      <Sparkles className="h-3.5 w-3.5 text-vault" />
      Pre-Discovery Review
      {!isPro && <LockBadge title="Pro — Pre-Discovery Review" />}
    </div>
  );

  const valueProp = (
    <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
      Ask natural-language questions of the document — “mentions of environmental
      liability”, “financial figures”, “anything about the March 2025 agreement”.
      Runs entirely on-device: the model, the index, and your query never leave
      this tab.
    </p>
  );

  if (!capability.ok) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2 text-[11.5px] text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{capability.reason}</span>
        </div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        {valueProp}
        {!isPro && (
          <Button
            size="sm"
            className="h-8 bg-vault text-white hover:bg-vault/90"
            onClick={() => requirePro("Pre-Discovery Review")}
          >
            Unlock with Pro
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      {valueProp}

      {!isPro ? (
        <Button
          size="sm"
          className="h-8 bg-vault text-white hover:bg-vault/90"
          onClick={() => requirePro("Pre-Discovery Review")}
        >
          Unlock with Pro
        </Button>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runQuery();
            }}
            className="flex items-center gap-1.5"
          >
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask the document…"
              className="h-8 text-[12.5px]"
              disabled={indexing}
              spellCheck={false}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={!query.trim() || indexing || querying}
            >
              {querying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          </form>

          {loadStage && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Cpu className="h-3 w-3" />
              <span>
                {loadStage}
                {loadPct !== null && ` · ${loadPct}%`}
              </span>
            </div>
          )}

          {indexing && indexProgress && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 px-2 py-1.5">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Indexing passages…</span>
                <span>
                  {indexProgress.done} / {indexProgress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full bg-vault transition-all"
                  style={{
                    width: indexProgress.total
                      ? `${Math.round((indexProgress.done / indexProgress.total) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {!indexed && !indexing && (
            <div className="text-[11px] text-text-subtle">
              First search will build a local index of this document (~a few
              seconds per 100 pages). The model downloads once and is cached.
            </div>
          )}

          {debugLines.length > 0 && (
            <div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] uppercase tracking-wide text-text-subtle">
                  Search diagnostics
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  onClick={copyDiagnostics}
                >
                  Copy
                </Button>
              </div>
              <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[10.5px] leading-snug text-text-muted">
                {debugLines.slice(-8).join("\n")}
              </pre>
            </div>
          )}

          {hits.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[10.5px] uppercase tracking-wide text-text-subtle">
                {hits.length} passage{hits.length === 1 ? "" : "s"} for “{lastQuery}”
              </div>
              <div className="max-h-[360px] overflow-y-auto rounded-md border border-border bg-surface-2 divide-y divide-border">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => jumpTo(h.page)}
                    className="block w-full px-2.5 py-2 text-left hover:bg-vault/5"
                    title={`Jump to page ${h.page + 1}`}
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[10.5px] text-text-subtle">
                      <span>Page {h.page + 1}</span>
                      <span>{Math.round(h.score * 100)}% match</span>
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 line-clamp-4 text-[11.5px] leading-snug text-text",
                      )}
                    >
                      {highlight(h.text, lastQuery)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {lastQuery && !querying && hits.length === 0 && (
            <div className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] text-text-muted">
              No confident matches for “{lastQuery}”. Try a broader phrase or
              different terminology.
            </div>
          )}
        </>
      )}
    </div>
  );
}

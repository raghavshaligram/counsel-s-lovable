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
import { capabilityCheck } from "@/lib/discovery/client";
import { searchDocument, type SemanticHit } from "@/lib/discovery/search";

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

  const [statusLabel, setStatusLabel] = useState<string>("");

  const [query, setQuery] = useState("");
  const [querying, setQuerying] = useState(false);
  const [hits, setHits] = useState<SemanticHit[]>([]);
  const [lastQuery, setLastQuery] = useState("");

  const docKeyRef = useRef<string>("");

  useEffect(() => {
    if (docKeyRef.current !== docKey) {
      docKeyRef.current = docKey;
      setHits([]);
      setLastQuery("");
      setStatusLabel("");
    }
  }, [docKey]);

  /**
   * Prefill + auto-run when the unified command bar routes a query here.
   */
  const runQueryRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const onCmd = (ev: Event) => {
      const detail = (ev as CustomEvent<{ query?: string }>).detail;
      const q = (detail?.query ?? "").trim();
      if (!q) return;
      setQuery(q);
      setTimeout(() => void runQueryRef.current(), 30);
    };
    window.addEventListener("commandbar:query", onCmd as EventListener);
    return () => window.removeEventListener("commandbar:query", onCmd as EventListener);
  }, []);

  const runQuery = useCallback(async () => {
    if (!file || !query.trim()) return;
    if (!requirePro("Pre-Discovery Review")) return;
    const q = query.trim();
    setQuerying(true);
    setStatusLabel("Searching…");
    try {
      const results = await searchDocument(file, docKey, q, {
        topK: 20,
        shortlistSize: 80,
        onStage: (stage, info) => {
          if (stage === "extract") setStatusLabel("Reading document…");
          else if (stage === "keyword") setStatusLabel("Searching…");
          else if (stage === "semantic")
            setStatusLabel(
              `Ranking most relevant passages${info?.candidates ? ` (${info.candidates})` : ""}…`,
            );
        },
      });

      // Cosine-based confidence filter, matches previous behaviour.
      const MIN_ABS = 0.15;
      const MIN_GAP = 0.05;
      const DOMINANCE = 1.5;
      const REL_GAP = 0.75;
      const top = results[0]?.score ?? 0;
      const second = results[1]?.score ?? 0;
      const topDominates =
        top >= MIN_ABS && (top - second >= MIN_GAP || top >= second * DOMINANCE);
      const floor = top * REL_GAP;
      const filtered = results
        .filter((r, i) => {
          if (r.score < MIN_ABS) return false;
          if (i === 0) return topDominates || r.score >= MIN_ABS;
          return r.score >= floor;
        })
        .slice(0, 8);

      setHits(filtered);
      setLastQuery(q);
    } catch (err) {
      console.error("[pre-discovery] search failed", err);
      toast.error("Search failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setQuerying(false);
      setStatusLabel("");
    }
  }, [file, query, docKey, requirePro]);

  useEffect(() => {
    runQueryRef.current = runQuery;
  }, [runQuery]);

  const jumpTo = useCallback(
    (page: number) => {
      // page is 0-based (see buildIndex). SET_PAGE expects 0-based.
      editorDispatch({ type: "SELECT_ANNO", id: null });
      editorDispatch({ type: "SET_PAGE", n: page });
    },
    [editorDispatch],
  );


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
              disabled={querying}
              spellCheck={false}
            />
            <Button
              type="submit"
              size="sm"
              className="h-8"
              disabled={!query.trim() || querying}
            >
              {querying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          </form>

          {querying && statusLabel && (
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Cpu className="h-3 w-3" />
              <span>{statusLabel}</span>
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

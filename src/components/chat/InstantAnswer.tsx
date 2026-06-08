import { useState } from "react";
import { Copy, FileText, Check } from "lucide-react";
import { highlight, type SearchHit } from "@/lib/chat/bm25";

export function InstantAnswer({
  hits,
  query,
}: {
  hits: SearchHit[];
  query: string;
}) {
  if (hits.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/30 p-4 text-sm text-muted-foreground">
        No matching passages found. Try different words from the PDF.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Top passages from your PDF
      </div>
      {hits.map((hit, i) => (
        <Passage key={i} hit={hit} query={query} />
      ))}
    </div>
  );
}

function Passage({ hit, query }: { hit: SearchHit; query: string }) {
  const [copied, setCopied] = useState(false);
  const segs = highlight(hit.chunk.text, query);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hit.chunk.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/60 bg-card/60 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-vault font-medium">
          <FileText className="h-3 w-3" />
          Page {hit.chunk.page}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy quote
            </>
          )}
        </button>
      </div>
      <blockquote className="px-3 py-2.5 text-sm leading-relaxed text-foreground/90 border-l-2 border-vault/40 max-h-48 overflow-y-auto">
        {segs.map((s, i) =>
          s.hit ? (
            <mark
              key={i}
              className="bg-vault/25 text-foreground rounded-sm px-0.5 py-px"
            >
              {s.text}
            </mark>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </blockquote>
    </div>
  );
}

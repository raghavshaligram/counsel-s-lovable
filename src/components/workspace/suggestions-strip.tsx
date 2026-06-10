import type { Insight } from "@/lib/intelligence/insights";
import { ShieldCheck, Table2, ScanText, Hash, PenLine, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * SuggestionsStrip — the visible face of the intelligence layer.
 *
 * Sits above the document canvas. Renders the analyzer's `Insight[]` as
 * one-click action chips. Click = jump to the suggested tool and the
 * first page where the pattern appeared.
 *
 * No-op when there are no insights (the canvas reclaims the space).
 */

const TOOL_ICON: Record<Insight["suggestedTool"], ReactNode> = {
  redact: <ShieldCheck className="h-3.5 w-3.5" />,
  extract: <Table2 className="h-3.5 w-3.5" />,
  ocr: <ScanText className="h-3.5 w-3.5" />,
  bates: <Hash className="h-3.5 w-3.5" />,
  sign: <PenLine className="h-3.5 w-3.5" />,
};

const TONE: Record<Insight["severity"], string> = {
  info: "border-whisper text-ink/70 hover:border-vault/40 hover:text-ink",
  warn: "border-vault/30 text-vault hover:bg-vault/10",
  evidence: "border-evidence/40 text-evidence hover:bg-evidence/10",
};

export function SuggestionsStrip({
  insights,
  loading,
  onAct,
  onDismiss,
}: {
  insights: Insight[];
  loading?: boolean;
  onAct: (i: Insight) => void;
  onDismiss?: () => void;
}) {
  if (!loading && insights.length === 0) return null;
  return (
    <div className="flex items-center gap-2 border-b border-whisper bg-background/60 px-3 py-1.5 text-[12px]">
      <Sparkles className="h-3.5 w-3.5 text-vault shrink-0" aria-hidden />
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 shrink-0">
        Suggested
      </span>
      <div className="flex flex-1 min-w-0 gap-1.5 overflow-x-auto no-scrollbar">
        {loading && (
          <span className="font-mono text-[11px] text-ink/40 px-1.5 py-0.5">analyzing…</span>
        )}
        {insights.map((i) => (
          <button
            key={i.id}
            title={`${i.hint}  ·  jump to page ${i.firstPage + 1}`}
            onClick={() => onAct(i)}
            className={
              "shrink-0 inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 transition-colors " +
              TONE[i.severity]
            }
          >
            {TOOL_ICON[i.suggestedTool]}
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          title="Dismiss suggestions"
          className="text-ink/40 hover:text-ink shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

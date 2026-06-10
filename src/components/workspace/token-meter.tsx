import { cn } from "@/lib/utils";

/**
 * Token meter — monochrome chip in chat input header tray (B13).
 * State: queued (greyed estimate) → streaming (live) → settled (final).
 */
export function TokenMeter({
  cost,
  tokens,
  state = "settled",
  onClick,
}: {
  cost: number;
  tokens: number;
  state?: "queued" | "streaming" | "settled";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-whisper px-2 py-0.5 font-mono text-[11px] tabular-nums",
        state === "queued" && "text-ink/40",
        state === "streaming" && "text-vault",
        state === "settled" && "text-ink/70"
      )}
      title={state === "queued" ? "Estimated cost" : state === "streaming" ? "Live cost" : "Final cost"}
    >
      <span>${cost.toFixed(3)}</span>
      <span className="text-ink/30">·</span>
      <span>{formatTokens(tokens)} tkn</span>
      {state === "streaming" && <span className="ml-1 inline-block h-1 w-1 rounded-full bg-vault animate-pulse" />}
    </button>
  );
}

function formatTokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}m`;
}

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * ApprovalCard — rendered inline in chat when the agent proposes a
 * destructive or confirm-level tool call. Solid amber primary, ink secondary.
 */
export function ApprovalCard({
  title,
  summary,
  changes,
  onApprove,
  onReject,
  tone = "vault",
}: {
  title: string;
  summary?: string;
  changes?: ReactNode;
  onApprove: () => void;
  onReject: () => void;
  tone?: "vault" | "evidence";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-background/60 p-3 text-sm",
        tone === "vault" ? "border-vault/40" : "border-evidence/40"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="font-display text-base text-ink">{title}</div>
        <span
          className={cn(
            "text-[10px] uppercase tracking-[0.18em]",
            tone === "vault" ? "text-vault" : "text-evidence"
          )}
        >
          Awaiting approval
        </span>
      </div>
      {summary && <p className="mt-1 text-ink/70 text-[13px] leading-snug">{summary}</p>}
      {changes && <div className="mt-2 rounded-sm bg-whisper/40 p-2 text-[12px] text-ink/80">{changes}</div>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button onClick={onReject} className="rounded-md px-3 py-1.5 text-[12px] text-ink/70 hover:bg-whisper">
          Reject
        </button>
        <button
          onClick={onApprove}
          className={cn(
            "rounded-md px-3 py-1.5 text-[12px] font-medium",
            tone === "vault" ? "bg-vault text-vault-foreground" : "bg-evidence text-background"
          )}
        >
          Approve
        </button>
      </div>
    </div>
  );
}

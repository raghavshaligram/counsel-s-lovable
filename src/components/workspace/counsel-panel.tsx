/**
 * Counsel — unified AI Assist panel (shell).
 *
 * Right-docked, resizable panel that hosts the conversational thread for
 * the command bar. The PDF reflows next to it — this aside is a sibling
 * of <main>, so the canvas resizes rather than being covered.
 *
 * This file is the SHELL: response-card components + panel layout +
 * placeholder canned responses. Real answering (embedding routing, LLM
 * calls, source extraction) is wired next.
 *
 * Response types (see spec):
 *  - ACTION CARD    : summary + primary "Open [tool]" button.
 *  - GROUNDED       : answer text + tappable page-source chips.
 *  - HELP           : concise how-to + optional "Open [tool]" button.
 *  - CLARIFY        : disambiguation with option buttons.
 *
 * Counsel proposes and prepares; it never executes destructive ops.
 */

import { useEffect, useRef } from "react";
import { X, Sparkles, ArrowRight, HelpCircle, FileText, Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/* --------------------------------- types --------------------------------- */

export type CounselSource = { page: number; quote?: string };

export type CounselMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: "action";
      summary: string;
      toolId: string;
      toolLabel: string;
      destructive?: boolean;
    }
  | {
      id: string;
      role: "assistant";
      kind: "grounded";
      answer: string;
      sources: CounselSource[];
    }
  | {
      id: string;
      role: "assistant";
      kind: "help";
      answer: string;
      toolId?: string;
      toolLabel?: string;
    }
  | {
      id: string;
      role: "assistant";
      kind: "clarify";
      question: string;
      options: Array<{ id: string; label: string }>;
    }
  | {
      id: string;
      role: "assistant";
      kind: "thinking";
    };

/* --------------------------- resizable panel width --------------------------- */

const MIN = 320;
const MAX = 640;
const DEFAULT = 400;
const KEY = "vaultpdf:counselWidth";

export function useCounselWidth() {
  const [width, setWidth] = (function () {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [w, set] = (require("react") as typeof import("react")).useState<number>(DEFAULT);
    return [w, set] as const;
  })();
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) setWidth(Math.min(MAX, Math.max(MIN, n)));
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = (w: number) => {
    const clamped = Math.min(MAX, Math.max(MIN, Math.round(w)));
    setWidth(clamped);
    try { localStorage.setItem(KEY, String(clamped)); } catch { /* noop */ }
  };
  return [width, persist] as const;
}

/* ------------------------------ panel ------------------------------ */

export function CounselPanel({
  open,
  width,
  setWidth,
  messages,
  onClose,
  onNewConversation,
  onOpenTool,
  onJumpToPage,
  onOptionPick,
}: {
  open: boolean;
  width: number;
  setWidth: (w: number) => void;
  messages: CounselMessage[];
  onClose: () => void;
  onNewConversation: () => void;
  onOpenTool: (toolId: string) => void;
  onJumpToPage: (page: number) => void;
  onOptionPick: (optionId: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const onMove = (ev: PointerEvent) => {
      const delta = startX - ev.clientX;
      setWidth(startWidth + delta);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const w = open ? width : 0;

  return (
    <aside
      aria-label="Counsel"
      className="relative shrink-0 border-l border-border bg-surface-1 overflow-hidden transition-[width] duration-200"
      style={{ width: w, transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" }}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Counsel"
          onPointerDown={onDragStart}
          onDoubleClick={() => setWidth(DEFAULT)}
          className={cn(
            "absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize",
            "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border/60",
            "hover:before:bg-vault/60",
          )}
        />
      )}
      <div className="flex h-full w-full flex-col" style={{ minWidth: MIN }}>
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-vault">
              <Sparkles className="h-[15px] w-[15px]" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium leading-tight">Counsel</div>
              <div className="truncate text-[11px] text-text-muted">Document-grounded assistant</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onNewConversation}
              title="New conversation"
              aria-label="New conversation"
              className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Counsel"
              className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Thread */}
        <div ref={scrollerRef} className="flex-1 overflow-auto px-3 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-4 text-[12px] leading-relaxed text-text-muted">
              Ask a question about this document, run a task, or get help using a tool.
              Answers cite the pages they come from; actions are always previewed before they run.
            </div>
          )}
          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              onOpenTool={onOpenTool}
              onJumpToPage={onJumpToPage}
              onOptionPick={onOptionPick}
            />
          ))}
        </div>

        {/* Privacy line */}
        <div className="shrink-0 border-t border-border px-3 py-2 flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <Lock className="h-3 w-3 text-vault" strokeWidth={2.5} />
          Conversations and documents never leave this device.
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------ messages ------------------------------ */

function MessageRow({
  message,
  onOpenTool,
  onJumpToPage,
  onOptionPick,
}: {
  message: CounselMessage;
  onOpenTool: (toolId: string) => void;
  onJumpToPage: (page: number) => void;
  onOptionPick: (optionId: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-vault px-2.5 py-1.5 text-[12.5px] text-vault-foreground">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.kind === "thinking") {
    return (
      <div className="text-[12px] text-text-muted italic">Counsel is thinking…</div>
    );
  }
  if (message.kind === "action") {
    return <ActionCard m={message} onOpenTool={onOpenTool} />;
  }
  if (message.kind === "grounded") {
    return <GroundedCard m={message} onJumpToPage={onJumpToPage} />;
  }
  if (message.kind === "help") {
    return <HelpCard m={message} onOpenTool={onOpenTool} />;
  }
  return <ClarifyCard m={message} onOptionPick={onOptionPick} />;
}

function ActionCard({
  m,
  onOpenTool,
}: {
  m: Extract<CounselMessage, { kind: "action" }>;
  onOpenTool: (toolId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="rounded-md border border-vault/40 bg-vault/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-vault">
          {m.destructive ? "Action · needs review" : "Action"}
        </span>
      </div>
      <div className="mb-2.5 text-[12.5px] leading-snug text-foreground">{m.summary}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenTool(m.toolId)}
          className="inline-flex items-center gap-1.5 rounded-md bg-vault px-2.5 py-1 text-[12px] font-medium text-vault-foreground hover:bg-vault/90"
        >
          Review in {m.toolLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10.5px] text-text-muted">
          Counsel prepares — you confirm.
        </span>
      </div>
    </div>
  );
}

function GroundedCard({
  m,
  onJumpToPage,
}: {
  m: Extract<CounselMessage, { kind: "grounded" }>;
  onJumpToPage: (page: number) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
        {m.answer}
      </div>
      {m.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            Sources
          </span>
          {m.sources.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onJumpToPage(s.page)}
              title={s.quote ? `Jump to page ${s.page} · ${s.quote}` : `Jump to page ${s.page}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-vault hover:bg-vault/10"
            >
              <FileText className="h-3 w-3" />
              p.{s.page}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HelpCard({
  m,
  onOpenTool,
}: {
  m: Extract<CounselMessage, { kind: "help" }>;
  onOpenTool: (toolId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <HelpCircle className="h-3.5 w-3.5 text-vault" />
        <span className="text-[10px] uppercase tracking-wider text-text-muted">How to</span>
      </div>
      <div className="mb-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-foreground/90">
        {m.answer}
      </div>
      {m.toolId && m.toolLabel && (
        <button
          type="button"
          onClick={() => onOpenTool(m.toolId!)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px] text-vault hover:bg-vault/10"
        >
          Open {m.toolLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function ClarifyCard({
  m,
  onOptionPick,
}: {
  m: Extract<CounselMessage, { kind: "clarify" }>;
  onOptionPick: (optionId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-2 text-[12.5px] leading-snug text-foreground">{m.question}</div>
      <div className="flex flex-wrap gap-1.5">
        {m.options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onOptionPick(o.id)}
            className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[12px] text-text hover:bg-vault/10 hover:text-vault"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------- placeholder responder ------------------------- */

/**
 * Canned placeholder response generator. Wired to the command bar so the
 * shell is fully testable. Real routing/answering (embeddings, LLM,
 * source extraction) replaces this in the next step — the message shapes
 * and card components above are the stable contract.
 */
export function draftPlaceholderReply(
  userText: string,
  opts: { hasFile: boolean; toolIdForAction?: string; toolLabelForAction?: string; destructive?: boolean },
): CounselMessage {
  const id = `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const text = userText.trim().toLowerCase();

  // HELP — meta questions about the tools themselves.
  if (/^(how (do|to|can|does)|what does .* do|where is|help with)/.test(text)) {
    return {
      id,
      role: "assistant",
      kind: "help",
      answer:
        "Open the Redact panel from the left rail. Turn on the categories you want auto-detected (PII, phone, SSN), review each hit, then apply. Nothing is redacted until you confirm.",
      toolId: "redact",
      toolLabel: "Redact",
    };
  }

  // CLARIFY — vague / ambiguous destructive-sounding phrasing.
  if (/^(remove|delete|strip)\b/.test(text) && !/(metadata|page|watermark|password)/.test(text)) {
    return {
      id,
      role: "assistant",
      kind: "clarify",
      question:
        "Do you want to redact those out of the document, or just find and highlight them for review?",
      options: [
        { id: "redact", label: "Redact them" },
        { id: "find", label: "Just find them" },
      ],
    };
  }

  // ACTION — the caller already classified this as a tool action.
  if (opts.toolIdForAction && opts.toolLabelForAction) {
    return {
      id,
      role: "assistant",
      kind: "action",
      summary: opts.destructive
        ? `I can prepare "${userText.trim()}" in ${opts.toolLabelForAction}. Nothing is applied yet — you'll review each match first.`
        : `Ready to run "${userText.trim()}" in ${opts.toolLabelForAction}.`,
      toolId: opts.toolIdForAction,
      toolLabel: opts.toolLabelForAction,
      destructive: opts.destructive,
    };
  }

  // GROUNDED — document Q&A / search fallback.
  if (!opts.hasFile) {
    return {
      id,
      role: "assistant",
      kind: "help",
      answer:
        "Open a PDF first — Counsel answers are grounded in the document you're viewing.",
    };
  }
  return {
    id,
    role: "assistant",
    kind: "grounded",
    answer:
      "Placeholder answer: the two named parties appear alongside the settlement discussion and again in the signature block. Real routing and source extraction are wired in the next step.",
    sources: [
      { page: 1, quote: "Preview passage from page 1" },
      { page: 3, quote: "Preview passage from page 3" },
    ],
  };
}

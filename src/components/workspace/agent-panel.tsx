/**
 * AgentPanel — a right-side conversational panel that orchestrates
 * multi-step flows over the EXISTING verified tools. It never runs
 * destructive operations itself: AUTO steps are read-only (detect,
 * count, analyze); state-changing steps require an explicit confirm and
 * then hand off to the existing tool (Redact, Sanitize, Bates, OCR,
 * Repair) which performs the operation and its own verification.
 *
 * The PDF viewer, tab lifecycle and editor canvas are untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  X,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Search,
  ArrowRight,
  Send,
  Lock,
} from "lucide-react";

import { importChunk } from "@/lib/chunk-import";
import type { PiiCategory, Detection } from "@/lib/pdf/detect-pii";
import {
  detectAgentFlow,
  extractAdditionalCategories,
  isCancel,
  parsePageScope,
  targetToolForFlow,
  type AgentFlow,
} from "@/lib/agent/flows";

type Action = {
  label: string;
  onClick: () => void;
  tone?: "primary" | "destructive" | "ghost";
  disabled?: boolean;
};

type Step =
  | { kind: "note"; id: string; body: string }
  | { kind: "running"; id: string; label: string; progress?: string }
  | {
      kind: "result";
      id: string;
      title: string;
      body: string;
      caveat?: string;
      actions?: Action[];
    }
  | {
      kind: "propose";
      id: string;
      title: string;
      body: string;
      actions: Action[];
      destructive?: boolean;
    }
  | { kind: "handoff"; id: string; title: string; body: string }
  | { kind: "success"; id: string; title: string; body: string }
  | { kind: "error"; id: string; title: string; body: string };

export interface AgentPanelProps {
  open: boolean;
  onClose: () => void;
  flow: AgentFlow | null;
  file: File | null;
  totalPages: number;
  openTool: (id: string, opts?: { focusSection?: string }) => void;
  /** Dispatches a query into the Pre-Discovery / AI Assist panel. */
  onAnswerQuery: (query: string) => void;
}

let stepSeq = 0;
const nextId = () => `st-${Date.now().toString(36)}-${(stepSeq++).toString(36)}`;

function describeChoice(f: AgentFlow): string {
  switch (f.kind) {
    case "detect-redact":
      return f.categories && f.categories.length
        ? `Scan for ${f.categories.join(", ")}`
        : "Scan for all sensitive info";
    case "pattern-redact":
      return `Redact "${f.term}"`;
    case "search":
      return `Search for "${f.term}"`;
    case "sanitize": return "Sanitize document";
    case "bates": return "Add Bates numbers";
    case "ocr": return "Make searchable (OCR)";
    case "repair": return "Repair PDF";
    case "split": return "Split document";
    case "exhibit-binder": return "Assemble exhibit binder";
    case "answer": return "Ask AI Assist";
    case "ambiguous": return "Clarify";
  }
}

export function AgentPanel({
  open,
  onClose,
  flow,
  file,
  totalPages,
  openTool,
  onAnswerQuery,
}: AgentPanelProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [input, setInput] = useState("");
  const [currentFlow, setCurrentFlow] = useState<AgentFlow | null>(null);
  const cachedFindingsRef = useRef<Detection[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortedRef = useRef(false);

  const pushStep = useCallback((s: Step) => {
    setSteps((prev) => [...prev, s]);
  }, []);
  const replaceStep = useCallback((id: string, s: Step) => {
    setSteps((prev) => prev.map((p) => (p.id === id ? s : p)));
  }, []);
  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((p) => p.id !== id));
  }, []);

  /* ---------------- flow runners ---------------- */

  const runDetectRedact = useCallback(
    async (f: AgentFlow & { kind: "detect-redact" }) => {
      if (!file) {
        pushStep({
          kind: "error",
          id: nextId(),
          title: "No document open",
          body: "Open a PDF first, then ask again.",
        });
        return;
      }
      const runId = nextId();
      pushStep({
        kind: "running",
        id: runId,
        label: "Scanning on-device for sensitive info…",
      });
      try {
        const mod = await importChunk(() => import("@/lib/pdf/detect-pii"));
        const { detections, usedOcr, scannedPages, totalPages: total } =
          await mod.detectPiiInPdf(file, 1.5, (p) => {
            replaceStep(runId, {
              kind: "running",
              id: runId,
              label: "Scanning on-device for sensitive info…",
              progress:
                p.stage === "ocr"
                  ? `OCR ${p.page}/${p.totalPages}`
                  : `Reading ${p.page}/${p.totalPages}`,
            });
          });
        if (abortedRef.current) return;

        const cats = f.categories;
        const scope = f.pages ? new Set(f.pages) : null;
        const filtered = detections.filter((d) => {
          if (cats && !cats.includes(d.category)) return false;
          if (scope && !scope.has(d.page)) return false;
          // Never propose auto-redact for context-only signals.
          if (d.category === "privilegeContext") return false;
          if (d.vector && d.vector !== "page") return false;
          return true;
        });
        cachedFindingsRef.current = filtered;

        const label =
          cats && cats.length
            ? cats
                .map((c) => mod.CATEGORY_META[c]?.label ?? c)
                .join(", ")
            : "sensitive info";
        const pagesTouched = new Set(filtered.map((d) => d.page)).size;

        if (filtered.length === 0) {
          const scopeNote = scope
            ? ` on page${scope.size === 1 ? "" : "s"} ${Array.from(scope).join(", ")}`
            : "";
          replaceStep(runId, {
            kind: "result",
            id: runId,
            title: "No matches",
            body: `Didn't find any ${label}${scopeNote}. Scanned ${total} page${total === 1 ? "" : "s"}${usedOcr ? ` (${scannedPages.length} via OCR)` : ""}.`,
            caveat:
              "Automatic detection can miss context-dependent items — a manual review is still a good idea.",
            actions: [
              {
                label: "Open Redact tool for manual review",
                tone: "primary",
                onClick: () => {
                  openTool("redact");
                  onClose();
                },
              },
            ],
          });
          return;
        }

        replaceStep(runId, {
          kind: "result",
          id: runId,
          title: `Found ${filtered.length} ${label} match${filtered.length === 1 ? "" : "es"}`,
          body: `Across ${pagesTouched} page${pagesTouched === 1 ? "" : "s"}${usedOcr && scannedPages.length ? ` · ${scannedPages.length} scanned page${scannedPages.length === 1 ? "" : "s"} read via OCR` : ""}.`,
          caveat:
            "Automatic detection may miss some matches — you can review every finding before anything is redacted.",
        });

        pushStep({
          kind: "propose",
          id: nextId(),
          title: "What next?",
          body: `Nothing has been changed yet. You can review each match, or apply redactions to all ${filtered.length} — the verified burn runs in the Redact tool with a removal-verification gate.`,
          destructive: true,
          actions: [
            {
              label: "Review matches",
              tone: "primary",
              onClick: () => {
                seedRedactTool(cachedFindingsRef.current, false);
                openTool("redact");
                pushStep({
                  kind: "handoff",
                  id: nextId(),
                  title: "Opened Redact tool",
                  body: `${filtered.length} finding${filtered.length === 1 ? "" : "s"} loaded. Review, tick the ones to redact, then click "Redact, export & verify" — that runs the destructive burn with verification.`,
                });
                onClose();
              },
            },
            {
              label: `Redact all ${filtered.length}`,
              tone: "destructive",
              onClick: () => {
                seedRedactTool(cachedFindingsRef.current, true);
                openTool("redact");
                pushStep({
                  kind: "handoff",
                  id: nextId(),
                  title: "Selected — one confirm left",
                  body: `All ${filtered.length} findings loaded and selected in the Redact panel. Click "Redact, export & verify" to apply — the verification gate will refuse the download if any redaction region is still recoverable.`,
                });
                onClose();
              },
            },
            {
              label: "Cancel",
              tone: "ghost",
              onClick: () => onClose(),
            },
          ],
        });
      } catch (err) {
        replaceStep(runId, {
          kind: "error",
          id: runId,
          title: "Scan failed",
          body: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [file, pushStep, replaceStep, openTool, onClose],
  );

  const runPatternRedact = useCallback(
    async (f: AgentFlow & { kind: "pattern-redact" }) => {
      pushStep({
        kind: "propose",
        id: nextId(),
        title: `Redact every occurrence of "${f.term}"?`,
        body: "This opens the Redact tool's Find & Redact section pre-filled with your term. Review the matches, then apply — the verified burn runs there.",
        destructive: true,
        actions: [
          {
            label: "Open in Redact tool",
            tone: "primary",
            onClick: () => {
              try {
                window.dispatchEvent(
                  new CustomEvent("agent:redact-pattern", {
                    detail: { term: f.term },
                  }),
                );
              } catch {
                /* ignore */
              }
              openTool("redact");
              onClose();
            },
          },
          { label: "Cancel", tone: "ghost", onClick: () => onClose() },
        ],
      });
    },
    [pushStep, openTool, onClose],
  );

  const runSimpleHandoff = useCallback(
    (
      title: string,
      body: string,
      buttonLabel: string,
      toolId: string,
      destructive = false,
      focusSection?: string,
    ) => {
      pushStep({
        kind: "propose",
        id: nextId(),
        title,
        body,
        destructive,
        actions: [
          {
            label: buttonLabel,
            tone: destructive ? "destructive" : "primary",
            onClick: () => {
              openTool(toolId, focusSection ? { focusSection } : undefined);
              pushStep({
                kind: "handoff",
                id: nextId(),
                title: `Opened ${buttonLabel.replace(/^Open\s+/, "")}`,
                body: "Follow the confirm inside the panel to apply. The tool reports success or failure with its own verification.",
              });
              onClose();
            },
          },
          { label: "Cancel", tone: "ghost", onClick: () => onClose() },
        ],
      });
    },
    [pushStep, openTool, onClose],
  );

  const runAnswer = useCallback(
    (f: AgentFlow & { kind: "answer" }) => {
      onAnswerQuery(f.query);
      pushStep({
        kind: "handoff",
        id: nextId(),
        title: "Asking AI Assist",
        body: `Routed "${f.query}" to the on-device AI Assist panel. The answer will appear there — nothing about your document leaves this browser.`,
      });
    },
    [onAnswerQuery, pushStep],
  );

  const runSearch = useCallback(
    (f: AgentFlow & { kind: "search" }) => {
      onAnswerQuery(f.term);
      pushStep({
        kind: "handoff",
        id: nextId(),
        title: `Searching for "${f.term}"`,
        body: `Routed to the on-device Pre-Discovery search — results appear in that panel. Nothing about the document leaves this browser.`,
      });
    },
    [onAnswerQuery, pushStep],
  );

  const runFlow = useCallback(
    (f: AgentFlow) => {
      abortedRef.current = false;
      setCurrentFlow(f);
      switch (f.kind) {
        case "detect-redact":
          void runDetectRedact(f);
          break;
        case "pattern-redact":
          void runPatternRedact(f);
          break;
        case "sanitize":
          runSimpleHandoff(
            "Sanitize this document?",
            "Sanitize strips document metadata, hidden layers, form-field values, annotations and revision history. The Sanitize panel shows exactly what will be removed and asks you to confirm before applying.",
            "Open Sanitize",
            "sanitize",
            true,
          );
          break;
        case "bates":
          runSimpleHandoff(
            "Apply Bates numbering?",
            "The Bates panel lets you set a prefix, starting number, and position, then stamps every page. Nothing is applied until you confirm inside the panel.",
            "Open Bates Numbering",
            "bates",
          );
          break;
        case "ocr":
          runSimpleHandoff(
            "Make this document searchable?",
            "OCR runs entirely on-device and adds a hidden text layer over the pages. It's not destructive — the original pixels stay as-is.",
            "Open Make Searchable (OCR)",
            "ocr",
          );
          break;
        case "repair":
          runSimpleHandoff(
            "Try to repair this PDF?",
            "The Repair tool attempts a structural fix and writes a fresh copy. Your original file is not modified.",
            "Open Repair",
            "repair",
          );
          break;
        case "split":
          runSimpleHandoff(
            "Split this document?",
            "The Split tool lets you break the PDF at blank pages, every N pages, or a text pattern. Nothing is written until you confirm inside the panel.",
            "Open Split",
            "split",
          );
          break;
        case "exhibit-binder":
          runSimpleHandoff(
            "Assemble an exhibit binder?",
            "The Exhibit Binder assembles multiple PDFs into a single binder with a cover, tabs and index. Configure and confirm inside the panel.",
            "Open Exhibit Binder",
            "exhibit-binder",
          );
          break;
        case "search":
          runSearch(f);
          break;
        case "answer":
          runAnswer(f);
          break;
        case "ambiguous": {
          const actions: Action[] = f.choices.map((choice) => ({
            label: describeChoice(choice),
            tone: "primary" as const,
            onClick: () => {
              setSteps([]);
              lastFlowRef.current = choice;
              setCurrentFlow(choice);
              try {
                runFlowRef.current(choice);
              } catch (err) {
                console.error("[agent] choice crashed", err);
              }
            },
          }));
          actions.push({
            label: "Cancel",
            tone: "ghost",
            onClick: () => onClose(),
          });
          pushStep({
            kind: "propose",
            id: nextId(),
            title: "Which did you mean?",
            body: f.prompt,
            actions,
          });
          break;
        }
      }
    },
    [runDetectRedact, runPatternRedact, runSimpleHandoff, runAnswer, runSearch, pushStep, onClose],
  );

  /* ---------------- flow lifecycle ---------------- */

  // Only re-run when the flow prop's identity changes (not when
  // callback deps like `openTool`/`onAnswerQuery` change on parent
  // re-renders — those would otherwise re-fire the effect and loop
  // the same flow repeatedly).
  const lastFlowRef = useRef<AgentFlow | null>(null);
  const runFlowRef = useRef(runFlow);
  runFlowRef.current = runFlow;
  useEffect(() => {
    if (!flow) return;
    if (lastFlowRef.current === flow) return;
    lastFlowRef.current = flow;
    console.info("[agent] new flow", { kind: flow.kind });
    setSteps([]);
    cachedFindingsRef.current = [];
    abortedRef.current = false;
    try {
      runFlowRef.current(flow);
    } catch (err) {
      console.error("[agent] flow crashed", err);
      pushStep({
        kind: "error",
        id: nextId(),
        title: "Assistant error",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }, [flow, pushStep]);

  useEffect(() => {
    if (open) return;
    // Clean up any in-flight scan when the panel closes.
    abortedRef.current = true;
  }, [open]);

  // Auto-scroll transcript.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [steps]);

  // Listen for completion signals from the verified Redact tool export.
  useEffect(() => {
    if (!open) return;
    const onDone = (e: Event) => {
      const ce = e as CustomEvent<{
        ok: boolean;
        removed?: number;
        total?: number;
        leaks?: number;
        error?: string;
      }>;
      const d = ce.detail;
      if (!d) return;
      if (d.ok) {
        pushStep({
          kind: "success",
          id: nextId(),
          title: "Redaction verified",
          body: `Removed ${d.removed ?? 0}/${d.total ?? 0} regions. Verification passed and the redacted PDF has downloaded.`,
        });
      } else {
        pushStep({
          kind: "error",
          id: nextId(),
          title: "Verification did not pass",
          body:
            d.error ??
            `${d.leaks ?? 0} region${d.leaks === 1 ? "" : "s"} still recoverable — download was blocked. Review the flagged matches in the Redact panel.`,
        });
      }
    };
    window.addEventListener("agent:redact-complete", onDone as EventListener);
    return () =>
      window.removeEventListener(
        "agent:redact-complete",
        onDone as EventListener,
      );
  }, [open, pushStep]);

  /* ---------------- mid-flow input ---------------- */

  const safeRunFlow = useCallback(
    (f: AgentFlow) => {
      console.info("[agent] dispatch flow", { kind: f.kind });
      // Full reset before each new flow so state from the previous
      // flow can never re-trigger or leak into the new one.
      setSteps([]);
      cachedFindingsRef.current = [];
      abortedRef.current = false;
      lastFlowRef.current = f;
      try {
        runFlowRef.current(f);
      } catch (err) {
        console.error("[agent] flow crashed", err);
        pushStep({
          kind: "error",
          id: nextId(),
          title: "Assistant error",
          body:
            (err instanceof Error ? err.message : String(err)) +
            " — try again or start a new request.",
        });
      }
    },
    [pushStep],
  );

  const submitFollowUp = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setInput("");
      console.info("[agent] follow-up query", text);
      pushStep({ kind: "note", id: nextId(), body: `You: ${text}` });

      if (isCancel(text)) {
        pushStep({
          kind: "note",
          id: nextId(),
          body: "OK — cancelled. Nothing was changed.",
        });
        return;
      }

      // Mid-flow: re-scope current detect-redact by page or add categories.
      if (currentFlow?.kind === "detect-redact") {
        const pages = parsePageScope(text);
        const extraCats = extractAdditionalCategories(text);
        if (pages || extraCats) {
          const nextFlow: AgentFlow = {
            kind: "detect-redact",
            categories: extraCats
              ? [...(currentFlow.categories ?? []), ...extraCats]
              : currentFlow.categories,
            pages: pages ?? currentFlow.pages,
            raw: text,
          };
          setCurrentFlow(nextFlow);
          safeRunFlow(nextFlow);
          return;
        }
      }

      // Otherwise: treat as a new flow request.
      const next = detectAgentFlow(text);
      if (next) {
        setCurrentFlow(next);
        safeRunFlow(next);
      } else {
        pushStep({
          kind: "note",
          id: nextId(),
          body: "I didn't recognize that as a tool request. Try 'find SSNs', 'redact all emails', 'sanitize', 'add bates', 'make searchable', or ask a question.",
        });
      }
    },
    [currentFlow, pushStep, safeRunFlow],
  );

  const scopeNote = useMemo(() => {
    if (currentFlow?.kind === "detect-redact" && currentFlow.pages) {
      return `Scoped to page${currentFlow.pages.length === 1 ? "" : "s"} ${currentFlow.pages.join(", ")}`;
    }
    return null;
  }, [currentFlow]);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto fixed right-4 z-40 flex w-[360px] flex-col rounded-xl border border-border bg-surface-2 shadow-[var(--shadow-float)]"
      style={{
        top: 96,
        maxHeight: "calc(100vh - 170px)",
      }}
      role="dialog"
      aria-label="AI assistant"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-vault/15 text-vault">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-foreground truncate">
            Assistant
          </div>
          <div className="flex items-center gap-1 text-[10px] text-text-muted">
            <Lock className="h-2.5 w-2.5 text-vault" />
            Runs on your device — nothing uploaded
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-muted hover:bg-surface-1 hover:text-foreground"
          aria-label="Close assistant"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {scopeNote && (
        <div className="border-b border-border px-3 py-1.5 text-[10.5px] text-vault">
          {scopeNote} · {totalPages} total
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {steps.map((s) => (
          <StepCard key={s.id} step={s} onDismiss={() => removeStep(s.id)} />
        ))}
        {steps.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-surface-1 p-3 text-[11.5px] text-text-muted">
            Ready. Ask the assistant to find, redact, sanitize, add Bates, OCR
            or repair — nothing state-changing runs without an explicit
            confirm.
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-2 border-t border-border px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitFollowUp(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Adjust or ask a follow-up…"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md p-1 text-vault hover:bg-vault/10 disabled:opacity-50"
          disabled={!input.trim()}
          aria-label="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

/* ---------------- step card ---------------- */

function StepCard({ step, onDismiss }: { step: Step; onDismiss: () => void }) {
  switch (step.kind) {
    case "note":
      return (
        <div className="rounded-md border border-border/50 bg-surface-1/60 px-2.5 py-1.5 text-[11.5px] text-text-2">
          {step.body}
        </div>
      );
    case "running":
      return (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-1 p-2.5">
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-vault" />
          <div className="flex-1 text-[12px] text-foreground">
            <div>{step.label}</div>
            {step.progress && (
              <div className="mt-0.5 text-[10.5px] text-text-muted">
                {step.progress}
              </div>
            )}
          </div>
        </div>
      );
    case "result":
      return (
        <div className="rounded-lg border border-border bg-surface-1 p-2.5">
          <div className="flex items-start gap-2">
            <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.title}
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
              {step.caveat && (
                <div className="mt-1.5 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 text-[10.5px] text-amber-500/90">
                  {step.caveat}
                </div>
              )}
            </div>
          </div>
          {step.actions && <ActionRow actions={step.actions} />}
        </div>
      );
    case "propose":
      return (
        <div
          className={`rounded-lg border p-2.5 ${
            step.destructive
              ? "border-amber-500/40 bg-amber-500/[0.06]"
              : "border-border bg-surface-1"
          }`}
        >
          <div className="flex items-start gap-2">
            {step.destructive ? (
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            ) : (
              <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
            )}
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.title}
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
            </div>
          </div>
          <ActionRow actions={step.actions} destructive={step.destructive} />
        </div>
      );
    case "handoff":
      return (
        <div className="rounded-lg border border-vault/40 bg-vault/[0.06] p-2.5">
          <div className="flex items-start gap-2">
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.title}
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
            </div>
          </div>
        </div>
      );
    case "success":
      return (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/[0.06] p-2.5">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.title}
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
            </div>
          </div>
        </div>
      );
    case "error":
      return (
        <div className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-2.5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.title}
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
              <button
                type="button"
                onClick={onDismiss}
                className="mt-1.5 text-[10.5px] text-text-muted hover:text-foreground underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      );
  }
}

function ActionRow({
  actions,
  destructive,
}: {
  actions: Action[];
  destructive?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map((a, i) => {
        const tone = a.tone ?? "primary";
        const cls =
          tone === "destructive"
            ? "border border-amber-500/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25"
            : tone === "ghost"
              ? "border border-border bg-transparent text-text-2 hover:bg-surface-1"
              : "border border-vault/50 bg-vault/15 text-foreground hover:bg-vault/25";
        return (
          <button
            key={i}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${cls}`}
            data-destructive={destructive && tone === "destructive" ? "true" : undefined}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- seed helper ---------------- */

function seedRedactTool(findings: Detection[], autoSelect: boolean) {
  try {
    window.dispatchEvent(
      new CustomEvent("agent:redact-seed", {
        detail: { findings, autoSelect },
      }),
    );
  } catch {
    /* ignore */
  }
}

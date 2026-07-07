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
  FileText,
  ChevronDown,
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
import { classifyAssistQuery, type AssistCtx } from "@/lib/assist/router";
import type { AssistToolEntry, AssistTopicEntry } from "@/lib/assist/knowledge-base";
import { useIsPro } from "@/lib/pro-gate";
import { useUpgradeModal } from "@/components/upgrade-modal";
import { useNavigate } from "@tanstack/react-router";


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
  | {
      kind: "pro-gate";
      id: string;
      featureName: string;
      body: string;
      onUpgrade: () => void;
    }
  | {
      kind: "find-results";
      id: string;
      term: string;
      matches: Array<{ page: number; snippet: string }>;
      caveat?: string;
      actions?: Action[];
    }
  | { kind: "error"; id: string; title: string; body: string };

/** Flow → Pro feature descriptor. Free flows return null. */
function proGateFor(
  f: AgentFlow,
): { featureName: string; body: string } | null {
  switch (f.kind) {
    case "detect-redact":
      return {
        featureName: "AI sensitive-data detection",
        body: "Automatically scans your document on-device to find every SSN, email, phone number, financial account, and other sensitive value — then lets you review and redact any or all of them with the verified burn. Nothing uploads.",
      };
    case "pattern-redact":
      return {
        featureName: "Pattern & bulk redaction",
        body: "Finds every occurrence of a word, phrase, or regex across the whole document and lets you redact them all in one pass with the verified burn. Runs entirely in your browser.",
      };
    case "exhibit-binder":
      return {
        featureName: "Exhibit Binder",
        body: "Assembles multiple PDFs into a court-ready binder with a cover page, tabbed exhibits, and an index — all built on-device.",
      };
    // NOTE: `split` is NOT Pro-gated as a whole tool — only the AI/
    // smart-select mode inside the Split panel is Pro. The Split panel
    // handles that gate at the point-of-use, so the assistant just
    // hands off.

    case "search":
    case "answer":
      return {
        featureName: "Private AI assist & search",
        body: "Asks questions of your document and finds passages by meaning (not just keywords), using on-device embeddings. Your document never leaves this browser.",
      };
    default:
      return null;
  }
}

function proGateForEntry(entry: AssistToolEntry): { featureName: string; body: string } | null {
  if (entry.availability !== "pro") return null;
  return {
    featureName: entry.proFeatureName ?? entry.displayName,
    body:
      entry.upgradeCopy ??
      `${entry.displayName} is a Pro feature. You can still ask what it does, but running it requires Pro.`,
  };
}

function answerForEntry(entry: AssistToolEntry): string {
  if (entry.availability === "mixed" && entry.freeModes?.length) {
    return `${entry.answer} Free modes: ${entry.freeModes.join(", ")}.`;
  }
  return entry.answer;
}


export interface AgentPanelProps {
  open: boolean;
  onClose: () => void;
  flow: AgentFlow | null;
  query: { id: number; text: string } | null;
  docId: string | null;
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
  query,
  docId,
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
  const querySeqRef = useRef(0);
  const assistCtxRef = useRef<AssistCtx>({});
  const isPro = useIsPro();
  const openUpgradeModal = useUpgradeModal((s) => s.openModal);
  const navigate = useNavigate();


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

  const metaLineFor = useCallback((entry: AssistToolEntry): string | undefined => {
    if (!entry.pricing && !entry.privacy && entry.runsOffline === undefined) return undefined;
    const bits: string[] = [];
    if (entry.availability === "free") bits.push("Free");
    else if (entry.availability === "pro") bits.push("Pro");
    else bits.push("Free + Pro");
    if (entry.requiresNetwork === "never") bits.push("Runs offline");
    else if (entry.requiresNetwork === "first-load") bits.push("Model downloads once, then offline");
    bits.push("Nothing leaves your device");
    return bits.join(" • ");
  }, []);

  const resetAssistCtxAction = useCallback((): Action => ({
    label: "Ask something else",
    tone: "ghost",
    onClick: () => {
      assistCtxRef.current = {};
      setSteps([]);
    },
  }), []);

  const showEntryHelp = useCallback(
    (
      entry: AssistToolEntry,
      mode: "help" | "open" | "use",
      seedSteps: Step[],
      opts?: { corrected?: { from: string; to: string }; followUp?: boolean; originalQuery?: string },
    ) => {
      const gate = proGateForEntry(entry);
      const isProEntryForFreeUser = !!gate && !isPro;
      const actions: Action[] = [];

      if (!isProEntryForFreeUser) {
        actions.push({
          label: mode === "help" ? `Open ${entry.displayName}` : "Open tool",
          tone: "primary",
          onClick: () => {
            openTool(entry.toolId, entry.focusSection ? { focusSection: entry.focusSection } : undefined);
            onClose();
          },
        });
      }
      if (opts?.followUp) actions.push(resetAssistCtxAction());
      actions.push({ label: "Close", tone: "ghost", onClick: () => onClose() });

      const caveatParts: string[] = [];
      if (opts?.followUp) caveatParts.push(`Following up on ${entry.displayName}.`);
      if (opts?.corrected) caveatParts.push(`Interpreted "${opts.corrected.from}" as "${opts.corrected.to}".`);
      const availabilityCaveat =
        entry.availability === "mixed"
          ? entry.upgradeCopy
          : entry.availability === "pro"
            ? "This tool is a Pro feature. You can ask about what it does on any plan."
            : undefined;
      if (availabilityCaveat) caveatParts.push(availabilityCaveat);
      const meta = metaLineFor(entry);
      if (meta) caveatParts.push(meta);

      const nextSteps: Step[] = [
        ...seedSteps,
        {
          kind: "result",
          id: nextId(),
          title: entry.displayName,
          body: answerForEntry(entry),
          caveat: caveatParts.length ? caveatParts.join(" • ") : undefined,
          actions,
        },
      ];

      if (isProEntryForFreeUser && gate) {
        nextSteps.push({
          kind: "pro-gate",
          id: nextId(),
          featureName: gate.featureName,
          body: gate.body,
          onUpgrade: () => openUpgradeModal({ featureName: gate.featureName }),
        });
      }

      setSteps(nextSteps);
      cachedFindingsRef.current = [];
      lastFlowRef.current = null;
      setCurrentFlow(null);
      assistCtxRef.current = {
        lastEntryId: entry.id,
        lastQuery: opts?.originalQuery ?? entry.displayName,
      };
    },
    [isPro, metaLineFor, onClose, openTool, openUpgradeModal, resetAssistCtxAction],
  );

  const showTopicAnswer = useCallback(
    (
      topic: AssistTopicEntry,
      seedSteps: Step[],
      opts?: { followUp?: boolean; originalQuery?: string },
    ) => {
      const actions: Action[] = [];
      for (const a of topic.actions ?? []) {
        if (a.kind === "open-upgrade") {
          actions.push({ label: a.label, tone: "primary", onClick: () => openUpgradeModal({}) });
        } else if (a.href) {
          actions.push({
            label: a.label,
            tone: "primary",
            onClick: () => {
              navigate({ to: a.href! });
              onClose();
            },
          });
        }
      }
      if (opts?.followUp) actions.push(resetAssistCtxAction());
      actions.push({ label: "Close", tone: "ghost", onClick: () => onClose() });

      const caveat = opts?.followUp ? `Following up on ${topic.displayName}.` : undefined;

      setSteps([
        ...seedSteps,
        {
          kind: "result",
          id: nextId(),
          title: topic.displayName,
          body: topic.answer,
          caveat,
          actions,
        },
      ]);
      cachedFindingsRef.current = [];
      lastFlowRef.current = null;
      setCurrentFlow(null);
      assistCtxRef.current = {
        lastTopicId: topic.id,
        lastQuery: opts?.originalQuery ?? topic.displayName,
      };
    },
    [navigate, onClose, openUpgradeModal, resetAssistCtxAction],
  );

  const alternateActions = useCallback(
    (
      seedSteps: Step[],
      alternates: Array<{ lane: "literal" | "semantic" | "action" | "help"; label: string }> | undefined,
      term: string,
    ): Action[] => {
      if (!alternates?.length) return [];
      const out: Action[] = [];
      for (const alt of alternates) {
        if (alt.lane === "semantic") {
          out.push({
            label: alt.label,
            tone: "ghost",
            onClick: () =>
              showSemanticPitch(
                { kind: "semantic", query: term, reason: `Interpreting "${term}" as a meaning-based search.` },
                seedSteps,
                term,
              ),
          });
        } else if (alt.lane === "literal") {
          out.push({
            label: alt.label,
            tone: "ghost",
            onClick: () =>
              void showLiteralFind(
                {
                  kind: "literal",
                  term,
                  wholeWord: false,
                  regex: false,
                  reason: `Searching for the exact text “${term}”.`,
                },
                seedSteps,
                term,
              ),
          });
        } else if (alt.lane === "action") {
          out.push({
            label: alt.label,
            tone: "ghost",
            onClick: () => {
              try {
                window.dispatchEvent(
                  new CustomEvent("agent:redact-pattern", { detail: { term } }),
                );
              } catch { /* ignore */ }
              openTool("redact");
              onClose();
            },
          });
        }
      }
      return out;
    },
    // Refers to showLiteralFind / showSemanticPitch which are defined below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose, openTool],
  );

  const showLiteralFind = useCallback(
    async (
      classified: { kind: "literal"; term: string; wholeWord: boolean; regex: boolean; reason: string; alternates?: Array<{ lane: "literal" | "semantic" | "action" | "help"; label: string }> },
      seedSteps: Step[],
      originalQuery: string,
    ) => {
      if (!file) {
        setSteps([
          ...seedSteps,
          {
            kind: "error",
            id: nextId(),
            title: "No document open",
            body: "Open a PDF first, then ask me to find text in it.",
          },
        ]);
        return;
      }
      const runId = nextId();
      setSteps([
        ...seedSteps,
        { kind: "running", id: runId, label: `Searching for “${classified.term}”…` },
      ]);
      try {
        const { findLiteralInPdf } = await importChunk(() => import("@/lib/assist/find"));
        const matches = await findLiteralInPdf(file, classified.term, {
          wholeWord: classified.wholeWord,
          regex: classified.regex,
          maxMatches: 30,
        });
        const actions: Action[] = [];
        if (matches.length > 0) {
          const canRedact = isPro; // pattern-bulk-redact is Pro
          actions.push({
            label: canRedact ? "Redact all matches" : "Redact all matches (Pro)",
            tone: canRedact ? "destructive" : "primary",
            onClick: () => {
              if (!canRedact) {
                openUpgradeModal({ featureName: "Pattern / bulk redaction" });
                return;
              }
              try {
                window.dispatchEvent(
                  new CustomEvent("agent:redact-pattern", { detail: { term: classified.term } }),
                );
              } catch { /* ignore */ }
              openTool("redact");
              onClose();
            },
          });
        }
        actions.push(...alternateActions(seedSteps, classified.alternates, classified.term));
        actions.push({ label: "Close", tone: "ghost", onClick: () => onClose() });

        if (matches.length === 0) {
          setSteps([
            ...seedSteps,
            {
              kind: "result",
              id: nextId(),
              title: `No matches for “${classified.term}”`,
              body: "Nothing in this document contains that text. Try a different spelling, drop quotes, or switch to meaning-based search.",
              caveat: classified.reason,
              actions,
            },
          ]);
        } else {
          setSteps([
            ...seedSteps,
            {
              kind: "find-results",
              id: nextId(),
              term: classified.term,
              matches: matches.map((m) => ({ page: m.page, snippet: m.snippet })),
              caveat: classified.reason,
              actions,
            },
          ]);
        }
        assistCtxRef.current = {
          lastLane: "literal",
          lastFindTerm: classified.term,
          lastFindMatches: matches.map((m) => ({ page: m.page, snippet: m.snippet })),
          lastQuery: originalQuery,
        };
      } catch (err) {
        setSteps([
          ...seedSteps,
          {
            kind: "error",
            id: nextId(),
            title: "Search failed",
            body: err instanceof Error ? err.message : String(err),
          },
        ]);
      }
    },
    [alternateActions, file, isPro, onClose, openTool, openUpgradeModal],
  );

  const showSemanticPitch = useCallback(
    (
      classified: { kind: "semantic"; query: string; reason: string; alternates?: Array<{ lane: "literal" | "semantic" | "action" | "help"; label: string }> },
      seedSteps: Step[],
      originalQuery: string,
    ) => {
      const actions: Action[] = [];
      if (isPro) {
        actions.push({
          label: "Open in AI search",
          tone: "primary",
          onClick: () => {
            onAnswerQuery(classified.query);
            onClose();
          },
        });
      } else {
        actions.push({
          label: "Unlock AI search (Pro)",
          tone: "primary",
          onClick: () => openUpgradeModal({ featureName: "Private AI assist & search" }),
        });
      }
      actions.push(...alternateActions(seedSteps, classified.alternates, classified.query));
      actions.push({ label: "Close", tone: "ghost", onClick: () => onClose() });

      setSteps([
        ...seedSteps,
        {
          kind: "result",
          id: nextId(),
          title: "Search by meaning",
          body: isPro
            ? `Open Private AI assist to search for “${classified.query}” by meaning. Runs on-device.`
            : `Meaning-based search is a Pro feature. Free users can run a literal find instead.`,
          caveat: classified.reason,
          actions,
        },
      ]);
      assistCtxRef.current = {
        lastLane: "semantic",
        lastQuery: originalQuery,
      };
    },
    [alternateActions, isPro, onAnswerQuery, onClose, openUpgradeModal],
  );


  const runAssistQuery = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const seq = ++querySeqRef.current;
      const echo: Step = { kind: "note", id: nextId(), body: `You: ${text}` };
      const runId = nextId();

      setInput("");
      setSteps([
        echo,
        {
          kind: "running",
          id: runId,
          label: "Understanding tool request…",
          progress: "Setting up AI appears only if the one-time model cache is missing.",
        },
      ]);
      cachedFindingsRef.current = [];
      lastFlowRef.current = null;
      setCurrentFlow(null);
      abortedRef.current = false;

      try {
        const classified = await classifyAssistQuery(text, assistCtxRef.current);
        if (seq !== querySeqRef.current || abortedRef.current) return;

        if (classified.kind === "clarify") {
          setSteps([
            echo,
            {
              kind: "propose",
              id: runId,
              title: "Which tool did you mean?",
              body: classified.reason,
              actions: [
                ...classified.options.map<Action>((entry) => ({
                  label: entry.displayName,
                  tone: "primary",
                  onClick: () => showEntryHelp(entry, "help", [echo], { originalQuery: text }),
                })),
                { label: "Cancel", tone: "ghost", onClick: () => onClose() },
              ],
            },
          ]);
          return;
        }

        if (classified.kind === "clarify-typo") {
          setSteps([
            echo,
            {
              kind: "propose",
              id: runId,
              title: "Did you mean…?",
              body: `I don't recognize "${classified.original}". Pick the closest match:`,
              actions: [
                ...classified.suggestions.map<Action>((entry) => ({
                  label: entry.displayName,
                  tone: "primary",
                  onClick: () => showEntryHelp(entry, "help", [echo], { originalQuery: text }),
                })),
                { label: "Cancel", tone: "ghost", onClick: () => onClose() },
              ],
            },
          ]);
          return;
        }

        if (classified.kind === "topic") {
          showTopicAnswer(classified.topic, [echo], {
            followUp: classified.followUp,
            originalQuery: text,
          });
          return;
        }

        if (classified.kind === "literal") {
          void showLiteralFind(classified, [echo], text);
          return;
        }

        if (classified.kind === "semantic") {
          showSemanticPitch(classified, [echo], text);
          return;
        }

        const { entry, mode, corrected, followUp, stagedTerm } = classified;

        // Cross-lane follow-up: "redact them" after a literal find →
        // hand off to Redact's Find & Redact section with the term.
        if (stagedTerm && entry.id === "redact") {
          const gate = proGateForEntry(entry);
          const blocked = !!gate && !isPro;
          if (!blocked) {
            try {
              window.dispatchEvent(
                new CustomEvent("agent:redact-pattern", { detail: { term: stagedTerm } }),
              );
            } catch { /* ignore */ }
            openTool("redact");
            onClose();
            return;
          }
        }

        const gate = proGateForEntry(entry);
        const blocked = !!gate && !isPro;

        if (!blocked && mode !== "help") {
          openTool(entry.toolId, entry.focusSection ? { focusSection: entry.focusSection } : undefined);
          onClose();
          return;
        }

        showEntryHelp(entry, mode, [echo], { corrected, followUp, originalQuery: text });
      } catch (err) {
        if (seq !== querySeqRef.current || abortedRef.current) return;
        setSteps([
          echo,
          {
            kind: "error",
            id: runId,
            title: "Assistant error",
            body: err instanceof Error ? err.message : String(err),
          },
        ]);
      }
    },
    [isPro, onClose, openTool, showEntryHelp, showLiteralFind, showSemanticPitch, showTopicAnswer],
  );





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
        const { detectPiiInPdfViaWorker } = await importChunk(
          () => import("@/lib/workers/detect-pii-client"),
        );
        const { runAsJob } = await import("@/lib/jobs/registry");
        const ownerDocId = docId ?? `${file.name}:${file.size}`;
        const { promise } = runAsJob(
          { kind: "detect-pii", docId: ownerDocId, docLabel: file.name },
          async ({ signal, onProgress }) => {
            return await detectPiiInPdfViaWorker(file, 1.5, (p) => {
              const t = p.totalPages || 1;
              onProgress({
                fraction: t ? p.page / t : 0,
                step: p.stage === "ocr" ? `OCR ${p.page}/${t}` : `${p.pass ?? "text"} ${p.page}/${t}`,
              });
              const found = p.foundSoFar ?? 0;
              replaceStep(runId, {
                kind: "running",
                id: runId,
                label: "Scanning on-device for sensitive info…",
                progress:
                  p.stage === "ocr"
                    ? `OCR ${p.page}/${p.totalPages} · ${found} found`
                    : p.pass === "ner"
                      ? `Names ${p.page}/${p.totalPages} · ${found} found`
                      : `Scanning ${p.page}/${p.totalPages} · ${found} found`,
              });
            }, signal);
          },

        );
        const { detections, usedOcr, scannedPages, totalPages: total } = await promise;
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
    [file, docId, pushStep, replaceStep, openTool, onClose],
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
      onClose();
    },
    [onAnswerQuery, pushStep, onClose],
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
      onClose();
    },
    [onAnswerQuery, pushStep, onClose],
  );


  const runFlow = useCallback(
    (f: AgentFlow) => {
      abortedRef.current = false;
      setCurrentFlow(f);
      // Pro gate: intercept before any work is done. Show a Pro action
      // card in the assistant with the feature description + Upgrade /
      // Not now. The gated action never runs and no success is claimed.
      const gate = proGateFor(f);
      if (gate && !isPro) {
        pushStep({
          kind: "pro-gate",
          id: nextId(),
          featureName: gate.featureName,
          body: gate.body,
          onUpgrade: () => {
            openUpgradeModal({ featureName: gate.featureName });
          },
        });
        return;
      }
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
    [runDetectRedact, runPatternRedact, runSimpleHandoff, runAnswer, runSearch, pushStep, onClose, isPro, openUpgradeModal],
  );

  /* ---------------- flow lifecycle ---------------- */

  // Only re-run when the flow prop's identity changes (not when
  // callback deps like `openTool`/`onAnswerQuery` change on parent
  // re-renders — those would otherwise re-fire the effect and loop
  // the same flow repeatedly).
  const lastFlowRef = useRef<AgentFlow | null>(null);
  const lastQueryRef = useRef<number | null>(null);
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
    if (!open || !query) return;
    if (lastQueryRef.current === query.id) return;
    lastQueryRef.current = query.id;
    void runAssistQuery(query.text);
  }, [open, query, runAssistQuery]);

  useEffect(() => {
    if (open) return;
    // Clean up any in-flight scan when the panel closes.
    abortedRef.current = true;
    querySeqRef.current += 1;
    assistCtxRef.current = {};
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
    (f: AgentFlow, seedSteps: Step[] = []) => {
      console.info("[agent] dispatch flow", { kind: f.kind });
      // Full reset before each new flow so state from the previous
      // flow can never re-trigger or leak into the new one. seedSteps
      // (e.g. the "You: …" echo of the incoming query) is preserved
      // so the transcript still shows what was asked.
      setSteps(seedSteps);
      cachedFindingsRef.current = [];
      abortedRef.current = false;
      lastFlowRef.current = f;
      setCurrentFlow(f);
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
      const echo: Step = { kind: "note", id: nextId(), body: `You: ${text}` };

      if (isCancel(text)) {
        setSteps([
          echo,
          {
            kind: "note",
            id: nextId(),
            body: "OK — cancelled. Nothing was changed.",
          },
        ]);
        cachedFindingsRef.current = [];
        lastFlowRef.current = null;
        setCurrentFlow(null);
        return;
      }

      // Try semantic tool-help routing FIRST. A new query always starts a
      // clean request so stale Pro cards or late model responses cannot leak.
      void runAssistQuery(text);
    },
    [runAssistQuery],
  );


  const scopeNote = useMemo(() => {
    if (currentFlow?.kind === "detect-redact" && currentFlow.pages) {
      return `Scoped to page${currentFlow.pages.length === 1 ? "" : "s"} ${currentFlow.pages.join(", ")}`;
    }
    return null;
  }, [currentFlow]);

  if (!open) return null;

  return (
    <aside
      className="relative z-20 flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface-1"
      role="dialog"
      aria-label="AI assistant"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
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
            Ready. Ask about any tool, or tell the assistant what to open.
            Tool questions work on every plan; Pro actions show upgrade options.
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
    </aside>
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
    case "pro-gate":
      return (
        <div className="rounded-lg border border-vault/50 bg-vault/[0.08] p-2.5">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vault" />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-foreground">
                {step.featureName} is a Pro feature
              </div>
              <div className="mt-0.5 text-[11.5px] text-text-2">{step.body}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={step.onUpgrade}
                  className="rounded-md border border-vault/60 bg-vault/20 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-vault/30"
                >
                  Upgrade to Pro
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px] font-medium text-text-2 transition-colors hover:bg-surface-1"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        </div>
      );

    case "find-results":
      return <FindResultsCard step={step} />;

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

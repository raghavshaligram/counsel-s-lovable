/**
 * AI Assist classifier verification.
 *
 * Runs classifyAssistQuery against known-good inputs and prints PASS/FAIL.
 * The router calls embedTexts() from @/lib/discovery/client; we stub that
 * so the check is offline-safe. Fuzzy + exact + topic + follow-up paths
 * don't touch embeddings, and semantic-only cases fall back to a
 * deterministic zero vector (which lands in the clarify path — expected).
 *
 * Run: bunx tsx scripts/verify-assist-router.ts
 */
import { mock } from "bun:test";

mock.module("@/lib/discovery/client", () => ({
  embedTexts: async (texts: string[]) => texts.map(() => new Float32Array(384)),
}));

const { classifyAssistQuery } = await import("../src/lib/assist/router");

type Case = {
  name: string;
  input: string;
  ctx?: { lastEntryId?: string; lastTopicId?: string; lastQuery?: string };
  expect: (c: Awaited<ReturnType<typeof classifyAssistQuery>>) => string | null;
};

const CASES: Case[] = [
  // Typos → clarify-typo with suggestions
  ...(
    [
      ["typo: santize → sanitize", "santize", "sanitize"],
      ["typo: reduct → redact", "reduct", "redact"],
      ["typo: watermak → watermark", "watermak", "watermark"],
      ["typo: outlin → outline", "outlin", "outline"],
    ] as const
  ).map<Case>(([name, input, wantId]) => ({
    name,
    input,
    expect: (c) => {
      if (c.kind === "tool" && (c.entry.id === wantId || c.entry.toolId === wantId)) return null;
      if (c.kind === "clarify-typo" && c.suggestions.some((s) => s.id === wantId || s.toolId === wantId)) return null;
      return `expected ${wantId}, got ${c.kind}${"entry" in c ? `:${c.entry.id}` : ""}`;
    },
  })),
  {
    name: "typo: compair versions → compare",
    input: "compair versions",
    expect: (c) => {
      if (c.kind === "tool" && c.entry.id === "compare") return null;
      if (c.kind === "clarify-typo" && c.suggestions.some((s) => s.id === "compare")) return null;
      return `expected compare, got ${c.kind}`;
    },
  },

  // Topics
  { name: "topic: how much is pro → pricing", input: "how much is pro",
    expect: (c) => c.kind === "topic" && c.topic.id === "pricing" ? null : `got ${c.kind}` },
  { name: "topic: does it work offline → offline", input: "does it work offline",
    expect: (c) => c.kind === "topic" && c.topic.id === "offline" ? null : `got ${c.kind}` },
  { name: "topic: is my file uploaded → privacy", input: "is my file uploaded",
    expect: (c) => c.kind === "topic" && c.topic.id === "privacy" ? null : `got ${c.kind}` },
  { name: "topic: what model do you use → models", input: "what model do you use",
    expect: (c) => c.kind === "topic" && c.topic.id === "models" ? null : `got ${c.kind}` },

  // Tools
  { name: "tool: compare two pdfs → compare", input: "compare two pdfs",
    expect: (c) => c.kind === "tool" && c.entry.id === "compare" ? null : `got ${c.kind}` },
  { name: "tool: add bookmarks → outline", input: "add bookmarks",
    expect: (c) => c.kind === "tool" && c.entry.id === "outline" ? null : `got ${c.kind}` },
  { name: "tool: crop pages → page-crop", input: "crop pages",
    expect: (c) => c.kind === "tool" && (c.entry.id === "page-crop" || c.entry.toolId === "page-crop") ? null : `got ${c.kind}` },
  { name: "tool: smart split → smart-split", input: "smart split",
    expect: (c) => c.kind === "tool" && c.entry.id === "smart-split" ? null : `got ${c.kind}` },
  { name: "tool: chat with this pdf → chat", input: "chat with this pdf",
    expect: (c) => c.kind === "tool" && c.entry.id === "chat" ? null : `got ${c.kind}` },

  // Follow-ups (ctx = Redact) — must be sticky, NOT the clarify fallback
  ...(
    [
      ["follow-up: adjust", "adjust"],
      ["follow-up: more info", "more info"],
      ["follow-up: does it work offline?", "does it work offline?"],
      ["follow-up: how do I do that?", "how do I do that?"],
      ["follow-up: what about free users?", "what about free users?"],
    ] as const
  ).map<Case>(([name, input]) => ({
    name,
    input,
    ctx: { lastEntryId: "redact", lastQuery: "what is redact" },
    expect: (c) => {
      if (c.kind === "clarify") return `sticky failed — fell to clarify`;
      if (c.kind === "clarify-typo") return `sticky failed — fell to clarify-typo`;
      if (c.kind === "topic") return null; // acceptable if a topic legitimately wins
      if (c.kind === "tool" && c.entry.id === "redact" && c.followUp) return null;
      return `expected sticky Redact follow-up, got ${c.kind}${"entry" in c ? `:${c.entry.id} followUp=${c.followUp}` : ""}`;
    },
  })),

  // Lane routing
  { name: `lane: find "contract" → literal`, input: `find "contract"`,
    expect: (c) => c.kind === "literal" && c.term === "contract" ? null : `got ${c.kind}` },
  { name: "lane: search for the word John → literal", input: "search for the word John",
    expect: (c) => c.kind === "literal" && c.term === "John" ? null : `got ${c.kind}` },
  { name: "lane: find sensitive contracts → semantic", input: "find sensitive contracts",
    expect: (c) => c.kind === "semantic" ? null : `got ${c.kind}` },
  { name: "lane: passages about damages → semantic", input: "find passages about damages",
    expect: (c) => c.kind === "semantic" ? null : `got ${c.kind}` },
  { name: "lane: find contracts (ambiguous) → literal with alternates",
    input: "find contracts",
    expect: (c) => c.kind === "literal" && (c.alternates?.length ?? 0) >= 2 ? null : `got ${c.kind}` },
  { name: "lane: redact SSNs → action redact", input: "redact SSNs",
    expect: (c) => c.kind === "tool" && c.entry.id === "redact" ? null : `got ${c.kind}` },

  // Cross-lane follow-up: after literal find, "redact them" → action with stagedTerm
  { name: "cross-lane: redact them (after literal contract)",
    input: "now redact them",
    ctx: { lastLane: "literal", lastFindTerm: "contract", lastQuery: `find "contract"` },
    expect: (c) =>
      c.kind === "tool" && c.entry.id === "redact" && c.stagedTerm === "contract"
        ? null
        : `got ${c.kind}${"entry" in c ? `:${c.entry.id}` : ""} stagedTerm=${"stagedTerm" in c ? c.stagedTerm : "-"}`,
  },

  // Regression
  { name: "regression: what is redact → redact help", input: "what is redact",
    expect: (c) => c.kind === "tool" && c.entry.id === "redact" && c.mode === "help" ? null : `got ${c.kind}` },
];

let passed = 0, failed = 0;
for (const cse of CASES) {
  try {
    const result = await classifyAssistQuery(cse.input, cse.ctx);
    const err = cse.expect(result);
    if (err) {
      failed++;
      console.log(`FAIL ${cse.name} — ${err}`);
    } else {
      passed++;
      console.log(`PASS ${cse.name}`);
    }
  } catch (e) {
    failed++;
    console.log(`FAIL ${cse.name} — threw: ${(e as Error).message}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed (${CASES.length} total)`);
if (failed > 0) process.exit(1);

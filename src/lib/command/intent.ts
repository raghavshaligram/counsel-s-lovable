/**
 * Command-bar intent router — semantic (MiniLM embeddings, on-device).
 *
 * Each intent is defined by a small set of example phrases. The user's
 * input is embedded with the same MiniLM model already loaded for
 * Pre-Discovery, then matched to the closest intent by cosine similarity
 * against the example anchors. No keyword lists, no LLM calls — meaning
 * comes from the embedding space (e.g. "looks like pdf is corrupted"
 * matches REPAIR without any regex hit on "repair").
 *
 * Confidence guard: if the top score is below MIN_ABS OR too close to
 * the runner-up (GAP), we return `ambiguous` with the top-2 options so
 * the user disambiguates. Destructive intents (redact/sanitize) never
 * auto-execute — the router only proposes; the popover confirms.
 *
 * A synchronous keyword fallback (`classifyCommand`) is kept for the
 * moment before the model finishes loading, so the bar never feels
 * broken. Once the model is warm, `classifyCommandSemantic` is used.
 */

import { embedTexts } from "@/lib/discovery/client";

export type ActionToolId =
  | "redact"
  | "bates"
  | "sanitize"
  | "sign"
  | "watermark"
  | "ocr"
  | "protect"
  | "unlock"
  | "compress"
  | "extract"
  | "merge"
  | "split"
  | "rotate"
  | "repair"
  | "document-hash"
  | "compare"
  | "organize"
  | "workflow-builder";

export type Intent =
  | {
      kind: "action";
      toolId: ActionToolId;
      title: string;
      description: string;
      destructive: boolean;
      raw: string;
    }
  | { kind: "question"; query: string; raw: string }
  | { kind: "search"; query: string; raw: string }
  | { kind: "chitchat"; raw: string; reply: string }
  | {
      kind: "ambiguous";
      raw: string;
      options: Intent[];
      reason: string;
    };

/* --------------------------- semantic anchors --------------------------- */

type Route =
  | { kind: "action"; toolId: ActionToolId; destructive: boolean; title: string; description: string }
  | { kind: "question" }
  | { kind: "search" };

interface IntentDef {
  id: string;
  route: Route;
  examples: string[];
}

/**
 * Anchor phrases per intent. Keep these SHORT and NATURAL — the model
 * matches on meaning, not on keyword overlap. 3–6 examples per intent
 * spread across the semantic neighborhood is plenty for MiniLM.
 */
const INTENTS: IntentDef[] = [
  {
    id: "search",
    route: { kind: "search" },
    examples: [
      "find mentions of the parties",
      "find every reference to damages",
      "find ssn",
      "find social security numbers",
      "find phone numbers",
      "find any dates",
      "find the settlement amount",
      "where does the document discuss damages",
      "locate every reference to the contract",
      "show me passages about liability",
      "look for anything related to indemnification",
      "search for environmental liability",
      "anything about arbitration",
    ],
  },
  {
    id: "question",
    route: { kind: "question" },
    examples: [
      "summarize this document",
      "what are the key points",
      "explain the main arguments",
      "what is this file about",
      "give me an overview of the case",
      "who are the parties involved",
      "what are the important dates",
      "what is the settlement amount",
    ],
  },
  {
    id: "workflow-builder",
    route: {
      kind: "action",
      toolId: "workflow-builder",
      destructive: false,
      title: "Open Workflow Builder",
      description:
        "Open Workflow Builder to chain steps (e.g. redact → bates → watermark → export) and run them against one file or a batch.",
    },
    examples: [
      "automate this document",
      "can we automate documents",
      "build an automated workflow",
      "chain several actions together",
      "save a repeatable process",
      "run a batch job on many pdfs",
      "set up a recurring task",
    ],
  },
  {
    id: "redact",
    route: {
      kind: "action",
      toolId: "redact",
      destructive: true,
      title: "Open Redact tool",
      description:
        "Open the Redact panel to auto-detect matches. You'll review and apply from there — nothing is redacted yet.",
    },
    examples: [
      "redact all social security numbers",
      "redact every ssn",
      "redact phone numbers",
      "black out phone numbers",
      "mask personal information",
      "hide client names",
      "remove sensitive data from this pdf",
      "cover up confidential information",
    ],
  },
  {
    id: "sanitize",
    route: {
      kind: "action",
      toolId: "sanitize",
      destructive: true,
      title: "Open Sanitize",
      description: "Open Sanitize to strip metadata, hidden layers, comments and revisions. You'll confirm before it applies.",
    },
    examples: [
      "remove metadata from this file",
      "strip hidden information",
      "clean up tracked changes and comments",
      "scrub author and revision history",
    ],
  },
  {
    id: "repair",
    route: {
      kind: "action",
      toolId: "repair",
      destructive: false,
      title: "Open Repair PDF",
      description: "Open Repair to attempt fixing structural issues in a broken or corrupted PDF.",
    },
    examples: [
      "this pdf looks corrupted",
      "the file will not open properly",
      "fix a broken document",
      "repair a damaged pdf",
      "something is wrong with this file",
    ],
  },
  {
    id: "compress",
    route: {
      kind: "action",
      toolId: "compress",
      destructive: false,
      title: "Open Compress",
      description: "Open Compress to reduce the PDF's file size.",
    },
    examples: [
      "make this file smaller",
      "shrink the pdf",
      "reduce the size of this document",
      "compress the file for email",
    ],
  },
  {
    id: "ocr",
    route: {
      kind: "action",
      toolId: "ocr",
      destructive: false,
      title: "Open Make Searchable (OCR)",
      description: "Open OCR to convert scanned pages into searchable, selectable text.",
    },
    examples: [
      "make this scanned document searchable",
      "recognize the text in this pdf",
      "convert scanned pages to text",
      "extract text from scanned images",
    ],
  },
  {
    id: "sign",
    route: {
      kind: "action",
      toolId: "sign",
      destructive: false,
      title: "Open Sign & Fill",
      description: "Open Sign & Fill to place a signature or fill form fields.",
    },
    examples: [
      "add my signature to this document",
      "sign this pdf",
      "fill out the form fields",
      "place my initials on each page",
    ],
  },
  {
    id: "protect",
    route: {
      kind: "action",
      toolId: "protect",
      destructive: false,
      title: "Open Protect",
      description: "Open Protect to encrypt the PDF with a password.",
    },
    examples: [
      "password protect this pdf",
      "encrypt the document",
      "lock this file with a password",
      "add a password to open",
    ],
  },
  {
    id: "unlock",
    route: {
      kind: "action",
      toolId: "unlock",
      destructive: false,
      title: "Open Unlock",
      description: "Open Unlock to remove password protection.",
    },
    examples: [
      "remove the password from this pdf",
      "unlock this encrypted file",
      "decrypt this document",
    ],
  },
  {
    id: "bates",
    route: {
      kind: "action",
      toolId: "bates",
      destructive: false,
      title: "Open Bates Numbering",
      description: "Open the Bates panel to configure prefix, start number and placement, then apply.",
    },
    examples: [
      "add bates numbers to these pages",
      "stamp bates numbering across the document",
      "apply legal page numbering",
    ],
  },
  {
    id: "watermark",
    route: {
      kind: "action",
      toolId: "watermark",
      destructive: false,
      title: "Open Watermark",
      description: "Open Watermark to add a text or image mark across pages.",
    },
    examples: [
      "add a confidential watermark",
      "stamp draft across every page",
      "put a watermark on this pdf",
    ],
  },
  {
    id: "merge",
    route: {
      kind: "action",
      toolId: "merge",
      destructive: false,
      title: "Open Merge",
      description: "Open Merge to combine multiple PDFs into one.",
    },
    examples: [
      "combine these pdfs into one file",
      "merge two documents together",
      "join multiple pdfs",
    ],
  },
  {
    id: "split",
    route: {
      kind: "action",
      toolId: "split",
      destructive: false,
      title: "Open Split",
      description: "Open Split to break the PDF into parts.",
    },
    examples: [
      "split this pdf into separate files",
      "break this document into pages",
      "separate every chapter into its own pdf",
    ],
  },
  {
    id: "rotate",
    route: {
      kind: "action",
      toolId: "rotate",
      destructive: false,
      title: "Open Rotate",
      description: "Open Rotate to change page orientation.",
    },
    examples: [
      "rotate these pages",
      "turn the sideways pages upright",
      "fix the page orientation",
    ],
  },
  {
    id: "organize",
    route: {
      kind: "action",
      toolId: "organize",
      destructive: false,
      title: "Open Organize Pages",
      description: "Open Organize to reorder or delete pages (change is previewed).",
    },
    examples: [
      "reorder the pages",
      "delete a page from this pdf",
      "move page three to the end",
      "rearrange the document",
    ],
  },
  {
    id: "extract",
    route: {
      kind: "action",
      toolId: "extract",
      destructive: false,
      title: "Open Extract",
      description: "Open Extract to pull pages, tables or images out.",
    },
    examples: [
      "pull out a range of pages",
      "extract the tables from this document",
      "save specific pages as a new pdf",
    ],
  },
  {
    id: "document-hash",
    route: {
      kind: "action",
      toolId: "document-hash",
      destructive: false,
      title: "Open Document Hash",
      description: "Open Document Hash to compute a SHA-256 for this file.",
    },
    examples: [
      "compute a hash of this document",
      "generate a sha 256 checksum",
      "fingerprint this pdf",
    ],
  },
  {
    id: "compare",
    route: {
      kind: "action",
      toolId: "compare",
      destructive: false,
      title: "Open Compare",
      description: "Open Compare to see what changed between two PDFs.",
    },
    examples: [
      "compare these two documents",
      "show me what changed between versions",
      "diff two pdfs",
    ],
  },
];

/* --------------------------- embedding cache --------------------------- */

/**
 * Lazily-computed anchor matrix: flat Float32Array of every example
 * vector concatenated, plus a parallel index → intent map. Built once
 * on first semantic classify call; reused for every subsequent one.
 */
let anchorsPromise: Promise<{
  dim: number;
  matrix: Float32Array;
  ownerIntentIdx: number[];
}> | null = null;

function buildAnchors() {
  if (anchorsPromise) return anchorsPromise;
  const allTexts: string[] = [];
  const ownerIntentIdx: number[] = [];
  INTENTS.forEach((intent, idx) => {
    intent.examples.forEach((ex) => {
      allTexts.push(ex);
      ownerIntentIdx.push(idx);
    });
  });
  anchorsPromise = (async () => {
    const vecs = await embedTexts(allTexts);
    const dim = vecs[0]?.length ?? 0;
    const matrix = new Float32Array(dim * vecs.length);
    for (let i = 0; i < vecs.length; i++) matrix.set(vecs[i], i * dim);
    console.log(
      "[intent] anchors built —",
      vecs.length,
      "examples across",
      INTENTS.length,
      "intents, dim=",
      dim,
    );
    return { dim, matrix, ownerIntentIdx };
  })();
  return anchorsPromise;
}

function dot(q: Float32Array, matrix: Float32Array, offset: number, dim: number) {
  let s = 0;
  for (let i = 0; i < dim; i++) s += q[i] * matrix[offset + i];
  return s;
}

/* ------------------------- semantic classify ------------------------- */

/** Cosine below this → nothing is meaningfully close → clarify. */
const MIN_ABS = 0.38;
/** Top-1 within this margin of top-2 (different intent) → clarify. */
const GAP = 0.03;
/**
 * Destructive actions (redact, sanitize) require a stronger match before
 * we route to the tool. Between MIN_ABS and DESTR_MIN we still clarify
 * with the top-2 options rather than guess — a wrong destructive route
 * costs the user real work.
 */
const DESTR_MIN = 0.5;
/**
 * When offering clarify options, an alternative must be at least this
 * close to the top score to be shown — otherwise it's not a real
 * alternative, just the next item in a sparse ranking, and showing it
 * (e.g. "Document Hash" for "find ssn") makes the assistant look broken.
 */
const CLARIFY_REL = 0.85;
const CLARIFY_MIN = 0.3;

/* --------------------- fast conversational shortcut --------------------- */

/**
 * Chitchat is trivially detectable and semantic matching against
 * tool-focused anchors mis-routes it every time. Match a short whitelist
 * of greetings / small-talk / meta questions before we run embeddings.
 */
const CHITCHAT_PATTERNS: Array<{ re: RegExp; reply: string }> = [
  {
    re: /^(hi|hey|hello|yo|howdy|hiya|sup)\b[!.\s]*$/i,
    reply:
      "Hi! I can help you search this document, run tasks like redaction or Bates numbering, or answer questions about how the tools work. What do you need?",
  },
  {
    re: /^(good\s+(morning|afternoon|evening))\b[!.\s]*$/i,
    reply:
      "Hello! Ask me to find something in this document, run an action like redaction or Bates, or explain a tool — I'll take it from there.",
  },
  {
    re: /^(thanks|thank you|thx|ty|cheers)\b[!.\s]*$/i,
    reply: "You're welcome — ping me any time.",
  },
  {
    re: /^(bye|goodbye|see ya|later)\b[!.\s]*$/i,
    reply: "Talk soon.",
  },
  {
    re: /^(what can you do|help|who are you|what are you|what do you do)\b[?!.\s]*$/i,
    reply:
      "I'm Counsel — the AI assistant for this workspace. I can (1) search or answer questions about the open PDF, (2) set up actions like Redact, Bates, Watermark, OCR or Sanitize for you to review, and (3) explain how any tool works. Just tell me what you'd like to do.",
  },
];

function tryChitchat(raw: string): Intent | null {
  for (const { re, reply } of CHITCHAT_PATTERNS) {
    if (re.test(raw)) return { kind: "chitchat", raw, reply };
  }
  return null;
}

function makeIntent(def: IntentDef, raw: string): Intent {
  const r = def.route;
  if (r.kind === "search") return { kind: "search", query: raw, raw };
  if (r.kind === "question") return { kind: "question", query: raw, raw };
  return {
    kind: "action",
    toolId: r.toolId,
    destructive: r.destructive,
    title: r.title,
    description: r.description,
    raw,
  };
}

export async function classifyCommandSemantic(input: string): Promise<Intent> {
  const raw = input.trim();
  if (!raw) return { kind: "search", query: "", raw };

  const chit = tryChitchat(raw);
  if (chit) return chit;

  const [qVec] = await embedTexts([raw]);
  const { dim, matrix, ownerIntentIdx } = await buildAnchors();

  // Best score PER INTENT (max over its example anchors).
  const perIntent = new Array<number>(INTENTS.length).fill(-Infinity);
  for (let i = 0; i < ownerIntentIdx.length; i++) {
    const s = dot(qVec, matrix, i * dim, dim);
    const idx = ownerIntentIdx[i];
    if (s > perIntent[idx]) perIntent[idx] = s;
  }

  const ranked = perIntent
    .map((s, idx) => ({ idx, s }))
    .sort((a, b) => b.s - a.s);

  const top = ranked[0];
  const runner = ranked[1];

  console.log(
    "[intent] query=",
    JSON.stringify(raw),
    "top5=",
    ranked.slice(0, 5).map((r) => ({
      intent: INTENTS[r.idx].id,
      score: +r.s.toFixed(3),
    })),
  );

  const topIntent = INTENTS[top.idx];
  const runnerIntent = INTENTS[runner.idx];

  const differentRoute =
    topIntent.route.kind !== runnerIntent.route.kind ||
    (topIntent.route.kind === "action" &&
      runnerIntent.route.kind === "action" &&
      topIntent.route.toolId !== runnerIntent.route.toolId);

  // Pick clarify options only from candidates close enough to the top to
  // be a plausible alternative. Otherwise a sparse ranking dumps
  // unrelated tools (e.g. "Document Hash") into the clarify UI.
  const relevantAlts = ranked
    .slice(1)
    .filter((r) => r.s >= CLARIFY_MIN && r.s >= top.s * CLARIFY_REL)
    .map((r) => INTENTS[r.idx]);

  const clarify = (reason: string): Intent => {
    const options: Intent[] = [makeIntent(topIntent, raw)];
    if (relevantAlts[0]) options.push(makeIntent(relevantAlts[0], raw));
    return { kind: "ambiguous", raw, options, reason };
  };

  if (top.s < MIN_ABS) {
    // Nothing meaningfully close. If there isn't even one relevant
    // alternative to offer, just route to search — the safest fallback.
    if (relevantAlts.length === 0) {
      return { kind: "search", query: raw, raw };
    }
    return clarify("I'm not sure what you're asking. Did you mean one of these?");
  }
  if (
    differentRoute &&
    top.s - runner.s < GAP &&
    runner.s >= top.s * CLARIFY_REL
  ) {
    return clarify(
      `Did you want to ${describeRoute(topIntent)} or ${describeRoute(runnerIntent)}?`,
    );
  }
  if (
    topIntent.route.kind === "action" &&
    topIntent.route.destructive &&
    top.s < DESTR_MIN
  ) {
    // For a low-confidence destructive match, prefer routing to search
    // (surface hits) over silently opening the destructive tool.
    return { kind: "search", query: raw, raw };
  }
  return makeIntent(topIntent, raw);
}

function describeRoute(def: IntentDef): string {
  if (def.route.kind === "search") return "search the document";
  if (def.route.kind === "question") return "get a written answer";
  return def.route.title.replace(/^Open\s+/, "").toLowerCase();
}

/* --------------------------- sync fallback --------------------------- */

/**
 * Instant, keyword-free fallback used before the MiniLM model has
 * warmed up. Handles chitchat inline and otherwise punts to "search"
 * (the safest non-destructive route) rather than guessing an action.
 */
export function classifyCommand(input: string): Intent {
  const raw = input.trim();
  if (!raw) return { kind: "search", query: "", raw };
  const chit = tryChitchat(raw);
  if (chit) return chit;
  if (raw.endsWith("?")) return { kind: "question", query: raw, raw };
  return { kind: "search", query: raw, raw };
}

/** Short badge label for the interpreted mode. */
export function intentLabel(intent: Intent): string {
  switch (intent.kind) {
    case "action":
      return intent.destructive ? "Action · needs confirm" : "Action";
    case "question":
      return "Answer";
    case "search":
      return "Search";
    case "chitchat":
      return "Chat";
    case "ambiguous":
      return "Clarify";
  }
}


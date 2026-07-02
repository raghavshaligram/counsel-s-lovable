/**
 * Command-bar intent router (heuristic, on-device, zero-latency).
 *
 * Classifies free-text into one of:
 *   - action    → run a destructive/mutating tool (needs confirmation)
 *   - question  → route to AI Assist for a written answer + source refs
 *   - search    → route to Pre-Discovery for ranked passage results
 *   - ambiguous → ask the user to pick between two interpretations
 *
 * Deliberately rules-based (no LLM call). The command bar must feel
 * instant, and destructive actions must NEVER auto-execute — the router
 * only proposes; the user confirms.
 */

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
  | "document-hash"
  | "compare"
  | "organize";

export type Intent =
  | {
      kind: "action";
      toolId: ActionToolId;
      /** Human-friendly summary shown in the confirmation popover. */
      title: string;
      /** Longer sentence describing what will happen. */
      description: string;
      /** True for destructive ops (redact/sanitize/delete). */
      destructive: boolean;
      raw: string;
    }
  | {
      kind: "question";
      query: string;
      raw: string;
    }
  | {
      kind: "search";
      query: string;
      raw: string;
    }
  | {
      kind: "ambiguous";
      raw: string;
      /** Two suggested re-routes, each a fully-classified intent. */
      options: [Intent, Intent];
      reason: string;
    };

/* -------------------------- pattern helpers -------------------------- */

const QUESTION_STARTERS =
  /^(what|which|why|who|whom|whose|when|where|how|is|are|was|were|do|does|did|can|could|should|would|will|list|explain|summari[sz]e|describe|tell me|give me a summary)\b/i;

const SEARCH_STARTERS =
  /^(find|search|locate|show me|show all|anything about|mentions? of|look for|highlight|where (is|are|does|do))\b/i;

const AMBIGUOUS_HINTS =
  /\b(remove|delete|strip|get rid of|scrub)\b.*\b(confidential|sensitive|private|personal)\b/i;

interface ActionSpec {
  toolId: ActionToolId;
  destructive: boolean;
  patterns: RegExp[];
  /** How to phrase the confirmation prompt. `{q}` inserts the raw command. */
  title: (raw: string) => string;
  description: (raw: string) => string;
}

const ACTIONS: ActionSpec[] = [
  {
    toolId: "redact",
    destructive: true,
    patterns: [
      /\bredact(ing|ion|ed)?\b/i,
      /\bblack\s?out\b/i,
      /\bmask\s+(all\s+)?(ssn|social|phone|email|dob|birth|address|name)/i,
    ],
    title: () => "Open Redact tool",
    description: (raw) =>
      `Open the Redact panel to auto-detect and preview matches for “${raw.trim()}”. You'll review and apply from there — nothing is redacted yet.`,
  },
  {
    toolId: "sanitize",
    destructive: true,
    patterns: [
      /\bsanitiz(e|ing|ation)\b/i,
      /\b(remove|strip|clean|scrub)\s+(all\s+)?(metadata|hidden|tracked changes|comments|revisions)\b/i,
      /\bmetadata\b/i,
    ],
    title: () => "Open Sanitize tool",
    description: () =>
      "Open Sanitize to remove metadata, hidden layers, comments and revisions. You'll confirm before it applies.",
  },
  {
    toolId: "bates",
    destructive: false,
    patterns: [/\bbates\b/i, /\bstamp\s+numbers?\b/i],
    title: () => "Open Bates Numbering",
    description: () =>
      "Open the Bates panel to configure prefix, start number and placement, then apply.",
  },
  {
    toolId: "ocr",
    destructive: false,
    patterns: [/\bocr\b/i, /\bmake\s+searchable\b/i, /\brecogni[sz]e\s+text\b/i],
    title: () => "Open Make Searchable (OCR)",
    description: () => "Open OCR to convert scanned pages into searchable text.",
  },
  {
    toolId: "watermark",
    destructive: false,
    patterns: [/\bwatermark\b/i, /\bstamp\b(?!\s+numbers?)/i],
    title: () => "Open Watermark",
    description: () => "Open Watermark to add a text or image mark across pages.",
  },
  {
    toolId: "sign",
    destructive: false,
    patterns: [/\bsign(ing|ature)?\b/i, /\bfill\s+(form|fields)\b/i, /\binitial(s)?\b/i],
    title: () => "Open Sign & Fill",
    description: () => "Open Sign & Fill to place a signature or fill form fields.",
  },
  {
    toolId: "protect",
    destructive: false,
    patterns: [/\b(password[- ]?protect|encrypt|lock)\b/i, /\bset\s+password\b/i],
    title: () => "Open Protect",
    description: () => "Open Protect to encrypt the PDF with a password.",
  },
  {
    toolId: "unlock",
    destructive: false,
    patterns: [/\bunlock\b/i, /\bremove\s+password\b/i, /\bdecrypt\b/i],
    title: () => "Open Unlock",
    description: () => "Open Unlock to remove password protection.",
  },
  {
    toolId: "compress",
    destructive: false,
    patterns: [/\bcompress\b/i, /\bshrink\b/i, /\breduce\s+(the\s+)?(file\s+)?size\b/i],
    title: () => "Open Compress",
    description: () => "Open Compress to reduce the PDF's file size.",
  },
  {
    toolId: "merge",
    destructive: false,
    patterns: [/\bmerge\b/i, /\bcombine\s+(pdfs?|files?|documents?)\b/i, /\bjoin\s+pdfs?\b/i],
    title: () => "Open Merge",
    description: () => "Open Merge to combine multiple PDFs into one.",
  },
  {
    toolId: "split",
    destructive: false,
    patterns: [/\bsplit\b/i, /\bseparate\s+pages?\b/i],
    title: () => "Open Split",
    description: () => "Open Split to break the PDF into parts.",
  },
  {
    toolId: "rotate",
    destructive: false,
    patterns: [/\brotate\b/i, /\bturn\s+(the\s+)?pages?\b/i],
    title: () => "Open Rotate",
    description: () => "Open Rotate to change page orientation.",
  },
  {
    toolId: "organize",
    destructive: false,
    patterns: [/\borgani[sz]e\b/i, /\breorder\b/i, /\bmove\s+pages?\b/i, /\bdelete\s+pages?\b/i],
    title: () => "Open Organize Pages",
    description: () => "Open Organize to reorder or delete pages (change is previewed).",
  },
  {
    toolId: "extract",
    destructive: false,
    patterns: [/\bextract\b/i, /\bpull\s+out\s+(pages?|tables?|images?)\b/i],
    title: () => "Open Extract",
    description: () => "Open Extract to pull pages, tables or images out.",
  },
  {
    toolId: "document-hash",
    destructive: false,
    patterns: [/\bhash\b/i, /\bsha[- ]?256\b/i, /\bchecksum\b/i, /\bfingerprint\b/i],
    title: () => "Open Document Hash",
    description: () => "Open Document Hash to compute a SHA-256 for this file.",
  },
  {
    toolId: "compare",
    destructive: false,
    patterns: [/\bcompare\b/i, /\bdiff(erence)?\b/i, /\bwhat\s+changed\b/i],
    title: () => "Open Compare",
    description: () => "Open Compare to see what changed between two PDFs.",
  },
];

/* ------------------------------ classify ------------------------------ */

export function classifyCommand(input: string): Intent {
  const raw = input.trim();
  const q = raw.toLowerCase();

  // 1) Ambiguous "remove the confidential parts" — don't guess destructive.
  if (
    AMBIGUOUS_HINTS.test(q) &&
    !ACTIONS[0].patterns.some((p) => p.test(q)) // no explicit "redact"
  ) {
    const asRedact: Intent = {
      kind: "action",
      toolId: "redact",
      destructive: true,
      title: "Redact them",
      description: `Open Redact and search for confidential/sensitive matches from “${raw}”. You'll review before applying.`,
      raw,
    };
    const asSearch: Intent = {
      kind: "search",
      query: raw,
      raw,
    };
    return {
      kind: "ambiguous",
      raw,
      reason: "Did you want to redact these, or just find them?",
      options: [asRedact, asSearch],
    };
  }

  // 2) Actions win over question/search when a clear verb is present.
  for (const spec of ACTIONS) {
    if (spec.patterns.some((p) => p.test(q))) {
      return {
        kind: "action",
        toolId: spec.toolId,
        destructive: spec.destructive,
        title: spec.title(raw),
        description: spec.description(raw),
        raw,
      };
    }
  }

  // 3) Explicit search verbs
  if (SEARCH_STARTERS.test(q)) {
    return { kind: "search", query: raw, raw };
  }

  // 4) Question form
  if (q.endsWith("?") || QUESTION_STARTERS.test(q)) {
    return { kind: "question", query: raw, raw };
  }

  // 5) Default → search (safest — never destructive).
  return { kind: "search", query: raw, raw };
}

/** Short badge label for the interpreted mode, shown next to the input. */
export function intentLabel(intent: Intent): string {
  switch (intent.kind) {
    case "action":
      return intent.destructive ? "Action · needs confirm" : "Action";
    case "question":
      return "Answer";
    case "search":
      return "Search";
    case "ambiguous":
      return "Clarify";
  }
}

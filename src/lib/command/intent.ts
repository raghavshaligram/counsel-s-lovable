/**
 * Command-bar intent router — semantic (MiniLM embeddings, on-device).
 *
 * Each intent maps to a *destination* in the workspace: either a
 * top-level tool panel, or a sub-feature inside a panel (via a
 * `focusSection` deep-link). We define each intent with a small set of
 * example phrases; the user's input is embedded with the same MiniLM
 * model already loaded for Pre-Discovery, then matched to the closest
 * intent by cosine similarity against those anchors.
 *
 * Design rules for anchors:
 *   - Each anchor MUST contain the intent's defining concept. Generic
 *     verbs ("add", "apply", "remove", "clean") appear in many intents
 *     and are the classic source of mis-routing — the Bates / page-
 *     numbers bug came from a single generic "legal page numbering"
 *     line dragging every "add page numbers" query into Bates.
 *   - Similar-but-different intents (page-numbers vs bates, watermark
 *     vs header/footer, redact vs highlight, sanitize vs redact) are
 *     given anchors that push them apart in embedding space: distinct
 *     nouns and concrete outcomes, no shared filler.
 *   - 3–5 tight examples per intent. More is not better.
 *
 * Confidence guard: below MIN_ABS → clarify; top-1 within GAP of a
 * different-route runner-up → clarify. Destructive actions never
 * auto-execute — the router only proposes; the popover confirms.
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
  | "doc-settings"
  | "comments"
  | "outline"
  | "privilege-scan"
  | "exhibit-binder"
  | "court-readiness"
  | "toa"
  | "citation-hyperlinker"
  | "mail-merge"
  | "page-crop"
  | "convert"
  | "image-convert";

export type Intent =
  | {
      kind: "action";
      toolId: ActionToolId;
      /** Optional sub-section inside the tool panel to auto-open. */
      focusSection?: string;
      title: string;
      description: string;
      destructive: boolean;
      raw: string;
    }
  | { kind: "question"; query: string; raw: string }
  | { kind: "search"; query: string; raw: string }
  | {
      kind: "ambiguous";
      raw: string;
      options: [Intent, Intent];
      reason: string;
    };

/* --------------------------- semantic anchors --------------------------- */

type Route =
  | {
      kind: "action";
      toolId: ActionToolId;
      focusSection?: string;
      destructive: boolean;
      title: string;
      description: string;
    }
  | { kind: "question" }
  | { kind: "search" };

interface IntentDef {
  id: string;
  route: Route;
  examples: string[];
}

const INTENTS: IntentDef[] = [
  /* ------------------------------- Q&A / search ------------------------------- */
  {
    id: "search",
    route: { kind: "search" },
    examples: [
      "find mentions of the parties",
      "where does the document discuss damages",
      "locate every reference to the contract",
      "show me passages about indemnification",
      // Bare content-noun queries — no verb, just what to look for.
      // These are the exact class of queries that were mis-routing to
      // Page Numbers / Header-Footer before ("dollar amounts",
      // "key dates"). Keep them tight and concrete.
      "dollar amounts",
      "money figures and prices",
      "key dates and deadlines",
      "financial figures in the document",
      "names of the parties",
      "addresses mentioned in the text",
      "any references to payment",
    ],
  },
  {
    id: "question",
    route: { kind: "question" },
    examples: [
      "summarize this document",
      "what are the key points",
      "explain the main arguments",
      "give me an overview of the case",
      "who are the parties involved",
    ],
  },

  /* ------------------------------- Destructive ------------------------------- */
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
      "redact social security numbers permanently",
      "black out and remove phone numbers",
      "permanently delete sensitive text from the pdf",
      "burn out client names so they cannot be recovered",
    ],
  },
  {
    id: "sanitize",
    route: {
      kind: "action",
      toolId: "sanitize",
      destructive: true,
      title: "Open Sanitize",
      description:
        "Open Sanitize to strip metadata, hidden layers, comments and revisions. You'll confirm before it applies.",
    },
    examples: [
      "strip metadata author and revision history from this file",
      "scrub hidden layers and tracked changes",
      "remove document properties before sharing externally",
    ],
  },

  /* ------------------------------- Highlight (annotate, not destructive) ------------------------------- */
  {
    id: "highlight",
    route: {
      kind: "action",
      toolId: "comments",
      focusSection: "highlight",
      destructive: false,
      title: "Open annotation tools",
      description:
        "Use the Highlight / Underline tools in the floating toolbar to mark passages without removing anything.",
    },
    examples: [
      "highlight important passages in yellow",
      "underline the key sentences",
      "mark up quotes without deleting anything",
    ],
  },

  /* ------------------------------- Document Settings sub-features ------------------------------- */
  {
    id: "page-numbers",
    route: {
      kind: "action",
      toolId: "doc-settings",
      focusSection: "page-numbers",
      destructive: false,
      title: "Open Page Numbers",
      description:
        "Opens Document Settings → Page Numbers. Not the same as Bates numbering — page numbers restart per document and are just for reading.",
    },
    examples: [
      "add page numbers to the pdf",
      "number the pages 1 2 3",
      "put page numbers at the bottom of each page",
      "show page x of y at the footer",
    ],
  },
  {
    id: "header-footer",
    route: {
      kind: "action",
      toolId: "doc-settings",
      focusSection: "header-footer",
      destructive: false,
      title: "Open Header / Footer",
      description:
        "Opens Document Settings → Header & Footer. For running headers or footers on every page (filename, date, custom text).",
    },
    examples: [
      "add a running header with the filename",
      "put a footer with the date on every page",
      "stamp a header and footer on every page",
      "add a top-of-page title on all pages",
    ],
  },
  {
    id: "flatten-settings",
    route: {
      kind: "action",
      toolId: "doc-settings",
      focusSection: "flatten",
      destructive: false,
      title: "Open Flatten setting",
      description:
        "Opens Document Settings → Flatten. Bakes form fields and annotations into the page so they can't be edited.",
    },
    examples: [
      "flatten the form fields into the page",
      "bake annotations so they cannot be edited",
      "merge annotations into the pdf permanently",
    ],
  },

  /* ------------------------------- Bates (kept tight) ------------------------------- */
  {
    id: "bates",
    route: {
      kind: "action",
      toolId: "bates",
      destructive: false,
      title: "Open Bates Numbering",
      description:
        "Opens the Bates panel. Bates stamps are unique production identifiers for discovery (e.g. ABC000123) — different from ordinary page numbers.",
    },
    examples: [
      "add bates numbering for discovery production",
      "stamp bates numbers with prefix ABC",
      "apply bates labels to these exhibits",
      "bates stamp the production set",
    ],
  },

  /* ------------------------------- Watermark (distinct from header/footer) ------------------------------- */
  {
    id: "watermark",
    route: {
      kind: "action",
      toolId: "watermark",
      destructive: false,
      title: "Open Watermark",
      description:
        "Opens the Watermark tool. For a diagonal or centered mark like CONFIDENTIAL or DRAFT — not for headers or footers.",
    },
    examples: [
      "add a diagonal confidential watermark across the page",
      "stamp draft as a big overlay on every page",
      "put a translucent watermark behind the text",
    ],
  },

  /* ------------------------------- Assembly ------------------------------- */
  {
    id: "merge",
    route: {
      kind: "action",
      toolId: "merge",
      destructive: false,
      title: "Open Merge",
      description: "Opens Merge to combine multiple PDFs into one.",
    },
    examples: [
      "combine these pdfs into one file",
      "merge two documents together",
      "join multiple pdfs end to end",
    ],
  },
  {
    id: "split",
    route: {
      kind: "action",
      toolId: "split",
      destructive: false,
      title: "Open Split",
      description: "Opens Split to break the PDF into parts.",
    },
    examples: [
      "split this pdf into separate files",
      "break this document at every chapter",
      "separate each page into its own pdf",
    ],
  },
  {
    id: "extract",
    route: {
      kind: "action",
      toolId: "extract",
      destructive: false,
      title: "Open Extract",
      description: "Opens Extract to pull pages, tables or images out.",
    },
    examples: [
      "pull out pages 5 through 10 as a new pdf",
      "extract the tables in this document",
      "save specific pages to a separate file",
    ],
  },
  {
    id: "organize",
    route: {
      kind: "action",
      toolId: "organize",
      destructive: false,
      title: "Open Organize Pages",
      description: "Opens Organize to reorder or delete pages.",
    },
    examples: [
      "reorder the pages of this pdf",
      "delete page 3 from the document",
      "move the last page to the front",
      "rearrange the page order",
    ],
  },
  {
    id: "rotate",
    route: {
      kind: "action",
      toolId: "rotate",
      destructive: false,
      title: "Open Rotate",
      description: "Opens Rotate to change page orientation.",
    },
    examples: [
      "rotate a sideways page upright",
      "turn this page 90 degrees",
      "fix upside-down pages",
    ],
  },
  {
    id: "page-crop",
    route: {
      kind: "action",
      toolId: "page-crop",
      destructive: false,
      title: "Open Page Crop",
      description: "Opens Page Crop to trim page margins.",
    },
    examples: [
      "crop the white margins off the pages",
      "trim the edges of each page",
      "cut off the borders",
    ],
  },

  /* ------------------------------- Convert / compress ------------------------------- */
  {
    id: "compress",
    route: {
      kind: "action",
      toolId: "compress",
      destructive: false,
      title: "Open Compress",
      description: "Opens Compress to reduce the PDF's file size.",
    },
    examples: [
      "make this file smaller for email",
      "reduce the pdf file size",
      "shrink the document to under 10 mb",
    ],
  },
  {
    id: "convert",
    route: {
      kind: "action",
      toolId: "convert",
      destructive: false,
      title: "Open Convert",
      description: "Opens Convert for Word / Excel / PDF-A output.",
    },
    examples: [
      "convert this pdf to word",
      "export the document as docx",
      "save the pdf as excel or pdf-a",
    ],
  },
  {
    id: "image-convert",
    route: {
      kind: "action",
      toolId: "image-convert",
      destructive: false,
      title: "Open Image Convert",
      description: "Opens Image Convert to swap between PDF and image formats.",
    },
    examples: [
      "turn each page into a png image",
      "convert this pdf to jpg images",
      "make a pdf from these photos",
    ],
  },

  /* ------------------------------- OCR ------------------------------- */
  {
    id: "ocr",
    route: {
      kind: "action",
      toolId: "ocr",
      destructive: false,
      title: "Open Make Searchable (OCR)",
      description: "Opens OCR to convert scanned pages into searchable, selectable text.",
    },
    examples: [
      "make this scanned document searchable",
      "recognize text in a scanned pdf",
      "run ocr on image-only pages",
    ],
  },

  /* ------------------------------- Signing / security ------------------------------- */
  {
    id: "sign",
    route: {
      kind: "action",
      toolId: "sign",
      destructive: false,
      title: "Open Sign & Fill",
      description: "Opens Sign & Fill to place a signature or fill form fields.",
    },
    examples: [
      "add my signature to this document",
      "sign this pdf on the last page",
      "fill in the form fields",
    ],
  },
  {
    id: "protect",
    route: {
      kind: "action",
      toolId: "protect",
      destructive: false,
      title: "Open Protect",
      description: "Opens Protect to encrypt the PDF with a password.",
    },
    examples: [
      "password protect this pdf",
      "encrypt the document with a passphrase",
      "require a password to open this file",
    ],
  },
  {
    id: "unlock",
    route: {
      kind: "action",
      toolId: "unlock",
      destructive: false,
      title: "Open Unlock",
      description: "Opens Unlock to remove password protection.",
    },
    examples: [
      "remove the password from this pdf",
      "unlock an encrypted document i own",
      "decrypt this file so it opens without a password",
    ],
  },
  {
    id: "repair",
    route: {
      kind: "action",
      toolId: "repair",
      destructive: false,
      title: "Open Repair PDF",
      description: "Opens Repair to attempt fixing structural issues in a broken PDF.",
    },
    examples: [
      "this pdf looks corrupted",
      "the file will not open properly",
      "fix a broken damaged document",
      "something is wrong with this pdf structure",
    ],
  },

  /* ------------------------------- Compare / hash ------------------------------- */
  {
    id: "document-hash",
    route: {
      kind: "action",
      toolId: "document-hash",
      destructive: false,
      title: "Open Document Hash",
      description: "Opens Document Hash to compute a SHA-256 for this file.",
    },
    examples: [
      "compute the sha-256 hash of this document",
      "generate a checksum for the file",
      "fingerprint the pdf for chain of custody",
    ],
  },
  {
    id: "compare",
    route: {
      kind: "action",
      toolId: "compare",
      destructive: false,
      title: "Open Compare",
      description: "Opens Compare to see what changed between two PDFs.",
    },
    examples: [
      "compare these two versions of a contract",
      "show what changed between drafts",
      "diff two pdfs side by side",
    ],
  },

  /* ------------------------------- Legal sub-tools ------------------------------- */
  {
    id: "privilege-scan",
    route: {
      kind: "action",
      toolId: "privilege-scan",
      destructive: false,
      title: "Open Privilege Review",
      description: "Opens Privilege Review to flag attorney-client and work-product passages.",
    },
    examples: [
      "flag privileged attorney-client content",
      "scan for attorney work product",
      "find passages that might be privileged",
    ],
  },
  {
    id: "exhibit-binder",
    route: {
      kind: "action",
      toolId: "exhibit-binder",
      destructive: false,
      title: "Open Exhibit Binder",
      description: "Opens Exhibit Binder to assemble numbered exhibits.",
    },
    examples: [
      "assemble an exhibit binder for trial",
      "build a numbered exhibit set",
      "combine files into exhibits A B C",
    ],
  },
  {
    id: "court-readiness",
    route: {
      kind: "action",
      toolId: "court-readiness",
      destructive: false,
      title: "Open Court Readiness",
      description: "Opens Court Readiness checks (fonts, bookmarks, PDF/A).",
    },
    examples: [
      "check if this filing is court ready",
      "verify the pdf meets ecf filing rules",
      "run a court readiness check",
    ],
  },
  {
    id: "toa",
    route: {
      kind: "action",
      toolId: "toa",
      destructive: false,
      title: "Open Table of Authorities",
      description: "Opens Table of Authorities to detect and list cited cases.",
    },
    examples: [
      "build a table of authorities from the citations",
      "list every case cited in the brief",
      "generate a toa for this filing",
    ],
  },
  {
    id: "citation-hyperlinker",
    route: {
      kind: "action",
      toolId: "citation-hyperlinker",
      destructive: false,
      title: "Open Citation Hyperlinker",
      description: "Opens Citation Hyperlinker to link case citations to sources.",
    },
    examples: [
      "hyperlink the case citations",
      "make cited cases clickable",
      "link citations to the source cases",
    ],
  },

  /* ------------------------------- Other tools ------------------------------- */
  {
    id: "outline",
    route: {
      kind: "action",
      toolId: "outline",
      destructive: false,
      title: "Open Outline & Links",
      description: "Opens the Outline panel to edit bookmarks and internal links.",
    },
    examples: [
      "edit the bookmarks and table of contents",
      "add outline entries for each section",
      "manage internal links and bookmarks",
    ],
  },
  {
    id: "comments",
    route: {
      kind: "action",
      toolId: "comments",
      destructive: false,
      title: "Open Comments",
      description: "Opens the Comments panel to review notes and replies.",
    },
    examples: [
      "show all the comments on this pdf",
      "review the sticky notes",
      "list every annotation and reply",
    ],
  },
  {
    id: "mail-merge",
    route: {
      kind: "action",
      toolId: "mail-merge",
      destructive: false,
      title: "Open Mail Merge",
      description: "Opens Mail Merge to generate personalized PDFs from a CSV.",
    },
    examples: [
      "mail merge a template with a csv of recipients",
      "generate one pdf per row from a spreadsheet",
      "bulk fill this form from a csv",
    ],
  },
];

/* --------------------------- embedding cache --------------------------- */

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

/** Cosine below this → nothing is meaningfully close → fall back to search. */
const MIN_ABS = 0.5;
/** An action intent below this score needs a real action verb in the query. */
const ACTION_STRONG = 0.6;
/** Top-1 within this margin of top-2 (different route) → clarify. */
const GAP = 0.05;

/**
 * True when the query contains an obvious action verb — the kind of
 * word that means "perform an operation on the document" rather than
 * "here is content I want to look up". If none of these appear the
 * query is almost certainly a search / question, not a tool trigger.
 */
const ACTION_VERB_RE =
  /\b(add|apply|stamp|number|redact|black\s*out|scrub|strip|sanitize|sign|fill|encrypt|protect|password|unlock|decrypt|compress|shrink|convert|export|export\s+to|ocr|recognize|repair|fix|compare|diff|merge|combine|split|separate|extract|pull\s+out|organize|reorder|delete|remove|rotate|crop|trim|hash|checksum|assemble|build|create|make|highlight|underline|bookmark|watermark|open|show|start|run)\b/i;

function makeIntent(def: IntentDef, raw: string): Intent {
  const r = def.route;
  if (r.kind === "search") return { kind: "search", query: raw, raw };
  if (r.kind === "question") return { kind: "question", query: raw, raw };
  return {
    kind: "action",
    toolId: r.toolId,
    focusSection: r.focusSection,
    destructive: r.destructive,
    title: r.title,
    description: r.description,
    raw,
  };
}

function routeKey(def: IntentDef): string {
  const r = def.route;
  if (r.kind === "action") return `action:${r.toolId}:${r.focusSection ?? ""}`;
  return r.kind;
}

/** Sensible clarify options — never random tools. */
function fallbackOptions(raw: string): [Intent, Intent] {
  return [
    { kind: "search", query: raw, raw },
    { kind: "question", query: raw, raw },
  ];
}

export async function classifyCommandSemantic(input: string): Promise<Intent> {
  const raw = input.trim();
  if (!raw) return { kind: "search", query: "", raw };

  const [qVec] = await embedTexts([raw]);
  const { dim, matrix, ownerIntentIdx } = await buildAnchors();

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
  const hasActionVerb = ACTION_VERB_RE.test(raw);

  console.log(
    "[intent] query=",
    JSON.stringify(raw),
    "hasActionVerb=",
    hasActionVerb,
    "top5=",
    ranked.slice(0, 5).map((r) => ({
      intent: INTENTS[r.idx].id,
      score: +r.s.toFixed(3),
    })),
  );

  const topIntent = INTENTS[top.idx];
  const runnerIntent = INTENTS[runner.idx];

  // Weak overall match — don't guess a tool. Default to search on the
  // raw text; offer search + Q&A as the clarification options, never a
  // random pair of unrelated tools (that was the "dollar amounts →
  // Page Numbers / Header" bug).
  if (top.s < MIN_ABS) {
    return {
      kind: "ambiguous",
      raw,
      reason:
        "I'm not sure what you mean. I can search your document, answer a question, or run a specific tool — what would you like?",
      options: fallbackOptions(raw),
    };
  }

  // Action intent, but no action verb in the query and the score isn't
  // decisive. That's the class of noun-phrase queries ("key dates",
  // "dollar amounts") that should never trigger a destructive/tool
  // panel. Route to search on the raw text.
  if (
    topIntent.route.kind === "action" &&
    !hasActionVerb &&
    top.s < ACTION_STRONG
  ) {
    return { kind: "search", query: raw, raw };
  }

  if (differentRouteOrClarify(topIntent, runnerIntent) && top.s - runner.s < GAP) {
    return {
      kind: "ambiguous",
      raw,
      reason: `Did you want to ${describeRoute(topIntent)} or ${describeRoute(runnerIntent)}?`,
      options: [makeIntent(topIntent, raw), makeIntent(runnerIntent, raw)],
    };
  }
  return makeIntent(topIntent, raw);
}

function differentRouteOrClarify(a: IntentDef, b: IntentDef): boolean {
  return routeKey(a) !== routeKey(b);
}


function describeRoute(def: IntentDef): string {
  if (def.route.kind === "search") return "search the document";
  if (def.route.kind === "question") return "get a written answer";
  return def.route.title.replace(/^Open\s+/, "").toLowerCase();
}

/* --------------------------- sync fallback --------------------------- */

/**
 * Instant, keyword-free fallback used before the MiniLM model has
 * warmed up. Punts to "search" (safest non-destructive route) rather
 * than guessing an action.
 */
export function classifyCommand(input: string): Intent {
  const raw = input.trim();
  if (!raw) return { kind: "search", query: "", raw };
  if (raw.endsWith("?")) return { kind: "question", query: raw, raw };
  return { kind: "search", query: raw, raw };
}

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

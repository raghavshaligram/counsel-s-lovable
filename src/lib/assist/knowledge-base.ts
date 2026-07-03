/**
 * Counsel knowledge base — structured Q&A entries covering every feature.
 *
 * One entry per feature/topic. Each entry lists several natural phrasings
 * a user might type (`questions`) plus a concise conversational answer
 * (`answer`), an optional `tool` id (drives the "Open [tool]" button on
 * the HELP response card), and an optional short step list.
 *
 * Adding a feature = append one object here. The matcher (`kb-match.ts`)
 * lazily embeds `questions` with the shared MiniLM worker on first use
 * and cosine-matches against the current user turn.
 */

export interface KBEntry {
  id: string;
  /** Natural phrasings a user might type. More phrasings = better recall. */
  questions: string[];
  /** Short conversational answer. Sentence-cased, no headings. */
  answer: string;
  /** Left-rail tool id — drives the "Open [tool]" button. */
  tool?: string;
  /** Human-readable tool label, if the id is not self-descriptive. */
  toolLabel?: string;
  /** Optional numbered steps rendered inline in the answer. */
  steps?: string[];
  /** Free-form topic tags for follow-up scoring. */
  topic?: string[];
}

export const KB: KBEntry[] = [
  /* ------------------------------ Redaction ------------------------------ */
  {
    id: "redact-basics",
    questions: [
      "how do I redact",
      "how do redactions work",
      "redact this document",
      "black out sensitive text",
      "how do I hide information in a pdf",
    ],
    answer:
      "Open Redact from the left rail. Draw over anything you want covered, or turn on AI Detect for PII/SSN/phone/email/dates and let it propose matches. Nothing is removed until you click Apply — then the underlying text, form fields, annotations, and metadata are permanently rewritten. Everything happens on this device.",
    tool: "redact",
    toolLabel: "Redact",
    steps: [
      "Open Redact",
      "Draw manual boxes or run AI Detect",
      "Review each proposed match",
      "Click Apply to permanently rewrite the file",
    ],
    topic: ["redaction", "pii", "privacy"],
  },
  {
    id: "redact-ai-detect",
    questions: [
      "auto detect pii",
      "find all social security numbers",
      "find phone numbers to redact",
      "automatically find sensitive info",
      "redact all emails",
    ],
    answer:
      "In Redact, enable the categories you want (SSN, phone, email, dates, names) and hit Detect. Each hit is a proposal — review them one by one and Apply when you're ready. AI never removes anything on its own.",
    tool: "redact",
    toolLabel: "Redact",
    topic: ["redaction", "pii"],
  },
  {
    id: "redact-bulk",
    questions: [
      "redact a keyword everywhere",
      "find and redact all occurrences",
      "batch redact a term",
      "redact every mention of a name",
    ],
    answer:
      "In Redact, use Find & Redact. Type the term, optionally add exemption codes (b6, b7c, work product), and every match is proposed for review. Apply when the list looks right.",
    tool: "redact",
    toolLabel: "Redact",
    topic: ["redaction", "bulk"],
  },
  {
    id: "verifiable-redaction",
    questions: [
      "court defensible redaction",
      "redaction with certificate",
      "signed proof of redaction",
      "chain of custody redaction",
      "produce a privilege log with redactions",
    ],
    answer:
      "Use Verifiable Redaction for production. It requires an exemption code on every mark, then emits a signed Certificate of Redaction (SHA-256 before/after) and a privilege log alongside the redacted PDF.",
    tool: "verifiable-redaction",
    toolLabel: "Verifiable Redaction",
    topic: ["redaction", "legal", "production"],
  },

  /* -------------------------------- Bates -------------------------------- */
  {
    id: "bates-single",
    questions: [
      "how do I add bates numbers",
      "bates stamp this pdf",
      "apply legal page numbering",
      "start bates at a specific number",
    ],
    answer:
      "Open Bates stamp. Set prefix, start number, digit width, and stamp position (footer corners are typical). Preview updates live; apply to burn the numbers into every page.",
    tool: "bates",
    toolLabel: "Bates",
    steps: [
      "Open Bates stamp",
      "Set prefix + start number + digit width",
      "Pick stamp position",
      "Apply",
    ],
    topic: ["bates", "numbering"],
  },
  {
    id: "bates-multi",
    questions: [
      "bates number across multiple pdfs",
      "continuous bates over several files",
      "batch bates a folder",
      "bates numbering across a set of documents",
    ],
    answer:
      "In Bates stamp, choose Multi-file. Drop the PDFs in the order they should be numbered — Counsel continues the sequence across files so no number is reused or skipped. Each file is stamped locally and saved separately.",
    tool: "bates",
    toolLabel: "Bates",
    topic: ["bates", "batch"],
  },

  /* ---------------------------- Exhibit Binder ---------------------------- */
  {
    id: "exhibit-binder",
    questions: [
      "build an exhibit binder",
      "combine brief and exhibits",
      "make a hyperlinked table of exhibits",
      "add slip sheets between exhibits",
    ],
    answer:
      "Open Exhibit Binder. Add your brief as the cover, then queue the exhibits in order. Counsel inserts slip sheets, generates a hyperlinked Table of Exhibits, and stitches everything into one PDF.",
    tool: "exhibit-binder",
    toolLabel: "Exhibit Binder",
    topic: ["binder", "exhibits", "legal"],
  },

  /* -------------------------- Privilege Review -------------------------- */
  {
    id: "privilege-review",
    questions: [
      "privilege review",
      "scan for privileged content",
      "attorney client privilege scan",
      "generate a privilege log",
    ],
    answer:
      "Privilege Review scans for attorney names, law-firm domains, subject-line cues (privileged / attorney work product), and common privilege phrasing. Each hit is proposed with a suggested basis; accept or reject to build a privilege log you can export.",
    tool: "privilege-scan",
    toolLabel: "Privilege Review",
    topic: ["privilege", "legal"],
  },

  /* --------------------------- Citations & TOA --------------------------- */
  {
    id: "citation-hyperlinker",
    questions: [
      "hyperlink citations",
      "make case cites clickable",
      "turn citations into links",
    ],
    answer:
      "Open Citation Hyperlinker. It finds Bluebook citations, resolves them, and rewrites each one as a real hyperlink in the PDF.",
    tool: "citation-hyperlinker",
    toolLabel: "Citation Hyperlinker",
    topic: ["citations"],
  },
  {
    id: "toa",
    questions: [
      "generate a table of authorities",
      "build a toa",
      "list every case cited",
      "add a table of authorities to my brief",
    ],
    answer:
      "Open Table of Authorities. Counsel extracts every citation, groups by cases / statutes / secondary, deduplicates, and inserts a formatted TOA into the brief. Run Citation Hyperlinker first if you also want the cites clickable.",
    tool: "toa",
    toolLabel: "Table of Authorities",
    topic: ["citations", "toa"],
  },

  /* -------------------------------- Others -------------------------------- */
  {
    id: "sanitize",
    questions: [
      "remove metadata",
      "strip hidden information",
      "scrub author and revisions",
      "sanitize a pdf before sending",
    ],
    answer:
      "Open Sanitize. Toggle what to strip — metadata, comments, form-field values, hidden layers, tracked revisions — preview the diff, then apply. The rewritten file has none of the removed data.",
    tool: "sanitize",
    toolLabel: "Sanitize",
    topic: ["metadata", "privacy"],
  },
  {
    id: "ocr",
    questions: [
      "make this searchable",
      "ocr a scanned pdf",
      "extract text from a scan",
      "recognize text in an image pdf",
    ],
    answer:
      "Open Make Searchable. Pick the languages, run OCR, and Counsel writes an invisible text layer over the scans so you can select, copy, and search. Runs on-device using Tesseract WASM.",
    tool: "ocr",
    toolLabel: "Make Searchable",
    topic: ["ocr", "searchable"],
  },
  {
    id: "compress",
    questions: [
      "make this file smaller",
      "compress a pdf",
      "reduce pdf size for email",
    ],
    answer:
      "Open Compress. Pick a target quality — Counsel downsamples images and re-encodes streams locally. Original stays untouched until you save.",
    tool: "compress",
    toolLabel: "Compress",
    topic: ["size"],
  },
  {
    id: "repair",
    questions: [
      "this pdf is corrupted",
      "file wont open",
      "fix a broken pdf",
      "repair a damaged document",
    ],
    answer:
      "Open Repair PDF. It reparses the file, rebuilds the xref table, and fixes common structural damage so the PDF opens cleanly again.",
    tool: "repair",
    toolLabel: "Repair PDF",
    topic: ["repair"],
  },
  {
    id: "merge",
    questions: [
      "combine pdfs",
      "merge two documents",
      "join files into one pdf",
    ],
    answer:
      "Open Merge. Drop the PDFs in the order you want, drag to reorder, then save the combined file.",
    tool: "merge",
    toolLabel: "Merge",
    topic: ["assemble"],
  },
  {
    id: "split",
    questions: [
      "split a pdf",
      "break the pdf into parts",
      "extract chapters as separate files",
    ],
    answer:
      "Open Split. Split by page range, every N pages, or on bookmarks. Counsel emits each part as its own PDF.",
    tool: "split",
    toolLabel: "Split",
    topic: ["assemble"],
  },
  {
    id: "organize",
    questions: [
      "reorder pages",
      "delete a page",
      "rearrange the document",
      "move a page to the end",
    ],
    answer:
      "Open Organize. Drag page thumbnails to reorder, select and delete, rotate, or insert blanks. Changes are previewed until you save.",
    tool: "organize",
    toolLabel: "Organize",
    topic: ["pages"],
  },
  {
    id: "sign",
    questions: [
      "sign this document",
      "add my signature",
      "fill out a form",
      "place initials on every page",
    ],
    answer:
      "Open Sign & Fill. Draw, type, or upload a signature, then drop it where you need it. Form fields become fillable in the same panel.",
    tool: "sign",
    toolLabel: "Sign & Fill",
    topic: ["signature", "forms"],
  },
  {
    id: "watermark",
    questions: [
      "add a watermark",
      "stamp draft on every page",
      "put confidential across the pdf",
    ],
    answer:
      "Open Watermark. Type the text (or upload an image), set opacity / rotation / placement, and apply across every page — or a specific range.",
    tool: "watermark",
    toolLabel: "Watermark",
    topic: ["watermark"],
  },
  {
    id: "compare",
    questions: [
      "compare two versions",
      "diff two pdfs",
      "what changed between drafts",
    ],
    answer:
      "Open Compare. Pick the two PDFs — Counsel aligns pages and highlights insertions, deletions, and moves side-by-side.",
    tool: "compare",
    toolLabel: "Compare",
    topic: ["diff"],
  },

  /* ------------------------------ Workflows ------------------------------ */
  {
    id: "workflows",
    questions: [
      "build a workflow",
      "automate a sequence of actions",
      "save a repeatable process",
      "run a batch job on many pdfs",
      "conditional workflow",
    ],
    answer:
      "Open Workflow Builder. Chain steps (redact → bates → watermark → export), save as a template, and run against one file or a batch. Add conditionals to branch on document properties.",
    tool: "workflow-builder",
    toolLabel: "Workflow Builder",
    topic: ["workflows", "automation"],
  },

  /* --------------------------- Pre-Discovery / AI --------------------------- */
  {
    id: "pre-discovery",
    questions: [
      "semantic search the pdf",
      "find passages by meaning",
      "search the document for a concept",
      "pre discovery review",
    ],
    answer:
      "Pre-Discovery indexes the current document locally with a small on-device model, then answers queries by meaning — not just keywords. Ask 'contamination cleanup' and it surfaces remediation language even if those exact words aren't there.",
    tool: "pre-discovery",
    toolLabel: "Pre-Discovery Review",
    topic: ["search", "ai"],
  },
  {
    id: "counsel-itself",
    questions: [
      "what can Counsel do",
      "what is this assistant",
      "how does the ai assistant work",
      "who is Counsel",
    ],
    answer:
      "Counsel is your document-grounded AI assist. Ask a question about the open PDF and you get an answer with page citations; ask to do something and you get a prepared action to review in the right tool. Everything runs on this device — nothing uploads.",
    topic: ["ai", "assistant"],
  },

  /* ----------------------------- Doc hash / templates ----------------------------- */
  {
    id: "doc-hash",
    questions: [
      "hash this document",
      "generate a sha 256 checksum",
      "fingerprint the pdf",
    ],
    answer:
      "Open Document Hash to compute a SHA-256 of the current file. Useful for chain-of-custody logs.",
    tool: "document-hash",
    toolLabel: "Document Hash",
    topic: ["hash"],
  },
  {
    id: "templates",
    questions: [
      "legal templates",
      "start from a template",
      "brief template",
      "motion template",
    ],
    answer:
      "The Firm Templates menu (top toolbar) opens a library of court-ready starting points — briefs, motions, discovery requests, exhibit sheets. Pick one and it loads as a new tab.",
    topic: ["templates"],
  },

  /* ------------------------------ Privacy ------------------------------ */
  {
    id: "privacy-on-device",
    questions: [
      "is this private",
      "does anything upload",
      "where does the pdf go",
      "on device processing",
      "is my data safe",
    ],
    answer:
      "Everything runs in your browser — the PDF, the AI models, the OCR engine, redaction and export. Nothing is sent to a server. The privacy shield in the top bar shows a live count of network requests originating from this workspace.",
    topic: ["privacy"],
  },
  {
    id: "offline",
    questions: [
      "does this work offline",
      "can I use this without internet",
      "work offline mode",
      "airplane mode pdf editing",
    ],
    answer:
      "Yes. Flip Work Offline in the top bar and Counsel refuses any outbound request. First load caches the app and models; after that you can pull the network cable and everything keeps working.",
    topic: ["privacy", "offline"],
  },
  {
    id: "verify-privacy",
    questions: [
      "how do I prove nothing was uploaded",
      "verify no network activity",
      "network log",
      "audit privacy",
    ],
    answer:
      "Open Verify Privacy from the account menu. Counsel keeps a running log of every network request the workspace made and lets you export it as proof for a client or IT team.",
    topic: ["privacy", "audit"],
  },

  /* ------------------------------ Plans ------------------------------ */
  {
    id: "plans",
    questions: [
      "what plans do you offer",
      "pricing",
      "difference between free and pro",
      "what is in Pro",
      "how do I upgrade",
    ],
    answer:
      "Three tiers. Anonymous: open, view, and try any tool locally — no account. Free (sign-in): everything anonymous can do, plus recents sync, saved workflows, and case sessions. Pro: verifiable redaction, Bates multi-file, Exhibit Binder, Workflow Builder, Compare, priority updates. Upgrade from the account menu → Billing.",
    topic: ["plans", "pricing"],
  },
];

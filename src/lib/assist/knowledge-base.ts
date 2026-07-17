/**
 * AI Assist tool-help training document.
 *
 * Single source of truth for conversational tool help, semantic routing,
 * and cross-cutting topical questions ("how much does Pro cost", "does
 * this work offline"). Entries describe existing verified tools only;
 * the assistant explains and opens those tools, but never reimplements.
 *
 * Availability strings mirror PAID_TOOL_IDS / PAID_FEATURES in
 * src/lib/pro-gate.tsx — do NOT invent new gating decisions here.
 */

export type AssistAvailability = "free" | "pro" | "mixed";

export interface AssistPricing {
  free: string;
  pro: string;
  note?: string;
}

export interface AssistToolEntry {
  id: string;
  toolId: string;
  displayName: string;
  category: string;
  availability: AssistAvailability;
  proFeatureName?: string;
  aliases: string[];
  examples: string[];
  capabilitySummary: string;
  answer: string;
  upgradeCopy?: string;
  freeModes?: string[];
  destructive?: boolean;
  focusSection?: string;
  /** Meta — populated for every entry. */
  pricing?: AssistPricing;
  runsOffline?: boolean;
  requiresNetwork?: "never" | "first-load" | "always";
  privacy?: string;
  limits?: string;
}

/** Default meta applied to every entry unless overridden per-entry. */
const DEFAULT_PRIVACY =
  "Nothing leaves your device — the document is processed locally in this browser.";
const DEFAULT_PRICING_FREE: AssistPricing = {
  free: "Included on the free plan.",
  pro: "Also available on Pro with no extra limits.",
};
const DEFAULT_PRICING_PRO: AssistPricing = {
  free: "Not available on the free plan — you can ask what it does.",
  pro: "Included with any paid subscription.",
};
const DEFAULT_PRICING_MIXED: AssistPricing = {
  free: "Basic modes are free.",
  pro: "Advanced modes (AI, batch, or automation) require Pro.",
};
const AI_MODEL_NOTE =
  "The small on-device AI model downloads once when you first use it, then is cached locally and works offline.";

const RAW_ENTRIES: AssistToolEntry[] = [
  {
    id: "workflow-builder",
    toolId: "workflow-builder",
    displayName: "Workflow Builder",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Workflows & automation",
    aliases: [
      "workflow builder",
      "workflows",
      "automation",
      "workflow automation",
      "batch workflow",
      "saved workflow",
      "pipeline builder",
      "document pipeline",
    ],
    examples: [
      "what is workflow builder",
      "build a workflow",
      "automate redact then bates",
      "save a workflow for later",
      "run the same steps on many files",
    ],
    capabilitySummary: "Builds reusable PDF processing pipelines from existing verified tools.",
    answer:
      "Workflow Builder lets you chain existing PDFMacro tools into a reusable pipeline — for example OCR, sanitize, Bates, watermark, protect, or eligible redaction steps — then save and run that workflow again. Free users can preview the builder; saving and running workflows require Pro.",
    upgradeCopy: "Workflow saving, running, and batch automation are Pro features. You can still ask how the builder works on any plan.",
  },
  {
    id: "workflows",
    toolId: "workflow-builder",
    displayName: "Workflows & automation",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Workflows & automation",
    aliases: ["workflows", "automation", "automate steps", "batch automation", "pipeline"],
    examples: [
      "automate my process",
      "workflow automation",
      "chain tools together",
      "run these steps automatically",
    ],
    capabilitySummary: "Saves and re-runs multi-step tool pipelines across many documents.",
    answer:
      "Workflows & automation is the Pro capability inside Workflow Builder. It lets you save a chain of verified tool steps and re-run them on other documents or in batch, without re-clicking each tool.",
    upgradeCopy: "Saving and running workflows requires Pro.",
  },
  {
    id: "citation-hyperlinker",
    toolId: "citation-hyperlinker",
    displayName: "Citation Hyperlinker",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Citation Hyperlinker",
    aliases: [
      "citation hyperlinker",
      "citation linker",
      "citation links",
      "hyperlink citations",
      "link citations",
      "case links",
      "legal citation links",
      "bluebook links",
    ],
    examples: [
      "what is citation hyperlinker",
      "link citations in this brief",
      "make case citations clickable",
      "hyperlink legal citations",
      "scan for citations and add links",
    ],
    capabilitySummary: "Finds US legal citations and adds clickable public lookup links after review.",
    answer:
      "Citation Hyperlinker scans the open PDF for US legal citations, lets you review and edit each detected citation, then writes clickable lookup links into the PDF. It labels targets as public lookups, not guaranteed case pages.",
    upgradeCopy: "Citation Hyperlinker is a Pro feature. You can still ask what it does on any plan.",
    requiresNetwork: "always",
    privacy:
      "Detection runs locally; the links you add point to public lookup URLs opened only when a reader clicks them.",
  },
  {
    id: "court-readiness",
    toolId: "court-readiness",
    displayName: "Court Readiness",
    category: "Legal",
    availability: "free",
    aliases: [
      "court readiness",
      "court ready",
      "court standards",
      "court filing check",
      "filing readiness",
      "pacer check",
      "efiling check",
      "court compliance",
    ],
    examples: [
      "what is court readiness",
      "is this court ready",
      "check court readiness",
      "scan for court filing issues",
      "fix this for court filing",
    ],
    capabilitySummary: "Runs a pre-flight filing check for size, font embedding, hidden content, and metadata risks.",
    answer:
      "Court Readiness runs a free pre-flight scan before filing. It checks practical filing risks such as file size limits, font embedding, and hidden or metadata content. Auto-fix can repair the hidden/metadata issues the app can safely fix; size and font warnings tell you what needs separate handling.",
  },
  {
    id: "table-of-authorities",
    toolId: "toa",
    displayName: "Table of Authorities",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Table of Authorities",
    aliases: [
      "table of authorities",
      "toa",
      "authority table",
      "authorities table",
      "case table",
      "bluebook toa",
      "legal authorities",
    ],
    examples: [
      "what is table of authorities",
      "what is toa",
      "build a table of authorities",
      "generate a TOA",
      "link citations and insert TOA",
    ],
    capabilitySummary: "Detects legal citations and prepares a Table of Authorities with internal page-jump links.",
    answer:
      "Table of Authorities scans the brief for legal citations, groups them into authorities, and can prepend a TOA with internal page-jump links. Its combined action can also hyperlink inline body citations while inserting the TOA.",
    upgradeCopy: "Table of Authorities is a Pro feature. You can still ask what it does on any plan.",
  },
  {
    id: "private-ai-assist-search",
    toolId: "pre-discovery",
    displayName: "Private AI assist & search",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Private AI assist & search",
    aliases: ["ai search", "semantic search", "document q&a", "ask this pdf", "search by meaning", "pre-discovery", "private ai"],
    examples: [
      "find dollar amounts in the document",
      "show passages about payments and damages",
      "ask questions about this PDF",
      "summarize the document",
      "find clauses by meaning, not exact words",
      "money figures and financial amounts",
      "key dates and deadlines",
    ],
    capabilitySummary: "Searches and answers questions using on-device MiniLM embeddings so the document stays in this browser.",
    answer:
      "Private AI assist & search finds passages by meaning and answers questions about the open PDF using on-device embeddings. It is meant for understanding, review, and discovery triage — not for deterministic edits.",
    upgradeCopy: "Running semantic search or document Q&A is a Pro feature. The model downloads once while online and is cached on this device for future use.",
    requiresNetwork: "first-load",
    limits: AI_MODEL_NOTE,
  },
  {
    id: "chat",
    toolId: "chat",
    displayName: "Private AI assist (chat)",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Private AI assist",
    aliases: [
      "chat",
      "chat with pdf",
      "ask this document",
      "talk to my pdf",
      "conversation with pdf",
      "qa this pdf",
      "ask questions of this pdf",
    ],
    examples: [
      "chat with this pdf",
      "ask a question about the document",
      "talk to my pdf",
      "have a conversation with this document",
    ],
    capabilitySummary: "Conversational Q&A over the open PDF using on-device embeddings.",
    answer:
      "Private AI assist (chat) lets you have a back-and-forth conversation with the open PDF. Questions and answers are grounded in passages found on-device, so the document itself never leaves this browser.",
    upgradeCopy: "Private AI chat is a Pro feature. The model downloads once and then works locally.",
    requiresNetwork: "first-load",
    limits: AI_MODEL_NOTE,
  },
  {
    id: "redact",
    toolId: "redact",
    displayName: "Redact for production",
    category: "Legal",
    availability: "free",
    aliases: ["redact", "redaction", "black out", "burn redactions", "remove sensitive text", "verifiable redaction"],
    examples: ["redact SSNs", "black out phone numbers", "remove confidential names", "redact every email address"],
    capabilitySummary: "Marks and burns redactions into an exported copy with verification.",
    answer: "Redact for production lets you mark sensitive areas, review matches, then export a verified redacted PDF. The original source bytes stay read-only; the final burn happens only during export.",
    destructive: true,
  },
  {
    id: "ai-detect-sensitive",
    toolId: "redact",
    displayName: "AI detect sensitive info",
    category: "Legal",
    availability: "pro",
    proFeatureName: "AI sensitive-data detection",
    aliases: ["detect pii", "scan sensitive information", "find names", "find organizations", "ner detection"],
    examples: ["scan for sensitive info", "detect SSNs and names", "find all PII", "automatically find private data"],
    capabilitySummary: "Uses on-device detection models and patterns to find likely sensitive items before redaction.",
    answer: "AI sensitive-data detection scans the PDF on this device for likely PII such as SSNs, emails, phone numbers, names, organizations, and financial identifiers, then loads findings into Redact for review.",
    upgradeCopy: "Automatic sensitive-data detection is Pro. Manual redaction stays free.",
    destructive: true,
    requiresNetwork: "first-load",
    limits: AI_MODEL_NOTE,
  },
  {
    id: "pattern-bulk-redact",
    toolId: "redact",
    displayName: "Pattern & bulk redaction",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Pattern / bulk redaction",
    aliases: ["find and redact", "bulk redact", "regex redact", "redact every occurrence"],
    examples: ["redact every occurrence of John Smith", "bulk redact this phrase", "use a pattern to redact account numbers"],
    capabilitySummary: "Finds repeated text or patterns and prepares them for verified redaction.",
    answer: "Pattern & bulk redaction finds every occurrence of a word, phrase, or pattern and sends those matches to Redact for review and verified export.",
    upgradeCopy: "Bulk/pattern redaction is Pro. You can still mark redactions manually for free.",
    destructive: true,
  },
  {
    id: "bates",
    toolId: "bates",
    displayName: "Bates stamp",
    category: "Legal",
    availability: "free",
    aliases: ["bates", "bates numbering", "production numbers", "discovery labels", "bates labels"],
    examples: ["add Bates numbers", "stamp ABC000123", "number a production set", "add discovery page identifiers"],
    capabilitySummary: "Adds legal production identifiers with prefix, numbering, and placement controls.",
    answer: "Bates stamping adds unique production identifiers such as ABC000123. It is different from ordinary page numbers because it is used to identify produced pages across discovery sets.",
  },
  {
    id: "multi-file-bates",
    toolId: "bates",
    displayName: "Multi-file Bates",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Multi-file Bates",
    aliases: ["multi file bates", "bates across files", "batch bates", "cross-document bates", "continuous bates"],
    examples: [
      "stamp bates across many pdfs",
      "continue bates numbering across files",
      "apply bates to a production set",
    ],
    capabilitySummary: "Applies continuous Bates numbering across multiple PDFs in one production set.",
    answer:
      "Multi-file Bates is the Pro capability inside Bates that stamps continuous production numbers across a whole set of PDFs, so numbering carries from one document to the next without resetting.",
    upgradeCopy: "Single-file Bates is free; stamping across many files at once requires Pro.",
  },
  {
    id: "batch-processing",
    toolId: "batch",
    displayName: "Batch processing",
    category: "Assemble",
    availability: "pro",
    proFeatureName: "Batch processing",
    aliases: [
      "batch",
      "batch processing",
      "batch mode",
      "process many files",
      "apply to multiple pdfs",
      "run on a folder",
    ],
    examples: [
      "batch process these files",
      "run the same tool on many pdfs",
      "apply watermark to a whole folder",
      "compress a batch of pdfs",
    ],
    capabilitySummary: "Runs eligible tools across many PDFs in one pass with a shared progress view.",
    answer:
      "Batch processing runs an eligible tool — for example compress, watermark, page numbers, header/footer, or Bates — across many PDFs in one pass, with a shared progress view and one zipped output.",
    upgradeCopy: "Batch processing across many files is a Pro capability.",
  },
  {
    id: "page-numbers",
    toolId: "doc-settings",
    displayName: "Page Numbers",
    category: "Layout",
    availability: "free",
    aliases: ["page numbers", "ordinary page numbers", "page x of y", "footer page number", "number pages"],
    examples: ["add page numbers", "put page x of y at the bottom", "number pages 1 2 3"],
    capabilitySummary: "Adds reading page numbers, separate from Bates production labels.",
    answer: "Page Numbers adds ordinary reading numbers such as 1, 2, 3 or Page X of Y. Use Bates instead when you need discovery production identifiers.",
    focusSection: "page-numbers",
  },
  {
    id: "header-footer",
    toolId: "header-footer",
    displayName: "Header & Footer",
    category: "Layout",
    availability: "free",
    aliases: ["header", "footer", "header and footer", "running header", "page header", "running footer"],
    examples: [
      "add a header",
      "put a footer on every page",
      "add running text at the top of each page",
      "header and footer",
    ],
    capabilitySummary: "Adds running header/footer text at the top or bottom of every page.",
    answer:
      "Header & Footer adds running text at the top or bottom of every page — for example a case caption, date, or filename. Use Watermark for a diagonal or across-the-page mark, and Page Numbers for numeric reading labels.",
  },
  {
    id: "watermark",
    toolId: "watermark",
    displayName: "Watermark",
    category: "Edit",
    availability: "free",
    aliases: ["watermark", "stamp draft", "confidential watermark", "diagonal watermark", "background mark"],
    examples: ["watermark", "add a confidential watermark", "stamp DRAFT diagonally", "put a translucent mark on every page"],
    capabilitySummary: "Places a visible watermark such as CONFIDENTIAL or DRAFT across pages.",
    answer: "Watermark places a visible mark such as CONFIDENTIAL, DRAFT, or a custom label across selected pages. Use Header/Footer for running text at page edges.",
  },
  {
    id: "flatten",
    toolId: "flatten-settings",
    displayName: "Flatten",
    category: "Edit",
    availability: "free",
    aliases: ["flatten", "flatten pdf", "flatten annotations", "flatten form", "lock annotations"],
    examples: [
      "flatten this pdf",
      "flatten annotations into the page",
      "lock form fields into the document",
      "burn comments into the pdf",
    ],
    capabilitySummary: "Burns annotations and form fields into the page so they can't be edited.",
    answer:
      "Flatten burns annotations and form fields into the page content so a reader can't remove or edit them later. It's the safe way to send an as-viewed copy without exposing form values or notes as separate objects.",
  },
  {
    id: "split",
    toolId: "split",
    displayName: "Split",
    category: "Assemble",
    availability: "mixed",
    proFeatureName: "Smart Document Splitter",
    aliases: ["split pdf", "separate pages", "break apart", "divide document"],
    examples: ["split", "split this PDF", "separate every page", "split every 10 pages"],
    capabilitySummary: "Breaks a PDF into smaller files; manual split modes are free and smart split is Pro.",
    answer: "Split breaks a PDF into separate outputs. Free modes include splitting by page ranges or every N pages; smart/AI-assisted splitting is a Pro capability inside the Split tool.",
    freeModes: ["Page ranges", "Every N pages", "Manual split points"],
    upgradeCopy: "Smart split is Pro, but the Split panel also includes free manual modes.",
  },
  {
    id: "smart-split",
    toolId: "split",
    displayName: "Smart Document Splitter",
    category: "Assemble",
    availability: "pro",
    proFeatureName: "Smart Document Splitter",
    aliases: [
      "smart split",
      "auto split",
      "split by sections",
      "split by chapters",
      "split by document boundaries",
      "ai split",
    ],
    examples: [
      "smart split by sections",
      "auto-split this combined pdf into separate documents",
      "detect document boundaries and split",
    ],
    capabilitySummary: "Detects natural document boundaries and splits a combined PDF into separate files.",
    answer:
      "Smart Document Splitter is the Pro capability inside Split. It detects natural document boundaries — for example where one filing ends and the next begins — and splits a combined PDF into separate files without you having to pick page ranges.",
    upgradeCopy: "Smart split is Pro. Free split modes (ranges, every N pages) stay available.",
    requiresNetwork: "first-load",
    limits: AI_MODEL_NOTE,
  },
  {
    id: "merge",
    toolId: "merge",
    displayName: "Merge",
    category: "Assemble",
    availability: "free",
    aliases: ["merge", "combine pdfs", "join pdfs", "append files", "assemble documents"],
    examples: ["merge PDFs", "combine these files", "join documents into one PDF"],
    capabilitySummary: "Combines multiple PDFs into one output.",
    answer: "Merge combines multiple PDFs into a single document. Use Organize afterward if you need to reorder pages.",
  },
  {
    id: "organize",
    toolId: "organize",
    displayName: "Organize",
    category: "Assemble",
    availability: "free",
    aliases: ["organize", "reorder pages", "delete pages", "move pages", "page thumbnails"],
    examples: ["reorder pages", "delete page 3", "move the exhibit to the front"],
    capabilitySummary: "Reorders, deletes, rotates, or manages pages visually.",
    answer: "Organize shows page thumbnails so you can reorder and remove pages before exporting a new copy.",
  },
  {
    id: "extract",
    toolId: "extract",
    displayName: "Extract Pages",
    category: "Assemble",
    availability: "free",
    aliases: ["extract", "extract pages", "pull out pages", "export selected pages", "save pages as pdf"],
    examples: [
      "extract pages 5 to 10",
      "pull out the exhibit as a separate pdf",
      "save selected pages as a new file",
    ],
    capabilitySummary: "Exports selected pages into a new standalone PDF.",
    answer:
      "Extract Pages copies chosen pages into a new PDF and leaves the original unchanged. Use it when you want a slice of a document as its own file.",
  },
  {
    id: "rotate",
    toolId: "rotate",
    displayName: "Rotate",
    category: "Layout",
    availability: "free",
    aliases: ["rotate", "rotate pages", "fix orientation", "turn page", "landscape to portrait"],
    examples: [
      "rotate page 3 ninety degrees",
      "fix upside-down pages",
      "rotate all pages clockwise",
    ],
    capabilitySummary: "Rotates specific pages or the whole document in 90° steps.",
    answer:
      "Rotate turns pages in 90° steps so scanned pages face the right way. It writes the rotation into the exported copy without re-rendering the content.",
  },
  {
    id: "page-crop",
    toolId: "page-crop",
    displayName: "Crop Pages",
    category: "Layout",
    availability: "free",
    aliases: ["crop", "crop pages", "trim margins", "trim page", "cut margins", "resize page"],
    examples: [
      "crop the margins",
      "trim white space around the page",
      "crop pages to a custom size",
    ],
    capabilitySummary: "Trims page margins or crops to a custom rectangle.",
    answer:
      "Crop Pages trims margins or crops to a custom rectangle. The original content is preserved outside the visible area unless you flatten afterward.",
  },
  {
    id: "compress",
    toolId: "compress",
    displayName: "Compress",
    category: "Convert",
    availability: "free",
    aliases: ["compress", "shrink pdf", "reduce file size", "make pdf smaller", "optimize pdf"],
    examples: [
      "compress this pdf",
      "shrink the file size for email",
      "reduce this pdf for filing",
    ],
    capabilitySummary: "Reduces PDF file size by re-encoding images and cleaning up unused objects.",
    answer:
      "Compress makes a PDF smaller by re-encoding images and cleaning up unused objects. Text stays selectable; heavily image-based PDFs shrink the most.",
  },
  {
    id: "image-convert",
    toolId: "image-convert",
    displayName: "Images ↔ PDF",
    category: "Convert",
    availability: "free",
    aliases: [
      "image convert",
      "images to pdf",
      "pdf to images",
      "jpg to pdf",
      "png to pdf",
      "pdf to jpg",
      "pdf to png",
    ],
    examples: [
      "convert images to pdf",
      "turn this pdf into images",
      "jpg to pdf",
      "export each page as png",
    ],
    capabilitySummary: "Converts images to a PDF or a PDF's pages to images.",
    answer:
      "Images ↔ PDF converts a set of images into a single PDF, or exports each page of a PDF as an image file. Everything is processed locally.",
  },
  {
    id: "outline",
    toolId: "outline",
    displayName: "Outline & Bookmarks",
    category: "Layout",
    availability: "free",
    aliases: [
      "outline",
      "bookmarks",
      "table of contents",
      "toc",
      "add bookmarks",
      "edit bookmarks",
      "document outline",
    ],
    examples: [
      "add bookmarks",
      "edit the outline",
      "build a table of contents",
      "add outline entries for each section",
    ],
    capabilitySummary: "Edits the PDF outline / bookmarks and internal links.",
    answer:
      "Outline & Bookmarks manages the collapsible sidebar bookmarks readers use to jump around a PDF. You can add, rename, indent, and delete entries, and link them to pages.",
  },
  {
    id: "compare",
    toolId: "compare",
    displayName: "Compare",
    category: "Legal",
    availability: "free",
    aliases: [
      "compare",
      "diff",
      "diff pdfs",
      "compare two pdfs",
      "compare versions",
      "compare drafts",
      "what changed",
    ],
    examples: [
      "compare two pdfs",
      "diff two versions of a contract",
      "show what changed between drafts",
      "compare versions side by side",
    ],
    capabilitySummary: "Highlights differences between two PDF versions side-by-side.",
    answer:
      "Compare puts two PDFs next to each other and highlights where they differ. Useful for spotting changes between contract drafts, revised filings, or before/after copies.",
  },
  {
    id: "ocr",
    toolId: "ocr",
    displayName: "Make Searchable (OCR)",
    category: "Legal",
    availability: "free",
    aliases: ["ocr", "recognize text", "scanned pdf", "make text selectable"],
    examples: ["make this searchable", "run OCR", "recognize text in scanned pages"],
    capabilitySummary: "Adds a text layer to scanned pages on-device.",
    answer: "Make Searchable runs OCR on scanned-looking pages and adds a text layer so the PDF can be searched and edited. It runs locally and does not alter the original source bytes.",
    requiresNetwork: "first-load",
    limits: "OCR language models download once, then run offline.",
  },
  {
    id: "sanitize",
    toolId: "sanitize",
    displayName: "Sanitize",
    category: "Legal",
    availability: "free",
    aliases: ["sanitize", "scrub metadata", "remove hidden data", "strip document properties", "clean pdf"],
    examples: ["sanitize this document", "remove metadata", "strip hidden layers and comments"],
    capabilitySummary: "Removes metadata, hidden content, comments, and other risky extras before sharing.",
    answer: "Sanitize removes metadata and hidden document data from an exported copy. It is separate from Redact: sanitize cleans file-level hidden data, while redaction removes visible page content.",
    destructive: true,
  },
  {
    id: "privilege-scan",
    toolId: "privilege-scan",
    displayName: "Privilege review",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Privilege review (AI)",
    aliases: ["privilege", "privilege scan", "attorney client", "work product", "privileged passages"],
    examples: ["scan for privilege", "find attorney-client communications", "flag work product language"],
    capabilitySummary: "Flags possible attorney-client, work-product, and confidentiality indicators for review.",
    answer: "Privilege review flags possible attorney-client, work-product, counsel-name, and confidentiality signals so a reviewer can inspect them before production.",
    upgradeCopy: "Privilege review is a Pro feature because it uses advanced on-device review logic.",
    requiresNetwork: "first-load",
    limits: AI_MODEL_NOTE,
  },
  {
    id: "exhibit-binder",
    toolId: "exhibit-binder",
    displayName: "Exhibit Binder",
    category: "Legal",
    availability: "pro",
    proFeatureName: "Exhibit Binder",
    aliases: ["binder", "exhibit binder", "trial exhibits", "exhibit set", "exhibit tabs"],
    examples: ["build an exhibit binder", "assemble trial exhibits", "make a binder with tabs and index"],
    capabilitySummary: "Assembles multiple PDFs into a court-ready exhibit binder with tabs and index.",
    answer: "Exhibit Binder assembles multiple PDFs into a single court-ready binder with cover material, exhibit tabs, and an index.",
    upgradeCopy: "Exhibit Binder is a Pro feature.",
  },
  {
    id: "protect",
    toolId: "protect",
    displayName: "Protect",
    category: "Secure",
    availability: "free",
    aliases: ["protect", "password protect", "encrypt pdf", "secure pdf", "require password"],
    examples: ["password protect this PDF", "encrypt the file", "require a password to open"],
    capabilitySummary: "Encrypts the exported PDF with a password.",
    answer: "Protect encrypts a PDF with a password so opening it requires the passphrase you set.",
  },
  {
    id: "unlock",
    toolId: "unlock",
    displayName: "Unlock",
    category: "Secure",
    availability: "free",
    aliases: ["unlock", "remove password", "decrypt pdf", "unlock encrypted file"],
    examples: ["remove the password", "unlock this PDF", "decrypt a file I own"],
    capabilitySummary: "Removes password protection when you have the password/permission.",
    answer: "Unlock removes password protection from a PDF you are allowed to open, creating an unlocked working copy.",
  },
  {
    id: "repair",
    toolId: "repair",
    displayName: "Repair PDF",
    category: "Secure",
    availability: "free",
    aliases: ["repair", "fix pdf", "corrupt pdf", "damaged document", "file will not open"],
    examples: ["repair this PDF", "fix a damaged file", "this PDF is corrupted"],
    capabilitySummary: "Attempts to rebuild a damaged PDF into a usable copy.",
    answer: "Repair PDF attempts to recover a damaged or malformed PDF and writes a fresh repaired copy. Your original file is not changed.",
  },
  {
    id: "sign",
    toolId: "sign",
    displayName: "Sign & Fill",
    category: "Edit",
    availability: "free",
    aliases: ["sign", "signature", "fill form", "sign pdf", "type into form"],
    examples: ["sign this PDF", "add my signature", "fill in form fields"],
    capabilitySummary: "Adds signatures, initials, and form text.",
    answer: "Sign & Fill lets you place signatures, initials, dates, and typed text onto the PDF before export.",
  },
  {
    id: "comments",
    toolId: "comments",
    displayName: "Comments",
    category: "Edit",
    availability: "free",
    aliases: ["comments", "notes", "sticky notes", "annotations"],
    examples: ["show comments", "add a note", "review the sticky notes"],
    capabilitySummary: "Adds and reviews non-destructive annotations.",
    answer: "Comments lets you mark up the PDF with notes and replies without removing content. Highlights and underlines live in the same panel.",
  },
  {
    id: "highlight",
    toolId: "comments",
    displayName: "Highlight & Underline",
    category: "Edit",
    availability: "free",
    aliases: ["highlight", "highlighter", "underline", "yellow highlight", "mark passage"],
    examples: [
      "highlight important passages",
      "underline this sentence",
      "yellow highlight over a paragraph",
      "add a highlight to page 2",
    ],
    capabilitySummary: "Adds color highlights and underlines as reviewable annotations.",
    answer:
      "Highlight & Underline mark passages as annotations — reviewable, movable, and non-destructive. Use Redact instead when the text must actually be removed.",
    focusSection: "highlight",
  },
  {
    id: "convert",
    toolId: "convert",
    displayName: "Convert",
    category: "Convert",
    availability: "free",
    aliases: ["convert", "export as word", "pdf to docx", "pdf/a", "convert file"],
    examples: ["convert to Word", "export as PDF/A", "save as DOCX"],
    capabilitySummary: "Converts the PDF into supported output formats.",
    answer: "Convert exports the document into supported formats such as Word-style output or archival PDF/A when available.",
  },
  {
    id: "mail-merge",
    toolId: "mail-merge",
    displayName: "Mail Merge",
    category: "Assemble",
    availability: "pro",
    proFeatureName: "Mail Merge",
    aliases: [
      "mail merge",
      "csv merge",
      "template merge",
      "bulk fill",
      "generate letters",
      "data driven pdf",
    ],
    examples: [
      "mail merge with a csv",
      "generate one pdf per row",
      "bulk fill this form from a spreadsheet",
      "personalize letters from a csv",
    ],
    capabilitySummary: "Generates one personalized PDF per row from a template + CSV.",
    answer:
      "Mail Merge takes a PDF template with named fields and a CSV of recipients, then generates one personalized PDF per row. Everything runs locally.",
    upgradeCopy: "Mail Merge is a Pro feature.",
  },
  {
    id: "document-hash",
    toolId: "document-hash",
    displayName: "Document Hash",
    category: "Legal",
    availability: "free",
    aliases: ["hash", "checksum", "sha-256", "file fingerprint", "chain of custody"],
    examples: ["compute SHA-256", "generate a checksum", "fingerprint this PDF"],
    capabilitySummary: "Computes a file hash for verification and chain-of-custody records.",
    answer: "Document Hash computes a SHA-256 fingerprint for the file so you can prove whether a copy has changed.",
  },
];

/** Apply default meta to every entry so router/UI can always read them. */
export const ASSIST_KNOWLEDGE_BASE: AssistToolEntry[] = RAW_ENTRIES.map((e) => {
  const baseline: AssistPricing =
    e.availability === "pro"
      ? DEFAULT_PRICING_PRO
      : e.availability === "mixed"
        ? DEFAULT_PRICING_MIXED
        : DEFAULT_PRICING_FREE;
  return {
    ...e,
    pricing: e.pricing ?? baseline,
    privacy: e.privacy ?? DEFAULT_PRIVACY,
    runsOffline: e.runsOffline ?? true,
    requiresNetwork: e.requiresNetwork ?? "never",
  };
});

export function getAssistToolEntry(idOrToolId: string): AssistToolEntry | undefined {
  return ASSIST_KNOWLEDGE_BASE.find((entry) => entry.id === idOrToolId || entry.toolId === idOrToolId);
}

/* ------------------------------------------------------------------ */
/* Topical (non-tool) knowledge                                       */
/* ------------------------------------------------------------------ */

export interface AssistTopicAction {
  label: string;
  /** Well-known action id the panel maps to an existing surface. */
  kind: "open-pricing" | "open-upgrade" | "open-security" | "open-privacy" | "external";
  href?: string;
}

export interface AssistTopicEntry {
  id: string;
  displayName: string;
  aliases: string[];
  examples: string[];
  answer: string;
  actions?: AssistTopicAction[];
}

export const ASSIST_TOPICS: AssistTopicEntry[] = [
  {
    id: "pricing",
    displayName: "Pricing",
    aliases: ["pricing", "price", "cost", "how much", "plans", "subscription", "pro plan", "upgrade cost"],
    examples: [
      "how much does pro cost",
      "what are the plans",
      "pricing",
      "how much is a subscription",
      "what does pro cost per month",
    ],
    answer:
      "PDFMacro has a free plan with the core PDF tools (redact, sanitize, Bates, OCR, sign, merge, split, protect, and more) and a Pro plan that unlocks AI features like sensitive-data detection, private AI assist, Privilege review, Workflow Builder, Exhibit Binder, Mail Merge, and multi-file / batch capabilities. See the Pricing page for current tiers.",
    actions: [
      { label: "See pricing", kind: "open-pricing", href: "/pricing" },
      { label: "Upgrade", kind: "open-upgrade" },
    ],
  },
  {
    id: "offline",
    displayName: "Offline use",
    aliases: ["offline", "no internet", "airplane mode", "works offline", "internet required"],
    examples: [
      "does it work offline",
      "can i use this without internet",
      "works on a plane",
      "offline mode",
    ],
    answer:
      "Yes — PDFMacro runs in your browser and works offline for every tool once the page has loaded. AI features (sensitive-data detection, private AI assist, smart split, Privilege review) download a small model the first time online, then run locally on later use.",
  },
  {
    id: "privacy",
    displayName: "Privacy",
    aliases: ["privacy", "private", "is my file uploaded", "does my file leave", "who sees my document"],
    examples: [
      "is my file uploaded",
      "does the pdf leave my computer",
      "is this private",
      "who can see my document",
    ],
    answer:
      "Your PDF stays on your device. Every tool — redaction, OCR, AI detection, search — runs in this browser. Files are not uploaded to any server, and the app has no way to see them.",
    actions: [{ label: "How privacy works", kind: "open-privacy", href: "/verify-privacy" }],
  },
  {
    id: "models",
    displayName: "AI models",
    aliases: ["model", "ai model", "which model", "what model", "llm", "minilm", "which llm"],
    examples: [
      "what model do you use",
      "which ai model",
      "what llm powers this",
      "which embedding model",
    ],
    answer:
      "Semantic search and private AI assist use a small on-device embedding model (MiniLM). Named-entity detection uses an on-device NER model. Both download once when you first use an AI feature, then are cached locally in your browser and run offline.",
  },
  {
    id: "pro-vs-free",
    displayName: "Pro vs Free",
    aliases: ["pro vs free", "free vs pro", "whats in pro", "what does pro include", "what is free"],
    examples: [
      "what is included in pro",
      "difference between free and pro",
      "what do i get with pro",
      "what's free",
    ],
    answer:
      "Free covers the core PDF tools: redact (manual), sanitize, Bates (single file), page numbers, header/footer, watermark, merge, split (manual modes), organize, extract, rotate, crop, compress, convert, images ↔ PDF, sign & fill, protect, unlock, repair, comments, highlight, outline, compare, court readiness, and document hash. Pro adds AI sensitive-data detection, pattern/bulk redaction, private AI assist & chat, Privilege review, smart split, Workflow Builder, batch processing, multi-file Bates, Exhibit Binder, Mail Merge, Citation Hyperlinker, and Table of Authorities.",
    actions: [{ label: "See pricing", kind: "open-pricing", href: "/pricing" }],
  },
  {
    id: "supported-formats",
    displayName: "Supported formats",
    aliases: ["formats", "file types", "supported files", "what can i open", "input formats"],
    examples: [
      "what file types are supported",
      "what formats can i open",
      "can i convert word to pdf",
      "supported file types",
    ],
    answer:
      "The workspace opens PDFs directly. Convert exports to Word-style output and archival PDF/A. Images ↔ PDF converts JPG/PNG images to PDF and can export PDF pages back to images.",
  },
  {
    id: "account",
    displayName: "Account & sign-in",
    aliases: ["account", "sign in", "log in", "login", "signup", "sign up", "reset password"],
    examples: [
      "how do i sign in",
      "do i need an account",
      "reset my password",
      "how do i sign up",
    ],
    answer:
      "Free tools work without an account. To use Pro features or sync licensing across devices, sign in from the account menu. Password reset lives on the sign-in screen.",
  },
  {
    id: "security",
    displayName: "Security architecture",
    aliases: ["security", "encryption", "safe", "how secure", "security model"],
    examples: [
      "how secure is this",
      "what is the security model",
      "is it end to end encrypted",
      "security architecture",
    ],
    answer:
      "PDFMacro processes documents entirely in your browser, so there is no server-side copy to compromise. Passwords you set with Protect encrypt the exported PDF itself. The Security Architecture page explains the model in detail.",
    actions: [{ label: "Security architecture", kind: "open-security", href: "/security-architecture" }],
  },
  {
    id: "data-retention",
    displayName: "Data retention",
    aliases: ["retention", "storage", "where is my data", "saved data", "history"],
    examples: [
      "how long is my data kept",
      "where is my document stored",
      "do you keep my files",
      "data retention",
    ],
    answer:
      "Documents are held only in this browser tab for the duration of your session, plus a local cache (IndexedDB) for the recent-files list and sidecar edits so you can resume. Nothing is stored on any server. Clearing browser storage removes everything.",
  },
];

export function getAssistTopic(id: string): AssistTopicEntry | undefined {
  return ASSIST_TOPICS.find((t) => t.id === id);
}

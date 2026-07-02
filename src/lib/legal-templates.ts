/**
 * Built-in legal document templates.
 *
 * Each template is generated on-device as a properly formatted PDF skeleton
 * with [BRACKETED] placeholders. Opens as an editable document in the
 * workspace — the user fills in fields and exports.
 *
 * Templates are STARTING STRUCTURES only, not legal advice. A disclaimer
 * is baked into the footer of every template.
 */
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";

export type LegalTemplateId =
  | "demand-letter"
  | "engagement-letter"
  | "legal-memo"
  | "transmittal-letter"
  | "fee-agreement";

export type LegalTemplate = {
  id: LegalTemplateId;
  label: string;
  description: string;
  fileName: string;
};

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  {
    id: "demand-letter",
    label: "Demand Letter",
    description: "Formal demand with facts, deadline, and consequences.",
    fileName: "Demand Letter.pdf",
  },
  {
    id: "engagement-letter",
    label: "Engagement Letter",
    description: "Retainer / scope of representation for a new client.",
    fileName: "Engagement Letter.pdf",
  },
  {
    id: "legal-memo",
    label: "Legal Memo",
    description: "IRAC memorandum — Question, Answer, Facts, Discussion.",
    fileName: "Legal Memo.pdf",
  },
  {
    id: "transmittal-letter",
    label: "Transmittal / Cover Letter",
    description: "Cover letter enclosing documents.",
    fileName: "Transmittal Letter.pdf",
  },
  {
    id: "fee-agreement",
    label: "Fee Agreement",
    description: "Hourly / flat / contingency fee structure.",
    fileName: "Fee Agreement.pdf",
  },
];

// Letter, 1" margins.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;

const DISCLAIMER =
  "Template is a starting structure — review and adapt for your jurisdiction and matter. Not legal advice.";

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  body: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
};

function newPage(ctx: Ctx): PDFPage {
  const p = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.page = p;
  ctx.y = PAGE_H - MARGIN;
  drawFooter(ctx);
  return p;
}

function drawFooter(ctx: Ctx) {
  const size = 8;
  const text = DISCLAIMER;
  const w = ctx.italic.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, {
    x: (PAGE_W - w) / 2,
    y: 36,
    size,
    font: ctx.italic,
    color: rgb(0.45, 0.45, 0.5),
  });
}

function ensureRoom(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 24) newPage(ctx);
}

function wrap(font: PDFFont, size: number, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function para(ctx: Ctx, text: string, opts: { size?: number; font?: PDFFont; gap?: number; indent?: number } = {}) {
  const size = opts.size ?? 11;
  const font = opts.font ?? ctx.body;
  const indent = opts.indent ?? 0;
  const lh = size * 1.35;
  const lines = wrap(font, size, text, CONTENT_W - indent);
  for (const line of lines) {
    ensureRoom(ctx, lh);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y - size,
      size,
      font,
      color: rgb(0.1, 0.1, 0.12),
    });
    ctx.y -= lh;
  }
  ctx.y -= opts.gap ?? 6;
}

function heading(ctx: Ctx, text: string, size = 12) {
  ensureRoom(ctx, size * 2);
  ctx.y -= 4;
  ctx.page.drawText(text, {
    x: MARGIN,
    y: ctx.y - size,
    size,
    font: ctx.bold,
    color: rgb(0.05, 0.05, 0.08),
  });
  ctx.y -= size * 1.5;
}

function title(ctx: Ctx, text: string) {
  const size = 16;
  const w = ctx.bold.widthOfTextAtSize(text, size);
  ctx.page.drawText(text, {
    x: (PAGE_W - w) / 2,
    y: ctx.y - size,
    size,
    font: ctx.bold,
    color: rgb(0.05, 0.05, 0.08),
  });
  ctx.y -= size * 1.8;
}

function spacer(ctx: Ctx, h = 10) {
  ctx.y -= h;
}

function signatureLine(ctx: Ctx, label: string) {
  ensureRoom(ctx, 40);
  const lineY = ctx.y - 18;
  ctx.page.drawLine({
    start: { x: MARGIN, y: lineY },
    end: { x: MARGIN + 260, y: lineY },
    thickness: 0.75,
    color: rgb(0.35, 0.35, 0.4),
  });
  ctx.page.drawText(label, {
    x: MARGIN,
    y: lineY - 12,
    size: 9,
    font: ctx.body,
    color: rgb(0.4, 0.4, 0.45),
  });
  ctx.y = lineY - 26;
}

async function makeCtx(): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.setTitle("Legal Template");
  doc.setProducer("CounselPDF Templates");
  const body = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const ctx: Ctx = { doc, page: null as unknown as PDFPage, y: 0, body, bold, italic };
  newPage(ctx);
  return ctx;
}

/* --------------------------- Templates --------------------------- */

async function buildDemandLetter(): Promise<Uint8Array> {
  const ctx = await makeCtx();
  para(ctx, "[YOUR FIRM]", { font: ctx.bold, size: 12 });
  para(ctx, "[Firm Address]");
  para(ctx, "[City, State ZIP]");
  para(ctx, "[Phone] · [Email]", { gap: 18 });

  para(ctx, "[DATE]", { gap: 14 });

  para(ctx, "[RECIPIENT NAME]");
  para(ctx, "[Recipient Title / Company]");
  para(ctx, "[Recipient Address]");
  para(ctx, "[City, State ZIP]", { gap: 14 });

  para(ctx, "Via [Certified Mail / Email / Hand Delivery]", { font: ctx.italic, gap: 14 });

  para(ctx, "RE:  [BRIEF DESCRIPTION OF MATTER]", { font: ctx.bold, gap: 14 });

  para(ctx, "Dear [RECIPIENT]:", { gap: 10 });

  para(ctx, "This firm represents [CLIENT NAME] in connection with the matter described above. This letter constitutes a formal demand and is sent in an effort to resolve this matter without the need for further action.");

  heading(ctx, "Statement of Facts");
  para(ctx, "[Set forth the material facts giving rise to the claim, in chronological order.]");

  heading(ctx, "Demand");
  para(ctx, "Accordingly, demand is hereby made that [RECIPIENT] [describe the requested action, e.g., remit payment in the amount of $[AMOUNT], cease and desist from …, deliver …].");

  heading(ctx, "Deadline");
  para(ctx, "This demand must be satisfied on or before [DEADLINE]. Time is of the essence.");

  heading(ctx, "Consequences");
  para(ctx, "In the event that [RECIPIENT] fails to comply by the deadline, [CLIENT NAME] is prepared to pursue all available legal remedies, including [litigation / injunctive relief / claims for damages and fees], without further notice.");

  spacer(ctx, 12);
  para(ctx, "Nothing in this letter shall be construed as a waiver of any of [CLIENT NAME]'s rights or remedies, all of which are expressly reserved.");

  spacer(ctx, 16);
  para(ctx, "Sincerely,", { gap: 42 });
  signatureLine(ctx, "[ATTORNEY NAME], Esq.");
  para(ctx, "[YOUR FIRM]");

  return await ctx.doc.save();
}

async function buildEngagementLetter(): Promise<Uint8Array> {
  const ctx = await makeCtx();
  para(ctx, "[YOUR FIRM]", { font: ctx.bold, size: 12 });
  para(ctx, "[Firm Address] · [Phone] · [Email]", { gap: 18 });

  para(ctx, "[DATE]", { gap: 14 });
  para(ctx, "[CLIENT NAME]");
  para(ctx, "[Client Address]", { gap: 14 });

  para(ctx, "RE:  Engagement of [YOUR FIRM] — [MATTER DESCRIPTION]", { font: ctx.bold, gap: 14 });

  para(ctx, "Dear [CLIENT]:", { gap: 10 });
  para(ctx, "Thank you for retaining [YOUR FIRM] (\"the Firm\") to represent you in connection with the above matter. This letter confirms the terms of our engagement.");

  heading(ctx, "1.  Parties");
  para(ctx, "This engagement is between [CLIENT NAME] (\"Client\") and [YOUR FIRM] (\"Firm\").");

  heading(ctx, "2.  Scope of Representation");
  para(ctx, "The Firm will represent Client with respect to [describe scope, e.g., defense of the claims asserted in …, negotiation of …]. This engagement does not include [expressly excluded matters, e.g., appeals, tax advice, related litigation].");

  heading(ctx, "3.  Fees and Billing");
  para(ctx, "Legal services will be billed at the following rates: [Attorney Name] — $[RATE]/hour; [Associate] — $[RATE]/hour; [Paralegal] — $[RATE]/hour. Time is recorded in tenth-of-an-hour increments. Invoices are issued monthly and are due within [30] days.");

  heading(ctx, "4.  Retainer");
  para(ctx, "Client shall deposit an initial retainer of $[RETAINER AMOUNT], to be held in the Firm's trust account and applied against fees and costs incurred. Client agrees to replenish the retainer upon request.");

  heading(ctx, "5.  Costs and Expenses");
  para(ctx, "Client is responsible for out-of-pocket costs, including filing fees, expert witness fees, travel, courier, and reproduction charges.");

  heading(ctx, "6.  Client Responsibilities");
  para(ctx, "Client agrees to provide accurate and complete information, respond promptly to Firm communications, and cooperate in the prosecution or defense of the matter.");

  heading(ctx, "7.  Termination");
  para(ctx, "Either party may terminate this engagement upon written notice, subject to applicable rules of professional conduct. Client remains responsible for fees and costs incurred through the effective date of termination.");

  heading(ctx, "8.  No Guarantee of Outcome");
  para(ctx, "The Firm makes no representations or warranties regarding the outcome of the matter.");

  spacer(ctx, 12);
  para(ctx, "If the foregoing terms are acceptable, please sign below and return a copy to the Firm.");

  spacer(ctx, 20);
  signatureLine(ctx, "[ATTORNEY NAME], for [YOUR FIRM]");
  spacer(ctx, 8);
  signatureLine(ctx, "[CLIENT NAME]     Date: __________");

  return await ctx.doc.save();
}

async function buildLegalMemo(): Promise<Uint8Array> {
  const ctx = await makeCtx();
  title(ctx, "MEMORANDUM");

  const label = (k: string, v: string) => {
    ensureRoom(ctx, 18);
    ctx.page.drawText(k, { x: MARGIN, y: ctx.y - 11, size: 11, font: ctx.bold });
    ctx.page.drawText(v, { x: MARGIN + 60, y: ctx.y - 11, size: 11, font: ctx.body });
    ctx.y -= 16;
  };
  label("TO:", "[RECIPIENT NAME, TITLE]");
  label("FROM:", "[YOUR NAME]");
  label("DATE:", "[DATE]");
  label("RE:", "[SUBJECT — BRIEF DESCRIPTION OF MATTER]");

  spacer(ctx, 6);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: MARGIN + CONTENT_W, y: ctx.y },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.45),
  });
  spacer(ctx, 10);

  heading(ctx, "Question Presented");
  para(ctx, "[State the legal question, incorporating the key facts. Typically a single sentence beginning with \"Whether …\" or \"Under [jurisdiction] law, …\"]");

  heading(ctx, "Brief Answer");
  para(ctx, "[Provide a short answer (yes/no/probably) followed by a one-paragraph explanation of the reasoning.]");

  heading(ctx, "Statement of Facts");
  para(ctx, "[Set forth the material, legally significant facts in a neutral, chronological narrative. Include background facts necessary for context.]");

  heading(ctx, "Discussion");
  para(ctx, "Issue.  [Restate the legal issue.]", { font: ctx.italic });
  para(ctx, "Rule.  [State the governing rule of law, with authority. Break out sub-rules if helpful.]", { font: ctx.italic });
  para(ctx, "Application.  [Apply the rule to the facts. Address counter-arguments and analogous / distinguishable authority.]", { font: ctx.italic });
  para(ctx, "Conclusion.  [State the conclusion on this issue.]", { font: ctx.italic });

  heading(ctx, "Conclusion");
  para(ctx, "[Summarize the overall answer and any recommended next steps.]");

  return await ctx.doc.save();
}

async function buildTransmittal(): Promise<Uint8Array> {
  const ctx = await makeCtx();
  para(ctx, "[YOUR FIRM]", { font: ctx.bold, size: 12 });
  para(ctx, "[Firm Address] · [Phone] · [Email]", { gap: 18 });

  para(ctx, "[DATE]", { gap: 14 });

  para(ctx, "[RECIPIENT NAME]");
  para(ctx, "[Recipient Title / Company]");
  para(ctx, "[Recipient Address]", { gap: 14 });

  para(ctx, "Via [Hand Delivery / Email / U.S. Mail]", { font: ctx.italic, gap: 14 });

  para(ctx, "RE:  [MATTER — BRIEF DESCRIPTION]", { font: ctx.bold, gap: 14 });

  para(ctx, "Dear [RECIPIENT]:", { gap: 10 });

  para(ctx, "Enclosed please find the following in connection with the above-referenced matter:");

  spacer(ctx, 6);
  para(ctx, "1.  [Document 1 — description];", { indent: 18 });
  para(ctx, "2.  [Document 2 — description]; and", { indent: 18 });
  para(ctx, "3.  [Document 3 — description].", { indent: 18 });

  spacer(ctx, 6);
  para(ctx, "Please do not hesitate to contact the undersigned should you have any questions.");

  spacer(ctx, 16);
  para(ctx, "Very truly yours,", { gap: 42 });
  signatureLine(ctx, "[ATTORNEY NAME], Esq.");
  para(ctx, "[YOUR FIRM]", { gap: 14 });

  para(ctx, "Enclosures", { font: ctx.italic });
  para(ctx, "cc:  [names, if any]", { font: ctx.italic });

  return await ctx.doc.save();
}

async function buildFeeAgreement(): Promise<Uint8Array> {
  const ctx = await makeCtx();
  title(ctx, "LEGAL SERVICES FEE AGREEMENT");

  para(ctx, "This Fee Agreement (\"Agreement\") is entered into on [DATE] between [CLIENT NAME] (\"Client\") and [YOUR FIRM] (\"Firm\").");

  heading(ctx, "1.  Services");
  para(ctx, "Firm agrees to provide legal services to Client in connection with [MATTER DESCRIPTION]. Additional or unrelated matters will require a separate agreement.");

  heading(ctx, "2.  Fee Structure");
  para(ctx, "Select ONE of the following (delete inapplicable options):", { font: ctx.italic });
  para(ctx, "(a)  Hourly.  Client shall pay Firm at the hourly rates of $[RATE]/hour for [Attorney] and $[RATE]/hour for [Paralegal], billed in tenth-of-an-hour increments.", { indent: 18 });
  para(ctx, "(b)  Flat Fee.  Client shall pay Firm a flat fee of $[AMOUNT] for the services described in Section 1, payable [on execution / in installments].", { indent: 18 });
  para(ctx, "(c)  Contingency.  Firm shall receive [PERCENT]% of any gross recovery obtained through settlement or judgment. If there is no recovery, Client owes no fee (costs remain Client's responsibility).", { indent: 18 });

  heading(ctx, "3.  Retainer");
  para(ctx, "Client shall deposit $[RETAINER AMOUNT] into Firm's trust account, to be applied against fees and costs as incurred. Client agrees to replenish the retainer upon request.");

  heading(ctx, "4.  Costs");
  para(ctx, "Client is responsible for out-of-pocket costs, including filing fees, service of process, deposition and transcript fees, expert witness fees, travel, courier, and reproduction charges.");

  heading(ctx, "5.  Billing Terms");
  para(ctx, "Firm will issue invoices monthly. Invoices are due within [30] days of the invoice date. Balances unpaid after [30] days may accrue interest at [1]% per month.");

  heading(ctx, "6.  Termination");
  para(ctx, "Either party may terminate this Agreement upon written notice, subject to applicable rules of professional conduct. Client remains responsible for fees and costs incurred through the effective date of termination.");

  heading(ctx, "7.  Entire Agreement");
  para(ctx, "This Agreement contains the entire understanding between the parties and supersedes any prior oral or written representations.");

  spacer(ctx, 16);
  signatureLine(ctx, "[ATTORNEY NAME], for [YOUR FIRM]     Date: __________");
  spacer(ctx, 8);
  signatureLine(ctx, "[CLIENT NAME]     Date: __________");

  return await ctx.doc.save();
}

const BUILDERS: Record<LegalTemplateId, () => Promise<Uint8Array>> = {
  "demand-letter": buildDemandLetter,
  "engagement-letter": buildEngagementLetter,
  "legal-memo": buildLegalMemo,
  "transmittal-letter": buildTransmittal,
  "fee-agreement": buildFeeAgreement,
};

export async function buildLegalTemplateFile(id: LegalTemplateId): Promise<File> {
  const tpl = LEGAL_TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error(`Unknown template: ${id}`);
  const bytes = await BUILDERS[id]();
  return new File([bytes as BlobPart], tpl.fileName, { type: "application/pdf" });
}

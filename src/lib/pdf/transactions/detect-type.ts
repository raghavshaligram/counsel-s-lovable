// Sniff document type from first-page(s) text.

import type { DetectResult, DocType, Confidence } from "./types";

export function detectType(pageText: string): DetectResult {
  const t = (pageText || "").slice(0, 20_000);
  const evidence: string[] = [];

  // LEDES 1998B pipe format
  if (/INVOICE_DATE\|INVOICE_NUMBER/i.test(t) || /LAW_FIRM_MATTER_ID/i.test(t)) {
    evidence.push("LEDES 1998B header block");
    return pick("ledes", "high", evidence);
  }

  const bankHits: string[] = [];
  if (/\b(Statement|Account)\s+(period|summary|number|of\s+Account)\b/i.test(t)) bankHits.push("statement header");
  if (/\bStatement\s+of\s+Account\b/i.test(t)) bankHits.push("statement of account");
  if (/\b(Beginning|Opening)\s+balance\b/i.test(t)) bankHits.push("opening balance");
  if (/\b(Ending|Closing)\s+balance\b/i.test(t)) bankHits.push("closing balance");
  if (/\bWithdrawals?\b/i.test(t) && /\bDeposits?\b/i.test(t)) bankHits.push("withdrawals/deposits");
  if (/\b(Date)\b[\s\S]{0,200}\b(Description|Particulars|Narration)\b[\s\S]{0,200}\b(Balance)\b/i.test(t)) bankHits.push("date/particulars/balance header");
  if (/\bIFSC\b|\bMICR\b|\bSWIFT\s*Code\b/i.test(t)) bankHits.push("bank identifiers");
  if (/\bAccount\s*(Number|No\.?|#)\b/i.test(t)) bankHits.push("account number");
  if (/\bTran(saction)?\s*ID\b|\bUPI\b|\bIMPS\b|\bNEFT\b|\bRTGS\b/i.test(t)) bankHits.push("payment rails");

  const ledesHits: string[] = [];
  if (/\bTimekeeper\b/i.test(t)) ledesHits.push("Timekeeper");
  if (/\bTask\s+Code\b/i.test(t)) ledesHits.push("Task Code");
  if (/\bActivity\s+Code\b/i.test(t)) ledesHits.push("Activity Code");
  if (/\bHours\b.*\bRate\b.*\bAmount\b/is.test(t)) ledesHits.push("hours/rate/amount");
  if (/\bAtty\b|\bAttorney\b/i.test(t)) ledesHits.push("attorney");

  const invHits: string[] = [];
  if (/\bInvoice\s*#|\bInvoice\s+No\b|\bInvoice\s+Number\b/i.test(t)) invHits.push("invoice number");
  if (/\bBill\s+To\b|\bBilled\s+to\b/i.test(t)) invHits.push("bill to");
  if (/\bSubtotal\b/i.test(t)) invHits.push("subtotal");
  if (/\bTotal\s+due\b|\bAmount\s+due\b/i.test(t)) invHits.push("total due");
  if (/\bQty\b.*\bUnit\s+price\b/is.test(t)) invHits.push("qty/unit price");

  const bankScore = bankHits.length;
  const ledesScore = ledesHits.length + (bankScore === 0 ? 0 : -0.5);
  const invScore = invHits.length;

  if (ledesScore >= 3 && ledesScore > invScore) {
    return pick("ledes", ledesScore >= 4 ? "high" : "medium", ledesHits);
  }
  if (bankScore >= 2 && bankScore >= invScore) {
    return pick("bank_statement", bankScore >= 3 ? "high" : "medium", bankHits);
  }
  if (invScore >= 2) {
    return pick("invoice", invScore >= 3 ? "high" : "medium", invHits);
  }
  if (bankScore >= 1) return pick("bank_statement", "low", bankHits);
  if (invScore >= 1) return pick("invoice", "low", invHits);
  if (ledesScore >= 1) return pick("ledes", "low", ledesHits);

  return pick("generic", "low", ["no strong signals"]);
}

function pick(type: DocType, confidence: Confidence, evidence: string[]): DetectResult {
  return { type, confidence, evidence };
}

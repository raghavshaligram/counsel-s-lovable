/**
 * Read outline tree + per-page link annotations from a PDF.
 *
 * Uses pdf-lib's low-level dictionary API: `/Outlines`, `/First`, `/Next`,
 * `/Title`, `/Dest`, `/A` for outline items; per-page `/Annots` filtered to
 * `Subtype = /Link` for link annotations.
 *
 * Robustness: every field is optional in the spec, so missing pieces fall
 * back to sensible defaults rather than throwing. Destinations that point
 * at unknown pages are clamped to page 0.
 */
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFNumber,
  type PDFObject,
} from "pdf-lib";
import type { Dest, LinkAnnot, OutlineNode, ParsedDoc } from "./types";
import { newId } from "./types";

function decodeString(obj: PDFObject | undefined): string {
  if (!obj) return "";
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return "";
}

function numberOrNull(obj: PDFObject | undefined): number | null {
  if (obj instanceof PDFNumber) return obj.asNumber();
  return null;
}

function buildPageIndex(doc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const ref = pages[i].ref;
    map.set(refKey(ref), i);
  }
  return map;
}

function refKey(ref: PDFRef): string {
  return `${ref.objectNumber} ${ref.generationNumber}`;
}

function decodeDest(
  destObj: PDFObject | undefined,
  doc: PDFDocument,
  pageIndex: Map<string, number>,
): Dest | null {
  if (!destObj) return null;
  let arr: PDFArray | null = null;
  if (destObj instanceof PDFArray) arr = destObj;
  else if (destObj instanceof PDFString || destObj instanceof PDFHexString) {
    // Named destination — best-effort lookup via /Names /Dests would be needed;
    // we skip and return null so the UI falls back to page 0 manually.
    return null;
  }
  if (!arr) return null;

  const first = arr.get(0);
  let page = 0;
  if (first instanceof PDFRef) {
    page = pageIndex.get(refKey(first)) ?? 0;
  } else if (first instanceof PDFNumber) {
    page = first.asNumber();
  }
  // [page /XYZ x y zoom]
  const fit = arr.get(1);
  let x: number | null = null;
  let y: number | null = null;
  let zoom: number | null = null;
  if (fit instanceof PDFName && fit.asString() === "/XYZ") {
    x = numberOrNull(arr.get(2));
    y = numberOrNull(arr.get(3));
    zoom = numberOrNull(arr.get(4));
  }
  void doc;
  return { page, x, y, zoom };
}

function readOutlineItem(
  ref: PDFRef,
  doc: PDFDocument,
  pageIndex: Map<string, number>,
  seen: Set<string>,
): OutlineNode | null {
  const k = refKey(ref);
  if (seen.has(k)) return null;
  seen.add(k);
  const dict = doc.context.lookup(ref);
  if (!(dict instanceof PDFDict)) return null;

  const title = decodeString(dict.get(PDFName.of("Title")));
  let dest: Dest | null = null;
  const destObj = dict.get(PDFName.of("Dest"));
  if (destObj) {
    dest = decodeDest(destObj, doc, pageIndex);
  } else {
    const a = dict.get(PDFName.of("A"));
    if (a instanceof PDFDict) {
      const s = a.get(PDFName.of("S"));
      if (s instanceof PDFName && s.asString() === "/GoTo") {
        dest = decodeDest(a.get(PDFName.of("D")), doc, pageIndex);
      }
    }
  }

  const flags = dict.get(PDFName.of("F"));
  const flagsN = flags instanceof PDFNumber ? flags.asNumber() : 0;
  const style = {
    italic: (flagsN & 1) !== 0,
    bold: (flagsN & 2) !== 0,
  };

  let color: [number, number, number] | null = null;
  const c = dict.get(PDFName.of("C"));
  if (c instanceof PDFArray && c.size() >= 3) {
    const r = numberOrNull(c.get(0));
    const g = numberOrNull(c.get(1));
    const b = numberOrNull(c.get(2));
    if (r !== null && g !== null && b !== null) color = [r, g, b];
  }

  const count = dict.get(PDFName.of("Count"));
  const countN = count instanceof PDFNumber ? count.asNumber() : 0;
  const expanded = countN >= 0;

  const children: OutlineNode[] = [];
  const firstChild = dict.get(PDFName.of("First"));
  if (firstChild instanceof PDFRef) {
    let cur: PDFRef | null = firstChild;
    let safety = 0;
    while (cur && safety++ < 5000) {
      const node = readOutlineItem(cur, doc, pageIndex, seen);
      if (node) children.push(node);
      const childDict: PDFObject | undefined = doc.context.lookup(cur);
      cur = null;
      if (childDict instanceof PDFDict) {
        const next: PDFObject | undefined = childDict.get(PDFName.of("Next"));
        if (next instanceof PDFRef) cur = next;
      }
    }
  }

  return {
    id: newId("o"),
    title,
    dest,
    style,
    color,
    expanded,
    children,
  };
}

function readOutline(doc: PDFDocument, pageIndex: Map<string, number>): OutlineNode[] {
  const root = doc.catalog.get(PDFName.of("Outlines"));
  if (!(root instanceof PDFRef)) return [];
  const dict = doc.context.lookup(root);
  if (!(dict instanceof PDFDict)) return [];
  const out: OutlineNode[] = [];
  const first = dict.get(PDFName.of("First"));
  if (!(first instanceof PDFRef)) return [];
  let cur: PDFRef | null = first;
  const seen = new Set<string>();
  let safety = 0;
  while (cur && safety++ < 5000) {
    const node = readOutlineItem(cur, doc, pageIndex, seen);
    if (node) out.push(node);
    const d: PDFObject | undefined = doc.context.lookup(cur);
    cur = null;
    if (d instanceof PDFDict) {
      const next: PDFObject | undefined = d.get(PDFName.of("Next"));
      if (next instanceof PDFRef) cur = next;
    }
  }
  return out;
}

function readLinks(doc: PDFDocument, pageIndex: Map<string, number>): LinkAnnot[] {
  const out: LinkAnnot[] = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const annots = page.node.get(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let j = 0; j < annots.size(); j++) {
      const raw: PDFObject | undefined = annots.get(j);
      const entry: PDFObject | undefined = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
      if (!(entry instanceof PDFDict)) continue;
      const subtype = entry.get(PDFName.of("Subtype"));
      if (!(subtype instanceof PDFName) || subtype.asString() !== "/Link") continue;
      const rectObj = entry.get(PDFName.of("Rect"));
      if (!(rectObj instanceof PDFArray) || rectObj.size() < 4) continue;
      const rect: [number, number, number, number] = [
        numberOrNull(rectObj.get(0)) ?? 0,
        numberOrNull(rectObj.get(1)) ?? 0,
        numberOrNull(rectObj.get(2)) ?? 0,
        numberOrNull(rectObj.get(3)) ?? 0,
      ];

      // Decide target — URL action or GoTo
      let target: LinkAnnot["target"] | null = null;
      const a = entry.get(PDFName.of("A"));
      if (a instanceof PDFDict) {
        const s = a.get(PDFName.of("S"));
        if (s instanceof PDFName) {
          const sName = s.asString();
          if (sName === "/URI") {
            const uri = a.get(PDFName.of("URI"));
            target = { kind: "url", url: decodeString(uri) };
          } else if (sName === "/GoTo") {
            const dest = decodeDest(a.get(PDFName.of("D")), doc, pageIndex);
            if (dest) target = { kind: "goto", dest };
          }
        }
      } else {
        const d = entry.get(PDFName.of("Dest"));
        if (d) {
          const dest = decodeDest(d, doc, pageIndex);
          if (dest) target = { kind: "goto", dest };
        }
      }
      if (!target) continue;

      out.push({ id: newId("l"), page: i, rect, target });
    }
  }
  return out;
}

export async function parsePdf(bytes: Uint8Array): Promise<{ doc: PDFDocument; parsed: ParsedDoc }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageIndex = buildPageIndex(doc);
  const outline = readOutline(doc, pageIndex);
  const links = readLinks(doc, pageIndex);
  return {
    doc,
    parsed: {
      outline,
      links,
      pageCount: doc.getPageCount(),
    },
  };
}

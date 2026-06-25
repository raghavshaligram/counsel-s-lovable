/**
 * Write outline tree + link annotations back into a PDF byte stream.
 *
 * Strategy: load the source bytes fresh, strip any existing `/Outlines`
 * and existing `/Link` annotations, then rebuild from the in-memory tree.
 * Other annotations (highlights, text notes, form widgets) are preserved.
 *
 * Outline items follow the spec: each item is its own indirect object with
 * /Title, /Parent, /Prev, /Next, /First, /Last, /Count, /Dest. /Count is
 * negative when collapsed and equals the number of immediate descendants.
 */
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRef,
  PDFString,
  PDFNumber,
  PDFNull,
  type PDFContext,
} from "pdf-lib";
import type { Dest, LinkAnnot, OutlineNode } from "./types";

function destArray(ctx: PDFContext, doc: PDFDocument, dest: Dest): PDFArray {
  const pages = doc.getPages();
  const pageIdx = Math.max(0, Math.min(dest.page, pages.length - 1));
  const pageRef = pages[pageIdx].ref;
  const arr = ctx.obj([
    pageRef,
    PDFName.of("XYZ"),
    dest.x === null ? PDFNull : PDFNumber.of(dest.x),
    dest.y === null ? PDFNull : PDFNumber.of(dest.y),
    dest.zoom === null ? PDFNull : PDFNumber.of(dest.zoom),
  ]) as PDFArray;
  return arr;
}

interface AllocatedItem {
  node: OutlineNode;
  ref: PDFRef;
  dict: PDFDict;
  childRefs: AllocatedItem[];
}

function buildOutlineItems(
  doc: PDFDocument,
  ctx: PDFContext,
  nodes: OutlineNode[],
  parentRef: PDFRef,
): { items: AllocatedItem[]; descendants: number } {
  const items: AllocatedItem[] = [];
  let descendants = 0;
  for (const node of nodes) {
    const dict = ctx.obj({}) as PDFDict;
    dict.set(PDFName.of("Title"), PDFString.of(node.title || "Untitled"));
    dict.set(PDFName.of("Parent"), parentRef);
    if (node.dest) {
      dict.set(PDFName.of("Dest"), destArray(ctx, doc, node.dest));
    }
    const flags = (node.style.italic ? 1 : 0) | (node.style.bold ? 2 : 0);
    if (flags) dict.set(PDFName.of("F"), PDFNumber.of(flags));
    if (node.color) {
      dict.set(
        PDFName.of("C"),
        ctx.obj(node.color.map((c) => PDFNumber.of(c))),
      );
    }
    const ref = ctx.register(dict);
    const child = buildOutlineItems(doc, ctx, node.children, ref);
    if (child.items.length > 0) {
      dict.set(PDFName.of("First"), child.items[0].ref);
      dict.set(PDFName.of("Last"), child.items[child.items.length - 1].ref);
      const count = child.items.length + child.descendants;
      dict.set(PDFName.of("Count"), PDFNumber.of(node.expanded ? count : -count));
    }
    items.push({ node, ref, dict, childRefs: child.items });
    descendants += 1 + child.descendants;
  }
  // wire prev/next
  for (let i = 0; i < items.length; i++) {
    if (i > 0) items[i].dict.set(PDFName.of("Prev"), items[i - 1].ref);
    if (i < items.length - 1) items[i].dict.set(PDFName.of("Next"), items[i + 1].ref);
  }
  return { items, descendants };
}

export function writeOutline(doc: PDFDocument, nodes: OutlineNode[]): void {
  const ctx = doc.context;
  // Remove existing outlines outright (we rebuild fresh).
  doc.catalog.delete(PDFName.of("Outlines"));
  if (nodes.length === 0) return;

  const rootDict = ctx.obj({ Type: "Outlines" }) as PDFDict;
  const rootRef = ctx.register(rootDict);
  const { items, descendants } = buildOutlineItems(doc, ctx, nodes, rootRef);
  if (items.length > 0) {
    rootDict.set(PDFName.of("First"), items[0].ref);
    rootDict.set(PDFName.of("Last"), items[items.length - 1].ref);
    rootDict.set(PDFName.of("Count"), PDFNumber.of(items.length + descendants));
  }
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
  // Hint viewers to open the outline pane.
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
}

function buildLinkAnnot(ctx: PDFContext, doc: PDFDocument, link: LinkAnnot): PDFRef {
  const annot = ctx.obj({}) as PDFDict;
  annot.set(PDFName.of("Type"), PDFName.of("Annot"));
  annot.set(PDFName.of("Subtype"), PDFName.of("Link"));
  annot.set(
    PDFName.of("Rect"),
    ctx.obj(link.rect.map((n) => PDFNumber.of(n))),
  );
  // No visible border by default.
  annot.set(PDFName.of("Border"), ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]));
  annot.set(PDFName.of("H"), PDFName.of("I"));

  if (link.target.kind === "url") {
    const action = ctx.obj({}) as PDFDict;
    action.set(PDFName.of("Type"), PDFName.of("Action"));
    action.set(PDFName.of("S"), PDFName.of("URI"));
    action.set(PDFName.of("URI"), PDFString.of(link.target.url));
    annot.set(PDFName.of("A"), action);
  } else {
    annot.set(PDFName.of("Dest"), destArray(ctx, doc, link.target.dest));
  }
  return ctx.register(annot);
}

function writeLinks(doc: PDFDocument, links: LinkAnnot[]): void {
  const ctx = doc.context;
  const pages = doc.getPages();
  // Strip existing /Link annotations per page; keep others.
  for (const page of pages) {
    const annots = page.node.get(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const keep: any[] = [];
    for (let i = 0; i < annots.size(); i++) {
      let entry = annots.get(i);
      const lookup = entry instanceof PDFRef ? ctx.lookup(entry) : entry;
      if (lookup instanceof PDFDict) {
        const subtype = lookup.get(PDFName.of("Subtype"));
        if (subtype instanceof PDFName && subtype.asString() === "/Link") continue;
      }
      keep.push(entry);
    }
    if (keep.length === 0) {
      page.node.delete(PDFName.of("Annots"));
    } else {
      page.node.set(PDFName.of("Annots"), ctx.obj(keep));
    }
  }

  // Group new links by page and append.
  const byPage = new Map<number, LinkAnnot[]>();
  for (const l of links) {
    const arr = byPage.get(l.page) ?? [];
    arr.push(l);
    byPage.set(l.page, arr);
  }
  for (const [pageIdx, pageLinks] of byPage.entries()) {
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const existing = page.node.get(PDFName.of("Annots"));
    const existingArr = existing instanceof PDFArray ? existing : null;
    const refs = pageLinks.map((l) => buildLinkAnnot(ctx, doc, l));
    if (existingArr) {
      for (const r of refs) existingArr.push(r);
    } else {
      page.node.set(PDFName.of("Annots"), ctx.obj(refs));
    }
  }
}

export async function exportPdf(
  sourceBytes: Uint8Array,
  outline: OutlineNode[],
  links: LinkAnnot[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  writeOutline(doc, outline);
  writeLinks(doc, links);
  return doc.save();
}

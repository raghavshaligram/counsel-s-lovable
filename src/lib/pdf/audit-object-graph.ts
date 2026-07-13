/**
 * PDF object-graph audit — debugging instrument.
 *
 * Given a PDF byte stream, walk every indirect object and record each stream's
 * SHA-256 hash, byte size, inbound reference count, and classification (image,
 * font, page content, annotation appearance, form XObject, other). The hash
 * is the stable identity across export stages — indirect refs change on every
 * pdf-lib rebuild, but identical stream bytes yield identical hashes.
 *
 * Pair with `diffStages()` to answer: "which pipeline stage duplicated this
 * resource from N copies to M copies?" The `duplicated` list, sorted by
 * `wastedBytesDelta` desc, is the primary output.
 */
import { PDFDocument, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream, PDFName, PDFNumber, PDFHexString, PDFString, type PDFObject } from "pdf-lib";

export type AuditStage = "source" | "export" | "rasterize" | "pdfa" | "final" | string;
export type ResKind = "Image" | "Form" | "FontFile" | "ContentStream" | "AnnotAP" | "Other";

export interface StreamRecord {
  sha256: string;
  kind: ResKind;
  bytes: number;
  copies: number;
  refs: string[];
  refCounts: number[];
  pages: number[];
  hint?: string;
}

export interface StageAudit {
  stage: AuditStage;
  fileBytes: number;
  totalIndirectObjects: number;
  streams: Record<string, StreamRecord>; // key = sha256 (plain object for JSON safety)
  bytesByKind: Record<ResKind, number>;
  copiesByKind: Record<ResKind, number>;
  uniqueByKind: Record<ResKind, number>;
  totalStreamBytes: number;
}

export interface HashDelta {
  sha256: string;
  kind: ResKind;
  bytesEach: number;
  copiesBefore: number;
  copiesAfter: number;
  copiesDelta: number;
  wastedBytesDelta: number;
  hint?: string;
  sampleRefsAfter: string[];
}

export interface StageDiff {
  from: AuditStage;
  to: AuditStage;
  fileBytesDelta: number;
  bytesByKindDelta: Record<ResKind, number>;
  introduced: HashDelta[];
  duplicated: HashDelta[];
  removed: HashDelta[];
  unchanged: number;
}

const EMPTY_BY_KIND = (): Record<ResKind, number> => ({
  Image: 0, Form: 0, FontFile: 0, ContentStream: 0, AnnotAP: 0, Other: 0,
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // subtle.digest requires an ArrayBuffer view; slice into a fresh buffer to
  // avoid SharedArrayBuffer / offset surprises when the input is a subarray.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(hash);
  let out = "";
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

function refKey(ref: PDFRef): string {
  return `${ref.objectNumber} ${ref.generationNumber} R`;
}

/** Recursively walk an object counting outbound refs. */
function walkRefs(obj: PDFObject | undefined, out: Map<string, number>, seen: Set<PDFObject>) {
  if (!obj || seen.has(obj)) return;
  seen.add(obj);
  if (obj instanceof PDFRef) {
    out.set(refKey(obj), (out.get(refKey(obj)) ?? 0) + 1);
    return;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) walkRefs(obj.get(i), out, seen);
    return;
  }
  if (obj instanceof PDFDict) {
    for (const [, v] of obj.entries()) walkRefs(v, out, seen);
    return;
  }
  if (obj instanceof PDFStream) {
    // Recurse into dict portion only; contents are bytes.
    walkRefs((obj as unknown as { dict: PDFDict }).dict, out, seen);
  }
}

function nameOf(dict: PDFDict, key: string): string | undefined {
  const v = dict.get(PDFName.of(key));
  if (v instanceof PDFName) return v.asString().replace(/^\//, "");
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return undefined;
}
function numOf(dict: PDFDict, key: string): number | undefined {
  const v = dict.get(PDFName.of(key));
  return v instanceof PDFNumber ? v.asNumber() : undefined;
}

function classifyStream(dict: PDFDict, apRefs: Set<string>, contentRefs: Set<string>, selfKey: string): { kind: ResKind; hint?: string } {
  const type = nameOf(dict, "Type");
  const subtype = nameOf(dict, "Subtype");
  const filter = (() => {
    const f = dict.get(PDFName.of("Filter"));
    if (f instanceof PDFName) return f.asString().replace(/^\//, "");
    if (f instanceof PDFArray) {
      const parts: string[] = [];
      for (let i = 0; i < f.size(); i++) {
        const it = f.get(i);
        if (it instanceof PDFName) parts.push(it.asString().replace(/^\//, ""));
      }
      return parts.join("+");
    }
    return undefined;
  })();

  if (type === "XObject" && subtype === "Image") {
    const w = numOf(dict, "Width");
    const h = numOf(dict, "Height");
    const bpc = numOf(dict, "BitsPerComponent");
    return { kind: "Image", hint: `${filter ?? "?"} ${w ?? "?"}x${h ?? "?"}${bpc ? ` @${bpc}bpc` : ""}` };
  }
  if (apRefs.has(selfKey)) {
    return { kind: "AnnotAP", hint: `${filter ?? "raw"} annot-appearance` };
  }
  if (type === "XObject" && subtype === "Form") {
    return { kind: "Form", hint: `${filter ?? "raw"} form-xobject` };
  }
  // FontFile / FontFile2 / FontFile3 have Length1/Length2/Length3 markers,
  // and are reached via FontDescriptor.
  const l1 = numOf(dict, "Length1");
  const l2 = numOf(dict, "Length2");
  const l3 = numOf(dict, "Length3");
  const ftSubtype = subtype; // CIDFontType0C etc. appears on FontFile3
  if (l1 !== undefined || l2 !== undefined || l3 !== undefined || ftSubtype === "CIDFontType0C" || ftSubtype === "OpenType" || ftSubtype === "Type1C") {
    return { kind: "FontFile", hint: `${filter ?? "raw"} font ${ftSubtype ?? `L1=${l1 ?? 0}`}` };
  }
  if (contentRefs.has(selfKey)) {
    return { kind: "ContentStream", hint: `${filter ?? "raw"} page-content` };
  }
  return { kind: "Other", hint: filter };
}

/** Gather refs of page-content streams and annotation-appearance streams. */
function collectSpecialRefs(pdf: PDFDocument): {
  apRefs: Set<string>;
  contentRefs: Set<string>;
  pageOfRef: Map<string, number>;
} {
  const apRefs = new Set<string>();
  const contentRefs = new Set<string>();
  const pageOfRef = new Map<string, number>();

  const pages = pdf.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageDict = pages[i].node;
    // /Contents can be a ref or array of refs
    const contentsRaw = pageDict.get(PDFName.of("Contents"));
    const pushContent = (r: PDFRef) => {
      const k = refKey(r);
      contentRefs.add(k);
      if (!pageOfRef.has(k)) pageOfRef.set(k, i);
    };
    if (contentsRaw instanceof PDFRef) pushContent(contentsRaw);
    else if (contentsRaw instanceof PDFArray) {
      for (let j = 0; j < contentsRaw.size(); j++) {
        const it = contentsRaw.get(j);
        if (it instanceof PDFRef) pushContent(it);
      }
    }

    // /Annots -> each annot dict -> /AP -> /N /R /D -> stream ref
    const annots = pageDict.get(PDFName.of("Annots"));
    const annotArr = annots instanceof PDFRef ? pdf.context.lookup(annots) : annots;
    if (annotArr instanceof PDFArray) {
      for (let j = 0; j < annotArr.size(); j++) {
        const av = annotArr.get(j);
        const annotDict = av instanceof PDFRef ? pdf.context.lookup(av) : av;
        if (!(annotDict instanceof PDFDict)) continue;
        const ap = annotDict.get(PDFName.of("AP"));
        const apDict = ap instanceof PDFRef ? pdf.context.lookup(ap) : ap;
        if (!(apDict instanceof PDFDict)) continue;
        for (const key of ["N", "R", "D"]) {
          const entry = apDict.get(PDFName.of(key));
          if (entry instanceof PDFRef) {
            const k = refKey(entry);
            apRefs.add(k);
            if (!pageOfRef.has(k)) pageOfRef.set(k, i);
          } else if (entry instanceof PDFDict) {
            // appearance-state dict → each value is a ref
            for (const [, v] of entry.entries()) {
              if (v instanceof PDFRef) {
                const k = refKey(v);
                apRefs.add(k);
                if (!pageOfRef.has(k)) pageOfRef.set(k, i);
              }
            }
          }
        }
      }
    }
  }
  return { apRefs, contentRefs, pageOfRef };
}

export async function auditStage(bytes: Uint8Array, stage: AuditStage): Promise<StageAudit> {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const ctx = pdf.context;
  const all = ctx.enumerateIndirectObjects();

  // Inbound ref count: walk every object once.
  const inbound = new Map<string, number>();
  const seen = new Set<PDFObject>();
  for (const [, obj] of all) walkRefs(obj, inbound, seen);
  // Trailer refs too (Root, Info, etc.)
  walkRefs(ctx.trailerInfo.Root as unknown as PDFObject, inbound, seen);
  walkRefs(ctx.trailerInfo.Info as unknown as PDFObject, inbound, seen);

  const { apRefs, contentRefs, pageOfRef } = collectSpecialRefs(pdf);

  const bytesByKind = EMPTY_BY_KIND();
  const copiesByKind = EMPTY_BY_KIND();
  const uniqueByKind = EMPTY_BY_KIND();
  const streams: Record<string, StreamRecord> = {};
  let totalStreamBytes = 0;

  // Hash every stream. Group by hash.
  const hashByRef = new Map<string, string>();
  for (const [ref, obj] of all) {
    if (!(obj instanceof PDFStream)) continue;
    const contents = obj instanceof PDFRawStream ? obj.contents : obj.getContents();
    const hash = await sha256Hex(contents);
    hashByRef.set(refKey(ref), hash);
  }

  for (const [ref, obj] of all) {
    if (!(obj instanceof PDFStream)) continue;
    const key = refKey(ref);
    const hash = hashByRef.get(key)!;
    const dict = (obj as unknown as { dict: PDFDict }).dict;
    const { kind, hint } = classifyStream(dict, apRefs, contentRefs, key);
    const contents = obj instanceof PDFRawStream ? obj.contents : obj.getContents();
    const size = contents.byteLength;

    let rec = streams[hash];
    if (!rec) {
      rec = { sha256: hash, kind, bytes: size, copies: 0, refs: [], refCounts: [], pages: [], hint };
      streams[hash] = rec;
      uniqueByKind[kind]++;
    }
    rec.copies++;
    rec.refs.push(key);
    rec.refCounts.push(inbound.get(key) ?? 0);
    const pg = pageOfRef.get(key);
    if (pg !== undefined && !rec.pages.includes(pg)) rec.pages.push(pg);

    bytesByKind[kind] += size;
    copiesByKind[kind]++;
    totalStreamBytes += size;
  }

  return {
    stage,
    fileBytes: bytes.byteLength,
    totalIndirectObjects: all.length,
    streams,
    bytesByKind,
    copiesByKind,
    uniqueByKind,
    totalStreamBytes,
  };
}

export function diffStages(a: StageAudit, b: StageAudit): StageDiff {
  const introduced: HashDelta[] = [];
  const duplicated: HashDelta[] = [];
  const removed: HashDelta[] = [];
  let unchanged = 0;

  const aHashes = new Set(Object.keys(a.streams));
  const bHashes = new Set(Object.keys(b.streams));

  for (const h of bHashes) {
    const after = b.streams[h];
    const before = a.streams[h];
    const copiesBefore = before?.copies ?? 0;
    const copiesAfter = after.copies;
    const delta: HashDelta = {
      sha256: h,
      kind: after.kind,
      bytesEach: after.bytes,
      copiesBefore,
      copiesAfter,
      copiesDelta: copiesAfter - copiesBefore,
      wastedBytesDelta: after.bytes * Math.max(0, copiesAfter - copiesBefore),
      hint: after.hint,
      sampleRefsAfter: after.refs.slice(0, 5),
    };
    if (copiesBefore === 0) introduced.push(delta);
    else if (copiesAfter > copiesBefore) duplicated.push(delta);
    else unchanged++;
  }
  for (const h of aHashes) {
    if (bHashes.has(h)) continue;
    const before = a.streams[h];
    removed.push({
      sha256: h,
      kind: before.kind,
      bytesEach: before.bytes,
      copiesBefore: before.copies,
      copiesAfter: 0,
      copiesDelta: -before.copies,
      wastedBytesDelta: 0,
      hint: before.hint,
      sampleRefsAfter: [],
    });
  }

  introduced.sort((x, y) => y.bytesEach * y.copiesAfter - x.bytesEach * x.copiesAfter);
  duplicated.sort((x, y) => y.wastedBytesDelta - x.wastedBytesDelta);
  removed.sort((x, y) => y.bytesEach * y.copiesBefore - x.bytesEach * x.copiesBefore);

  const bytesByKindDelta = EMPTY_BY_KIND();
  (Object.keys(bytesByKindDelta) as ResKind[]).forEach((k) => {
    bytesByKindDelta[k] = b.bytesByKind[k] - a.bytesByKind[k];
  });

  return {
    from: a.stage,
    to: b.stage,
    fileBytesDelta: b.fileBytes - a.fileBytes,
    bytesByKindDelta,
    introduced,
    duplicated,
    removed,
    unchanged,
  };
}

/**
 * Shared editor state — reducer, action types, default state, helpers.
 *
 * Used by the standalone /editor route and by the workspace's native canvas
 * mount. Both share the same EditorDoc model so annotations placed in the
 * workspace export through the same exportEditedPdf pipeline.
 */
import type {
  Anno,
  DocSettings,
  EditorDoc,
  OcrPageLayer,
  PageOp,
  ProtectSettings,
  RGB,
  Tool,
  WatermarkSettings,
} from "./types";


export type State = {
  doc: EditorDoc | null;
  current: number;
  tool: Tool;
  selectedAnnoId: string | null;
  color: RGB;
  fillShape: boolean;
  stroke: number;
  fontSize: number;
  opacity: number;
  pendingImage:
    | { dataUrl: string; mime: "image/png" | "image/jpeg"; w: number; h: number }
    | null;
  watermark: WatermarkSettings | null;
  protect: ProtectSettings | null;
  past: EditorDoc[];
  future: EditorDoc[];
};

export type Action =
  | { type: "LOAD"; doc: EditorDoc }
  | { type: "SET_PAGE"; n: number }
  | { type: "SET_TOOL"; t: Tool }
  | { type: "SET_COLOR"; c: RGB }
  | { type: "SET_OPACITY"; v: number }
  | { type: "SET_STROKE"; v: number }
  | { type: "SET_FONT"; v: number }
  | { type: "SET_FILL"; v: boolean }
  | { type: "SELECT_ANNO"; id: string | null }
  | { type: "ADD_ANNO"; a: Anno }
  | { type: "UPDATE_ANNO"; id: string; patch: Partial<Anno> }
  | { type: "DELETE_ANNO"; id: string }
  | { type: "REORDER_PAGE"; from: number; to: number }
  | { type: "DELETE_PAGE"; n: number }
  | { type: "INSERT_BLANK"; after: number; width: number; height: number }
  | { type: "ROTATE_PAGE"; n: number }
  | { type: "SET_PAGE_CROP"; n: number; rect: { x: number; y: number; w: number; h: number } | null }
  | { type: "SET_PENDING_IMAGE"; img: State["pendingImage"] }
  | { type: "SET_WATERMARK"; w: WatermarkSettings | null }
  | { type: "SET_PROTECT"; p: ProtectSettings | null }
  | { type: "SET_OCR_LAYER"; pages: OcrPageLayer[] }
  | { type: "SET_OUTLINE"; outline: import("../outline/types").OutlineNode[] }
  | { type: "SET_DOC_SETTINGS"; settings: DocSettings }
  | {
      type: "LOAD_SIDECAR";
      annotations?: Anno[];
      pages?: PageOp[];
      ocrLayer?: OcrPageLayer[];
      outline?: import("../outline/types").OutlineNode[];
      docSettings?: DocSettings;
    }
  | { type: "UNDO" }
  | { type: "REDO" };


function commit(state: State, nextDoc: EditorDoc): State {
  return {
    ...state,
    doc: nextDoc,
    past: state.doc ? [...state.past.slice(-49), state.doc] : state.past,
    future: [],
  };
}

export const initialState: State = {
  doc: null,
  current: 0,
  tool: "select",
  selectedAnnoId: null,
  color: { r: 1, g: 0.85, b: 0 },
  fillShape: false,
  stroke: 2,
  fontSize: 14,
  opacity: 1,
  pendingImage: null,
  watermark: null,
  protect: null,
  past: [],
  future: [],
};

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "LOAD":
      return { ...initialState, doc: a.doc, color: s.color };
    case "SET_PAGE":
      return { ...s, current: a.n, selectedAnnoId: null };
    case "SET_TOOL":
      return { ...s, tool: a.t, selectedAnnoId: a.t === "select" ? s.selectedAnnoId : null };
    case "SET_COLOR": return { ...s, color: a.c };
    case "SET_OPACITY": return { ...s, opacity: a.v };
    case "SET_STROKE": return { ...s, stroke: a.v };
    case "SET_FONT": return { ...s, fontSize: a.v };
    case "SET_FILL": return { ...s, fillShape: a.v };
    case "SELECT_ANNO": return { ...s, selectedAnnoId: a.id };
    case "SET_PENDING_IMAGE": return { ...s, pendingImage: a.img };
    case "SET_WATERMARK": return { ...s, watermark: a.w };
    case "SET_PROTECT": return { ...s, protect: a.p };
    case "SET_OCR_LAYER": {
      if (!s.doc) return s;
      // Merge by srcPage — new entries replace any existing layer for that
      // source page; pages we didn't touch in this run are preserved.
      const map = new Map<number, OcrPageLayer>();
      for (const p of s.doc.ocrLayer ?? []) map.set(p.srcPage, p);
      for (const p of a.pages) map.set(p.srcPage, p);
      const next: EditorDoc = {
        ...s.doc,
        ocrLayer: [...map.values()].sort((x, y) => x.srcPage - y.srcPage),
      };
      return commit(s, next);
    }
    case "LOAD_SIDECAR": {
      if (!s.doc) return s;
      const next: EditorDoc = {
        ...s.doc,
        annotations: a.annotations ?? s.doc.annotations,
        pages: a.pages && a.pages.length === s.doc.pages.length ? a.pages : s.doc.pages,
        ocrLayer: a.ocrLayer ?? s.doc.ocrLayer,
        outline: a.outline ?? s.doc.outline,
        docSettings: a.docSettings ?? s.doc.docSettings,
      };
      return { ...s, doc: next, past: [], future: [] };
    }
    case "SET_OUTLINE": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, outline: a.outline });
    }
    case "SET_DOC_SETTINGS": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, docSettings: a.settings });
    }
    case "ADD_ANNO": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, annotations: [...s.doc.annotations, a.a] });
    }

    case "UPDATE_ANNO": {
      if (!s.doc) return s;
      return {
        ...s,
        doc: {
          ...s.doc,
          annotations: s.doc.annotations.map((x) =>
            x.id === a.id ? ({ ...x, ...a.patch } as Anno) : x,
          ),
        },
      };
    }
    case "DELETE_ANNO": {
      if (!s.doc) return s;
      return commit(s, { ...s.doc, annotations: s.doc.annotations.filter((x) => x.id !== a.id) });
    }
    case "REORDER_PAGE": {
      if (!s.doc) return s;
      const pages = [...s.doc.pages];
      const [moved] = pages.splice(a.from, 1);
      pages.splice(a.to, 0, moved);
      const remap = (i: number) =>
        i === a.from ? a.to : i < a.from && i >= a.to ? i + 1 : i > a.from && i <= a.to ? i - 1 : i;
      const annotations = s.doc.annotations.map((x) => ({ ...x, page: remap(x.page) }));
      return commit({ ...s, current: remap(s.current) }, { ...s.doc, pages, annotations });
    }
    case "DELETE_PAGE": {
      if (!s.doc || s.doc.pages.length <= 1) return s;
      const pages = s.doc.pages.filter((_, i) => i !== a.n);
      const annotations = s.doc.annotations
        .filter((x) => x.page !== a.n)
        .map((x) => ({ ...x, page: x.page > a.n ? x.page - 1 : x.page }));
      const current = Math.min(s.current, pages.length - 1);
      return commit({ ...s, current }, { ...s.doc, pages, annotations });
    }
    case "INSERT_BLANK": {
      if (!s.doc) return s;
      const pages = [...s.doc.pages];
      const newPage: PageOp = { srcPage: -1, rotation: 0, blank: true, width: a.width, height: a.height };
      pages.splice(a.after + 1, 0, newPage);
      const annotations = s.doc.annotations.map((x) => ({ ...x, page: x.page > a.after ? x.page + 1 : x.page }));
      return commit({ ...s, current: a.after + 1 }, { ...s.doc, pages, annotations });
    }
    case "ROTATE_PAGE": {
      if (!s.doc) return s;
      const pages = s.doc.pages.map((p, i) =>
        i === a.n ? { ...p, rotation: (((p.rotation + 90) % 360) as PageOp["rotation"]) } : p,
      );
      return commit(s, { ...s.doc, pages });
    }
    case "SET_PAGE_CROP": {
      if (!s.doc) return s;
      const pages = s.doc.pages.map((p, i) =>
        i === a.n ? { ...p, cropBox: a.rect ?? undefined } : p,
      );
      return commit(s, { ...s.doc, pages });
    }
    case "UNDO": {
      if (!s.past.length || !s.doc) return s;
      const prev = s.past[s.past.length - 1];
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future] };
    }
    case "REDO": {
      if (!s.future.length || !s.doc) return s;
      const next = s.future[0];
      return { ...s, doc: next, past: s.doc ? [...s.past, s.doc] : s.past, future: s.future.slice(1) };
    }
  }
}

/* -------------------------- helpers -------------------------- */

export const PALETTE: RGB[] = [
  { r: 1, g: 0.85, b: 0 },
  { r: 1, g: 0.2, b: 0.2 },
  { r: 0.1, g: 0.5, b: 1 },
  { r: 0.1, g: 0.7, b: 0.3 },
  { r: 0, g: 0, b: 0 },
  { r: 1, g: 1, b: 1 },
];

export const rgbCss = (c: RGB, a = 1) =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;

export const uid = () => Math.random().toString(36).slice(2, 10);

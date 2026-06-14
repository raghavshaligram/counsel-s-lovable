// All coordinates are in PDF points (origin top-left from the user-facing
// canvas perspective; we convert to pdf-lib's bottom-left origin on export).

export type Tool =
  | "select"
  | "text"
  | "highlight"
  | "underline"
  | "strikethrough"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "freehand"
  | "note"
  | "image"
  | "edit-text"
  | "page-crop"
  | "redact";

export interface WatermarkSettings {
  text: string;
  opacity: number; // 0..1
  size: number;
  position: "diagonal" | "top" | "bottom" | "center";
  color: RGB;
}

export interface ProtectPermissions {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
}

export interface ProtectSettings {
  userPassword: string;
  ownerPassword?: string;
  permissions: ProtectPermissions;
}

export interface ExportSettings {
  watermark?: WatermarkSettings;
  protect?: ProtectSettings;
}

export type RGB = { r: number; g: number; b: number };

// Quad covering a single line of text (PDF points, top-left origin).
export interface Quad { x: number; y: number; w: number; h: number }

// Threaded comment reply.
export interface Reply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

// Source metadata captured from pdf.js text item — used by the destructive
// rewriter to find the matching Tj operand in the page's content stream.
export interface TextSource {
  originalString: string;
  transform?: number[]; // a,b,c,d,e,f (pdf.js text item transform)
  fontName?: string;
}

export interface BaseAnno {
  id: string;
  page: number; // index into the working page list
  // bounding box in PDF points
  x: number;
  y: number;
  w: number;
  h: number;
  color: RGB;
  opacity: number;
  // optional review/comment metadata — populated by the Comments panel
  contents?: string;
  author?: string;
  createdAt?: number;
  replies?: Reply[];
  resolved?: boolean;
}

export type TextAlign = "left" | "center" | "right";

export interface TextAnno extends BaseAnno {
  kind: "text";
  text: string;
  fontSize: number;
  family?: "sans" | "serif" | "mono";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: TextAlign;
}

export interface HighlightAnno extends BaseAnno {
  kind: "highlight";
  // When present, draw one rectangle per quad instead of the bbox.
  quads?: Quad[];
}

export interface UnderlineAnno extends BaseAnno {
  kind: "underline";
  stroke: number;
  quads?: Quad[];
}

export interface StrikethroughAnno extends BaseAnno {
  kind: "strikethrough";
  stroke: number;
  quads?: Quad[];
}

export interface LineAnno extends BaseAnno {
  kind: "line";
  stroke: number;
  // diagonal direction inside bbox: false = top-left → bottom-right,
  // true = top-right → bottom-left
  flipX?: boolean;
}

export interface ArrowAnno extends BaseAnno {
  kind: "arrow";
  stroke: number;
  flipX?: boolean;
}

export interface RectAnno extends BaseAnno {
  kind: "rect";
  stroke: number;
  fill: boolean;
}

export interface EllipseAnno extends BaseAnno {
  kind: "ellipse";
  stroke: number;
  fill: boolean;
}

export interface FreehandAnno extends BaseAnno {
  kind: "freehand";
  // points are stored relative to (x,y), in PDF points
  points: { x: number; y: number }[];
  stroke: number;
}

export interface NoteAnno extends BaseAnno {
  kind: "note";
  text: string;
}

export interface ImageAnno extends BaseAnno {
  kind: "image";
  // base64 data URL (png or jpg)
  dataUrl: string;
  mime: "image/png" | "image/jpeg";
}

// "Edit existing text" — covers original text bbox with whiteout, redraws.
// When `source` is present, the export pipeline will additionally try to
// rewrite the underlying content-stream Tj operator so search/copy reflects
// the new text. Falls back silently to whiteout-only on unsafe pages.
export type FontFamily = "sans" | "serif" | "mono";
export interface TextEditAnno extends BaseAnno {
  kind: "text-edit";
  text: string;
  fontSize: number;
  // background fill colour painted over original glyphs
  bg: RGB;
  family?: FontFamily;
  // Bundled metric-compatible open font: "carlito" | "arimo" | "tinos" | "caladea" | "cousine".
  // When present, overrides `family` for both on-screen overlay and PDF embed.
  fontKey?: string;
  bold?: boolean;
  italic?: boolean;
  // top offset (in PDF points) inside the bbox where the text should start.
  textOffsetY?: number;
  source?: TextSource;
}

// Destructive redaction: draws a solid fill over the bbox AND attempts to
// erase overlapping text from the content stream on export.
export interface RedactAnno extends BaseAnno {
  kind: "redact";
  // captured text strings that fall inside this redaction box (best-effort)
  sources?: TextSource[];
}

export type Anno =
  | TextAnno
  | HighlightAnno
  | UnderlineAnno
  | StrikethroughAnno
  | LineAnno
  | ArrowAnno
  | RectAnno
  | EllipseAnno
  | FreehandAnno
  | NoteAnno
  | ImageAnno
  | TextEditAnno
  | RedactAnno;

export interface PageOp {
  // index into the original source PDF
  srcPage: number;
  // additional rotation (degrees, multiples of 90). Combined with source page rotation.
  rotation: 0 | 90 | 180 | 270;
  // when true, draw a blank page instead of copying
  blank?: boolean;
  // original page size in PDF points (taken from source page)
  width: number;
  height: number;
  // Optional per-page crop rectangle in PDF points (top-left origin, matching
  // the editor canvas convention). When set, export trims the page to this
  // rect via /CropBox + /MediaBox. Cleared by setting to undefined.
  cropBox?: { x: number; y: number; w: number; h: number };
}

export interface EditorDoc {
  fileName: string;
  srcBytes: Uint8Array;
  pages: PageOp[]; // ordered list of pages in the working document
  annotations: Anno[];
}

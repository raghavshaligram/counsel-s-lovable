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
  /** Full pdf.js text item string that contained the marked text. */
  originalString: string;
  /** Exact sensitive substring to remove/verify when only part of the item is redacted. */
  redactText?: string;
  /** Substring span inside originalString, when known. */
  matchStart?: number;
  matchLength?: number;
  transform?: number[]; // a,b,c,d,e,f (pdf.js text item transform)
  fontName?: string;
  cssFamily?: string;
  bounds?: { x: number; y: number; w: number; h: number };
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
  fontWeight?: number | string;
  lineHeight?: number;
  letterSpacing?: number;
  family?: "sans" | "serif" | "mono";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: TextAlign;
  // Manual CSS font-family override picked from the toolbar dropdown.
  // When set, takes precedence over `family`/`fontKey` for on-screen rendering.
  fontFamilyOverride?: string;
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
  fontWeight?: number | string;
  lineHeight?: number;
  letterSpacing?: number;
  // background fill colour painted over original glyphs
  bg: RGB;
  family?: FontFamily;
  // Bundled metric-compatible open font: "carlito" | "arimo" | "tinos" | "caladea" | "cousine".
  // When present, overrides `family` for both on-screen overlay and PDF embed.
  fontKey?: string;
  // True when the original PDF font had no exact metric-compatible bundled
  // twin and `fontKey` is a best-guess fallback. Drives a subtle in-editor
  // hint so the user knows to confirm the choice in the font picker.
  fontApproximate?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: TextAlign;
  // offsets/padding (in PDF points) inside the bbox where the text should start.
  textOffsetX?: number;
  textOffsetY?: number;
  textPadBottom?: number;
  // ORIGINAL glyph bbox (PDF points, top-left origin). The cover rectangle
  // is drawn at this fixed rect — independent of the auto-grown text box —
  // so the underlying text always stays hidden even when the replacement
  // shrinks below the original size.
  cover?: { x: number; y: number; w: number; h: number };
  // Grown box height for the editable textarea, independent of cover/mask;
  // falls back to cover.h. The mask (cover) must stay pinned to the original
  // glyph rect; only the wrapper/textarea grows to fit multi-line content.
  boxH?: number;
  source?: TextSource;
  // Manual CSS font-family override picked from the toolbar dropdown.
  // When set, takes precedence over `fontKey`/`family` for on-screen rendering.
  fontFamilyOverride?: string;
}

// Destructive redaction: draws a solid fill over the bbox AND attempts to
// erase overlapping text from the content stream on export.
export interface RedactAnno extends BaseAnno {
  kind: "redact";
  // captured text strings that fall inside this redaction box (best-effort)
  sources?: TextSource[];
  // Origin/type of the box for certificate breakdown (never the value).
  // e.g. "name", "ssn", "email", "creditCard", "phone", "date", "ipAddress",
  // "iban", "pattern", "manual". Free-form string to stay forward-compatible.
  category?: string;
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

// OCR sidecar token — one recognized word, positioned in PDF points
// (top-left origin, matching the editor canvas convention). Tied to the
// SOURCE page index so reorder/delete page-ops don't displace the layer.
export interface OcrToken {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface OcrPageLayer {
  srcPage: number; // 0-based index into the original source PDF
  tokens: OcrToken[];
}

export interface EditorDoc {
  fileName: string;
  srcBytes: Uint8Array;
  pages: PageOp[]; // ordered list of pages in the working document
  annotations: Anno[];
  // On-device OCR text layer sidecar. Per-source-page invisible glyph data
  // composited live on the canvas (so Edit-text can target words) and
  // embedded as invisible text by exportEditedPdf. The base PDF (srcBytes)
  // is never mutated.
  ocrLayer?: OcrPageLayer[];
}


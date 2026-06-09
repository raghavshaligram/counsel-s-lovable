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
  | "edit-text";

export type RGB = { r: number; g: number; b: number };

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
}

export interface TextAnno extends BaseAnno {
  kind: "text";
  text: string;
  fontSize: number;
}

export interface HighlightAnno extends BaseAnno {
  kind: "highlight";
}

export interface UnderlineAnno extends BaseAnno {
  kind: "underline";
  stroke: number;
}

export interface StrikethroughAnno extends BaseAnno {
  kind: "strikethrough";
  stroke: number;
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
export type FontFamily = "sans" | "serif" | "mono";
export interface TextEditAnno extends BaseAnno {
  kind: "text-edit";
  text: string;
  fontSize: number;
  // background fill colour painted over original glyphs
  bg: RGB;
  family?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  // top offset (in PDF points) inside the bbox where the text should start.
  // Lets us oversize the whiteout box for full glyph coverage while keeping
  // the replacement text aligned to the original baseline.
  textOffsetY?: number;
}

export type Anno =
  | TextAnno
  | HighlightAnno
  | RectAnno
  | EllipseAnno
  | FreehandAnno
  | NoteAnno
  | ImageAnno
  | TextEditAnno;

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
}

export interface EditorDoc {
  fileName: string;
  srcBytes: Uint8Array;
  pages: PageOp[]; // ordered list of pages in the working document
  annotations: Anno[];
}

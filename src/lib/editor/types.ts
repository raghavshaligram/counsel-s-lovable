// All coordinates are in PDF points (origin top-left from the user-facing
// canvas perspective; we convert to pdf-lib's bottom-left origin on export).

export type Tool =
  | "select"
  | "text"
  | "highlight"
  | "rect"
  | "ellipse"
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

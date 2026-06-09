// Annotation data model. Coordinates are in PDF points, top-left origin
// (matches pdf.js canvas), converted to bottom-left on export.

export type AnnotTool =
  | "select"
  | "highlight"
  | "underline"
  | "strikethrough"
  | "note"
  | "freehand"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text";

export type RGB = { r: number; g: number; b: number };

export interface BaseAnnot {
  id: string;
  page: number;
  color: RGB;
  opacity: number;
  author?: string;
  createdAt: number;
  contents?: string; // popup comment
  replies?: { id: string; author: string; text: string; at: number }[];
}

// Bounding-box based (notes, text boxes, rects, ellipses)
export interface BoxAnnot extends BaseAnnot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteAnnot extends BoxAnnot {
  kind: "note";
}

export interface TextBoxAnnot extends BoxAnnot {
  kind: "text";
  text: string;
  fontSize: number;
}

export interface RectAnnot extends BoxAnnot {
  kind: "rect";
  stroke: number;
  fill: boolean;
}

export interface EllipseAnnot extends BoxAnnot {
  kind: "ellipse";
  stroke: number;
  fill: boolean;
}

// Two-point based (line, arrow)
export interface LineLikeAnnot extends BaseAnnot {
  x1: number; y1: number; x2: number; y2: number;
  stroke: number;
}
export interface LineAnnot extends LineLikeAnnot { kind: "line"; }
export interface ArrowAnnot extends LineLikeAnnot { kind: "arrow"; }

// Freehand ink — list of strokes, each stroke is list of points
export interface InkAnnot extends BaseAnnot {
  kind: "ink";
  strokes: { x: number; y: number; p?: number }[][];
  stroke: number;
  // cached bbox for hit-test / selection
  bbox: { x: number; y: number; w: number; h: number };
}

// Text-aware: a list of rectangles covering selected text glyphs
export interface QuadAnnot extends BaseAnnot {
  kind: "highlight" | "underline" | "strikethrough";
  rects: { x: number; y: number; w: number; h: number }[];
  // captured selected text for the comments sidebar
  selectedText?: string;
}

export type Annot =
  | NoteAnnot
  | TextBoxAnnot
  | RectAnnot
  | EllipseAnnot
  | LineAnnot
  | ArrowAnnot
  | InkAnnot
  | QuadAnnot;

export const PRESET_COLORS: RGB[] = [
  { r: 1, g: 0.93, b: 0.27 },     // yellow
  { r: 1, g: 0.45, b: 0.45 },     // red
  { r: 0.34, g: 0.84, b: 0.49 },  // green
  { r: 0.36, g: 0.66, b: 0.98 },  // blue
  { r: 0.78, g: 0.45, b: 0.96 },  // purple
  { r: 1, g: 0.62, b: 0.27 },     // orange
  { r: 0.07, g: 0.09, b: 0.12 },  // ink black
];

export function rgbToCss({ r, g, b }: RGB, a = 1): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

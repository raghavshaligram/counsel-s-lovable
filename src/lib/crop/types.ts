/**
 * Crop tool shared types.
 *
 * Coordinates are PDF user-space: origin bottom-left, units = points
 * (1 pt = 1/72 in). A `CropRect` is the cropbox itself, not margins.
 */
export type CropUnit = "pt" | "in" | "mm";

export interface CropRect {
  /** Bottom-left X in PDF user-space points. */
  x: number;
  /** Bottom-left Y in PDF user-space points. */
  y: number;
  /** Width in points. */
  w: number;
  /** Height in points. */
  h: number;
}

export type CropScope =
  | { kind: "current" }
  | { kind: "all" }
  | { kind: "odd" }
  | { kind: "even" }
  | { kind: "indices"; indices: number[] };

export interface CropPreset {
  id: string;
  label: string;
  blurb: string;
  /** Margins in points, [top, right, bottom, left]. */
  margins: [number, number, number, number];
}

export const CROP_PRESETS: CropPreset[] = [
  { id: "trim-1cm",  label: "Trim 1 cm",     blurb: "Symmetric 28.35pt trim — kills scanner edges.", margins: [28.35, 28.35, 28.35, 28.35] },
  { id: "letter",    label: "Letter margins", blurb: "1 in margin on every side.",                    margins: [72, 72, 72, 72] },
  { id: "a4-tight",  label: "A4 tight",       blurb: "12 mm content margin.",                         margins: [34, 34, 34, 34] },
];

/** unit conversion helpers (1 pt = 1/72 in = 25.4/72 mm) */
export function ptTo(v: number, unit: CropUnit): number {
  if (unit === "pt") return v;
  if (unit === "in") return v / 72;
  return (v / 72) * 25.4;
}
export function ptFrom(v: number, unit: CropUnit): number {
  if (unit === "pt") return v;
  if (unit === "in") return v * 72;
  return (v / 25.4) * 72;
}

/**
 * Outline & link annotation types — shared between parse/write and the UI.
 */

export interface Dest {
  /** 0-based page index. */
  page: number;
  /** PDF user-space coordinates. null = inherit. */
  x: number | null;
  y: number | null;
  /** null = inherit. */
  zoom: number | null;
}

export type OutlineStyle = {
  bold: boolean;
  italic: boolean;
};

export interface OutlineNode {
  id: string;
  title: string;
  dest: Dest | null;
  style: OutlineStyle;
  /** RGB 0–1 each. null = default (black). */
  color: [number, number, number] | null;
  expanded: boolean;
  children: OutlineNode[];
}

export type LinkKind =
  | { kind: "url"; url: string }
  | { kind: "goto"; dest: Dest };

export interface LinkAnnot {
  id: string;
  /** Page the link rect lives ON (0-based). */
  page: number;
  /** PDF user-space rect [llx, lly, urx, ury]. */
  rect: [number, number, number, number];
  target: LinkKind;
}

export interface ParsedDoc {
  outline: OutlineNode[];
  links: LinkAnnot[];
  /** Total page count for quick UI math. */
  pageCount: number;
}

export function newId(prefix = "n"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

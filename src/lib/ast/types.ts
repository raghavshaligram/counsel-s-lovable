// Minimal AST types — Phase 1 placeholder. Full Zod schema in Phase 2.
export type Size = { w: number; h: number; name: string };

export type SemanticToken =
  | "brand.primary"
  | "brand.secondary"
  | "brand.accent"
  | "surface"
  | "ink"
  | "ink.muted";

export type Color = { token?: SemanticToken; hex?: string };

export interface BaseNode {
  id: string;
  locked?: boolean;
}

export interface ContainerNode extends BaseNode {
  type: "container";
  layout: "stack" | "row" | "absolute";
  gap?: number;
  padding?: number;
  align?: "start" | "center" | "end";
  justify?: "start" | "center" | "end" | "between";
  background?: Color;
  radius?: number;
  flex?: number;
  width?: number | "fill";
  height?: number | "fill";
  x?: number;
  y?: number;
  children: ASTNode[];
}

export interface TextNode extends BaseNode {
  type: "text";
  text: string;
  variable?: string;
  font?: "display" | "body" | "mono";
  weight?: 400 | 500 | 600 | 700 | 800;
  size?: number;
  color?: Color;
  align?: "left" | "center" | "right";
  maxLines?: number;
}

export interface ImageNode extends BaseNode {
  type: "image";
  src: string;
  variable?: string;
  fit?: "cover" | "contain";
  radius?: number;
  width?: number | "fill";
  height?: number | "fill";
  flex?: number;
}

export interface QRNode extends BaseNode {
  type: "qr";
  url: string;
  variable?: string;
  fg?: Color;
  bg?: Color;
  size?: number;
}

export type ASTNode = ContainerNode | TextNode | ImageNode | QRNode;

export interface TemplateAST {
  id: string;
  name: string;
  sizes: Size[];
  root: ContainerNode;
  variables?: Record<string, { label: string; default: string }>;
}

export interface TemplateMeta {
  id: string;
  name: string;
  niche: string;
  occasion: string;
  format: string;
  aesthetic: string;
  thumbColor: string;
}

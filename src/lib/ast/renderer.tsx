import type { ASTNode, Color, ContainerNode, TemplateAST } from "./types";

type Brand = {
  "brand.primary": string;
  "brand.secondary": string;
  "brand.accent": string;
  surface: string;
  ink: string;
  "ink.muted": string;
};

export const DEFAULT_BRAND: Brand = {
  "brand.primary": "#1f4ed8",
  "brand.secondary": "#0ea5e9",
  "brand.accent": "#f59e0b",
  surface: "#ffffff",
  ink: "#0a0f1f",
  "ink.muted": "#6b7280",
};

function resolveColor(c: Color | undefined, brand: Brand): string | undefined {
  if (!c) return undefined;
  if (c.hex) return c.hex;
  if (c.token) return brand[c.token];
  return undefined;
}

function interpolate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

const FONTS: Record<string, string> = {
  display: '"Fraunces", "Times New Roman", serif',
  body: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", monospace',
};

function renderNode(
  node: ASTNode,
  brand: Brand,
  vars: Record<string, string>,
  selectedId: string | null,
  onSelect?: (id: string) => void,
): React.ReactNode {
  const isSelected = selectedId === node.id;
  const outline = isSelected ? "2px solid #2563eb" : undefined;
  const click = onSelect
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(node.id);
      }
    : undefined;

  if (node.type === "container") {
    const isAbs = node.layout === "absolute";
    const style: React.CSSProperties = {
      display: "flex",
      flexDirection: node.layout === "row" ? "row" : "column",
      position: isAbs ? "absolute" : "relative",
      gap: node.gap,
      padding: node.padding,
      alignItems: node.align ?? "stretch",
      justifyContent:
        node.justify === "between" ? "space-between" : node.justify ?? "flex-start",
      background: resolveColor(node.background, brand),
      borderRadius: node.radius,
      flex: node.flex,
      width: node.width === "fill" ? "100%" : node.width,
      height: node.height === "fill" ? "100%" : node.height,
      left: node.x,
      top: node.y,
      outline,
      outlineOffset: -2,
      cursor: onSelect ? "pointer" : undefined,
      overflow: "hidden",
    };
    return (
      <div key={node.id} style={style} onClick={click}>
        {(node as ContainerNode).children.map((c) =>
          renderNode(c, brand, vars, selectedId, onSelect),
        )}
      </div>
    );
  }

  if (node.type === "text") {
    const style: React.CSSProperties = {
      fontFamily: FONTS[node.font ?? "body"],
      fontWeight: node.weight ?? 500,
      fontSize: node.size ?? 18,
      color: resolveColor(node.color, brand) ?? brand.ink,
      textAlign: node.align ?? "left",
      lineHeight: 1.15,
      letterSpacing: (node.size ?? 18) > 40 ? "-0.02em" : undefined,
      display: node.maxLines ? "-webkit-box" : undefined,
      WebkitLineClamp: node.maxLines,
      WebkitBoxOrient: node.maxLines ? "vertical" : undefined,
      overflow: node.maxLines ? "hidden" : undefined,
      outline,
      cursor: onSelect ? "pointer" : undefined,
    };
    return (
      <div key={node.id} style={style} onClick={click}>
        {interpolate(node.text, vars)}
      </div>
    );
  }

  if (node.type === "image") {
    const src = interpolate(node.src, vars);
    const style: React.CSSProperties = {
      width: node.width === "fill" ? "100%" : node.width,
      height: node.height === "fill" ? "100%" : node.height,
      flex: node.flex,
      objectFit: node.fit ?? "cover",
      borderRadius: node.radius,
      display: "block",
      outline,
      cursor: onSelect ? "pointer" : undefined,
    };
    return <img key={node.id} src={src} alt="" style={style} onClick={click} />;
  }

  if (node.type === "qr") {
    const style: React.CSSProperties = {
      width: node.size ?? 200,
      height: node.size ?? 200,
      background: resolveColor(node.bg, brand) ?? "#fff",
      color: resolveColor(node.fg, brand) ?? "#000",
      display: "grid",
      placeItems: "center",
      border: "2px dashed currentColor",
      fontFamily: FONTS.mono,
      fontSize: 12,
      outline,
      cursor: onSelect ? "pointer" : undefined,
    };
    return (
      <div key={node.id} style={style} onClick={click}>
        QR
      </div>
    );
  }

  return null;
}

export function ASTRenderer({
  ast,
  brand = DEFAULT_BRAND,
  vars,
  size,
  scale = 1,
  selectedId = null,
  onSelect,
}: {
  ast: TemplateAST;
  brand?: Brand;
  vars?: Record<string, string>;
  size?: { w: number; h: number };
  scale?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const s = size ?? ast.sizes[0];
  const mergedVars = {
    ...Object.fromEntries(
      Object.entries(ast.variables ?? {}).map(([k, v]) => [k, v.default]),
    ),
    ...(vars ?? {}),
  };
  return (
    <div
      style={{
        width: s.w * scale,
        height: s.h * scale,
        position: "relative",
        background: "#fff",
        boxShadow: "0 30px 80px -30px rgba(15,23,42,0.25)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: s.w,
          height: s.h,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
        }}
        onClick={() => onSelect?.("")}
      >
        {renderNode(ast.root, brand, mergedVars, selectedId, onSelect)}
      </div>
    </div>
  );
}

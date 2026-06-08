import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { getTemplate } from "@/lib/ast/fixtures";
import { ASTRenderer, DEFAULT_BRAND } from "@/lib/ast/renderer";
import type { ASTNode, TemplateAST, TextNode } from "@/lib/ast/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronLeft, Download, Type, Image as ImageIcon, Square, QrCode } from "lucide-react";

export const Route = createFileRoute("/editor/$templateId")({
  component: EditorPage,
  notFoundComponent: () => (
    <AppShell>
      <div className="p-10 text-center text-muted-foreground">Template not found.</div>
    </AppShell>
  ),
  loader: ({ params }) => {
    const t = getTemplate(params.templateId);
    if (!t) throw notFound();
    return { template: t };
  },
});

function walk(node: ASTNode, cb: (n: ASTNode, depth: number) => void, depth = 0) {
  cb(node, depth);
  if (node.type === "container") node.children.forEach((c) => walk(c, cb, depth + 1));
}

function findNode(root: ASTNode, id: string): ASTNode | null {
  let found: ASTNode | null = null;
  walk(root, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

function nodeIcon(type: ASTNode["type"]) {
  return type === "container" ? Square : type === "text" ? Type : type === "image" ? ImageIcon : QrCode;
}

function EditorPage() {
  const { template } = Route.useLoaderData();
  const ast = template.ast;
  const [vars, setVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(ast.variables ?? {}).map(([k, v]) => [k, v.default])),
  );
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [selected, setSelected] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => (selected ? findNode(ast.root, selected) : null),
    [selected, ast.root],
  );

  // Auto-scale preview to container
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const size = ast.sizes[0];
      const pad = 48;
      const s = Math.min((r.width - pad) / size.w, (r.height - pad) / size.h);
      setScale(Math.max(0.1, Math.min(s, 1.5)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ast.sizes]);

  const layers: { node: ASTNode; depth: number }[] = [];
  walk(ast.root, (n, d) => layers.push({ node: n, depth: d }));

  return (
    <AppShell>
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr_320px] h-[calc(100vh-3.5rem)]">
        {/* Layers panel */}
        <aside className="border-r border-border bg-background overflow-y-auto">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/"><ChevronLeft className="h-4 w-4" /> Catalog</Link>
            </Button>
          </div>
          <div className="p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Layers</p>
            <ul className="space-y-0.5">
              {layers.map(({ node, depth }) => {
                const Icon = nodeIcon(node.type);
                const active = selected === node.id;
                return (
                  <li key={node.id}>
                    <button
                      onClick={() => setSelected(node.id)}
                      style={{ paddingLeft: 8 + depth * 12 }}
                      className={`w-full flex items-center gap-2 text-xs py-1.5 pr-2 rounded-md transition ${
                        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {node.type === "text" ? (node as TextNode).text.slice(0, 24) : node.id}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* Canvas */}
        <section
          ref={stageRef}
          className="relative bg-[var(--studio-bg)] overflow-hidden grid place-items-center"
          onClick={() => setSelected(null)}
        >
          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded-md border border-border">
            {ast.sizes[0].name} · {ast.sizes[0].w}×{ast.sizes[0].h} · {Math.round(scale * 100)}%
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <ASTRenderer
              ast={ast}
              brand={brand}
              vars={vars}
              scale={scale}
              selectedId={selected}
              onSelect={(id) => setSelected(id || null)}
            />
          </div>
          <div className="absolute bottom-3 right-3 flex gap-2">
            <Button size="sm" variant="secondary"><Download className="h-3.5 w-3.5 mr-1.5" /> Export</Button>
          </div>
        </section>

        {/* Properties */}
        <aside className="border-l border-border bg-background overflow-y-auto">
          <Tabs defaultValue="content" className="w-full">
            <TabsList className="w-full rounded-none border-b bg-transparent h-11 p-0">
              <TabsTrigger value="content" className="flex-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">Content</TabsTrigger>
              <TabsTrigger value="node" className="flex-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">Node</TabsTrigger>
              <TabsTrigger value="brand" className="flex-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary">Brand</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="p-4 space-y-4 mt-0">
              <h3 className="text-sm font-medium">Template variables</h3>
              {Object.entries(ast.variables ?? {}).map(([k, meta]) => (
                <div key={k} className="space-y-1.5">
                  <Label className="text-xs">{meta.label}</Label>
                  <Input
                    value={vars[k] ?? ""}
                    onChange={(e) => setVars((v) => ({ ...v, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </TabsContent>

            <TabsContent value="node" className="p-4 mt-0">
              {selectedNode ? (
                <NodeInspector node={selectedNode} />
              ) : (
                <p className="text-xs text-muted-foreground">Click a layer or canvas element to edit its locked controls.</p>
              )}
            </TabsContent>

            <TabsContent value="brand" className="p-4 space-y-3 mt-0">
              <h3 className="text-sm font-medium">Brand tokens</h3>
              {(Object.keys(brand) as (keyof typeof brand)[]).map((k) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{k}</Label>
                  <input
                    type="color"
                    value={brand[k]}
                    onChange={(e) => setBrand((b) => ({ ...b, [k]: e.target.value }))}
                    className="h-8 w-12 rounded border border-border bg-transparent cursor-pointer"
                  />
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </AppShell>
  );
}

function NodeInspector({ node }: { node: ASTNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{node.type}</span>
        <span className="text-xs text-muted-foreground">· {node.id}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Locked controls per node type — Phase 2 wires real editing into the AST. Right now this confirms selection state and shape of the inspector.
      </p>
      <pre className="text-[10px] font-mono bg-secondary p-2 rounded-md overflow-x-auto max-h-60">
        {JSON.stringify(node, null, 2)}
      </pre>
    </div>
  );
}

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { getTemplate } from "@/lib/ast/fixtures";
import { ASTRenderer, DEFAULT_BRAND } from "@/lib/ast/renderer";
import type { ASTNode, TemplateAST, TextNode, ImageNode } from "@/lib/ast/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Download, Image as ImageIcon, Type, Palette, Wand2 } from "lucide-react";

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

function walk(node: ASTNode, cb: (n: ASTNode) => void) {
  cb(node);
  if (node.type === "container") node.children.forEach((c) => walk(c, cb));
}

function findNode(root: ASTNode, id: string): ASTNode | null {
  let found: ASTNode | null = null;
  walk(root, (n) => {
    if (n.id === id) found = n;
  });
  return found;
}

type Tab = "content" | "photos" | "brand";

function EditorPage() {
  const { template } = Route.useLoaderData();
  const ast: TemplateAST = template.ast;

  const [vars, setVars] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(ast.variables ?? {}).map(([k, v]) => [k, (v as { default: string }).default]),
    ),
  );
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("content");

  const selectedNode = useMemo(
    () => (selected ? findNode(ast.root, selected) : null),
    [selected, ast.root],
  );

  // Map node → variable that drives it (so clicking a text/image jumps to its field)
  const varForNode = useMemo(() => {
    const map: Record<string, string> = {};
    walk(ast.root, (n) => {
      if ((n.type === "text" || n.type === "image") && n.variable) map[n.id] = n.variable;
    });
    return map;
  }, [ast.root]);

  // Auto-scale preview to container
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const size = ast.sizes[0];
      const pad = 64;
      const s = Math.min((r.width - pad) / size.w, (r.height - pad) / size.h);
      setScale(Math.max(0.1, Math.min(s, 1.5)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ast.sizes]);

  // List user-editable fields, grouped by photos vs words
  const wordFields = Object.entries(ast.variables ?? {}).filter(([, m]) => {
    const def = (m as { default: string }).default;
    return !/^https?:\/\//.test(def);
  });
  const photoFields = Object.entries(ast.variables ?? {}).filter(([, m]) => {
    const def = (m as { default: string }).default;
    return /^https?:\/\//.test(def);
  });

  function handleSelect(id: string) {
    setSelected(id || null);
    if (!id) return;
    const v = varForNode[id];
    if (v) {
      const isPhoto = /^https?:\/\//.test(vars[v] ?? "");
      setTab(isPhoto ? "photos" : "content");
    }
  }

  return (
    <AppShell>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] h-[calc(100vh-3.5rem)]">
        {/* Canvas */}
        <section
          ref={stageRef}
          className="relative bg-[var(--studio-bg)] overflow-hidden grid place-items-center"
          onClick={() => setSelected(null)}
        >
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="h-8">
              <Link to="/"><ChevronLeft className="h-4 w-4 mr-1" /> Back</Link>
            </Button>
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {ast.sizes[0].name} · {ast.sizes[0].w}×{ast.sizes[0].h}
            </span>
          </div>

          <div onClick={(e) => e.stopPropagation()}>
            <ASTRenderer
              ast={ast}
              brand={brand}
              vars={vars}
              scale={scale}
              selectedId={selected}
              onSelect={handleSelect}
            />
          </div>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-muted-foreground bg-background/80 backdrop-blur px-3 py-1.5 rounded-full border border-border flex items-center gap-1.5">
            <Wand2 className="h-3 w-3" />
            Click anything to edit. Layout stays locked.
          </div>

          <div className="absolute bottom-3 right-3 flex gap-2">
            <Button size="sm" className="h-9"><Download className="h-3.5 w-3.5 mr-1.5" /> Download</Button>
          </div>
        </section>

        {/* Right panel */}
        <aside className="border-l border-border bg-background flex flex-col min-h-0">
          <div className="grid grid-cols-3 border-b border-border">
            <TabBtn icon={Type} label="Words" active={tab === "content"} onClick={() => setTab("content")} />
            <TabBtn icon={ImageIcon} label="Photos" active={tab === "photos"} onClick={() => setTab("photos")} />
            <TabBtn icon={Palette} label="Colors" active={tab === "brand"} onClick={() => setTab("brand")} />
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Selected-element callout */}
            {selectedNode && (
              <SelectedCallout
                node={selectedNode}
                vars={vars}
                setVars={setVars}
                varForNode={varForNode}
              />
            )}

            {tab === "content" && (
              <div className="p-4 space-y-4">
                <SectionHeader title="Words" hint="Change the text. Sizes and layout stay locked." />
                {wordFields.length === 0 && <Empty text="No text fields in this template." />}
                {wordFields.map(([k, m]) => {
                  const meta = m as { label: string; default: string };
                  const long = (vars[k] ?? "").length > 40;
                  return (
                    <div key={k} className="space-y-1.5">
                      <Label className="text-xs">{meta.label}</Label>
                      {long ? (
                        <Textarea
                          value={vars[k] ?? ""}
                          onChange={(e) => setVars((v) => ({ ...v, [k]: e.target.value }))}
                          rows={2}
                        />
                      ) : (
                        <Input
                          value={vars[k] ?? ""}
                          onChange={(e) => setVars((v) => ({ ...v, [k]: e.target.value }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "photos" && (
              <div className="p-4 space-y-4">
                <SectionHeader title="Photos" hint="Paste a link or upload — we'll crop it for you." />
                {photoFields.length === 0 && <Empty text="No photo slots in this template." />}
                {photoFields.map(([k, m]) => {
                  const meta = m as { label: string; default: string };
                  return (
                    <div key={k} className="space-y-2">
                      <Label className="text-xs">{meta.label}</Label>
                      <div className="aspect-video rounded-md overflow-hidden bg-secondary border border-border">
                        {vars[k] && (
                          <img src={vars[k]} alt="" className="h-full w-full object-cover" />
                        )}
                      </div>
                      <Input
                        value={vars[k] ?? ""}
                        onChange={(e) => setVars((v) => ({ ...v, [k]: e.target.value }))}
                        placeholder="https://…"
                      />
                      <Button size="sm" variant="secondary" className="w-full h-8 text-xs" disabled>
                        Upload photo (coming soon)
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "brand" && (
              <div className="p-4 space-y-4">
                <SectionHeader title="Your colors" hint="Set once, applies to every template you use." />
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(brand) as (keyof typeof brand)[]).map((k) => (
                    <label
                      key={k}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border hover:bg-secondary/50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="h-6 w-6 rounded-full border border-border shrink-0"
                          style={{ background: brand[k] }}
                        />
                        <span className="text-sm capitalize">{labelForToken(k)}</span>
                      </div>
                      <input
                        type="color"
                        value={brand[k]}
                        onChange={(e) => setBrand((b) => ({ ...b, [k]: e.target.value }))}
                        className="h-7 w-10 rounded border border-border bg-transparent cursor-pointer"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground pt-2">
                  Brand colors blend in at render time — your templates aren't rewritten.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}

function labelForToken(k: string) {
  const map: Record<string, string> = {
    "brand.primary": "Primary",
    "brand.secondary": "Secondary",
    "brand.accent": "Accent",
    surface: "Background",
    ink: "Text",
    "ink.muted": "Muted text",
  };
  return map[k] ?? k;
}

function TabBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Type;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-11 flex items-center justify-center gap-2 text-sm transition ${
        active
          ? "text-foreground border-b-2 border-primary -mb-px"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h3 className="font-[Fraunces] text-lg">{title}</h3>
      <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground italic">{text}</p>;
}

function SelectedCallout({
  node,
  vars,
  setVars,
  varForNode,
}: {
  node: ASTNode;
  vars: Record<string, string>;
  setVars: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  varForNode: Record<string, string>;
}) {
  const v = varForNode[node.id];
  if (!v) {
    return (
      <div className="px-4 py-3 bg-secondary/50 border-b border-border text-xs text-muted-foreground">
        This element is locked by the template — pick a different one or edit your brand colors.
      </div>
    );
  }
  const value = vars[v] ?? "";
  const isPhoto = /^https?:\/\//.test(value);
  return (
    <div className="px-4 py-3 bg-secondary/40 border-b border-border space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Editing selection
      </div>
      {isPhoto ? (
        <Input value={value} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} placeholder="Photo URL" />
      ) : (node as TextNode).text.length > 40 ? (
        <Textarea value={value} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} rows={2} />
      ) : (
        <Input value={value} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} />
      )}
    </div>
  );
}

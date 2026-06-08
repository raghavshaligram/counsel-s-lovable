import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useRef, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { FIXTURE_TEMPLATES } from "@/lib/ast/fixtures";
import { ASTRenderer } from "@/lib/ast/renderer";
import type { TemplateAST } from "@/lib/ast/types";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

function TemplateThumb({ ast }: { ast: TemplateAST }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  const native = ast.sizes[0];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setScale(w / native.w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [native.w]);

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden">
      <div
        style={{
          width: native.w,
          height: native.h,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <ASTRenderer ast={ast} scale={1} />
      </div>
    </div>
  );
}


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GridPulse — Template Catalog" },
      { name: "description", content: "Pick a template, click to edit, ship it." },
    ],
  }),
  component: CatalogPage,
});

const FACETS = {
  niche: ["all", "realtor", "ecommerce"],
  occasion: ["all", "just-listed", "just-sold", "rate-drop", "sale"],
  aesthetic: ["all", "editorial", "bold", "playful"],
};

function CatalogPage() {
  const [query, setQuery] = useState("");
  const [niche, setNiche] = useState("all");
  const [occasion, setOccasion] = useState("all");
  const [aesthetic, setAesthetic] = useState("all");

  const filtered = useMemo(() => {
    return FIXTURE_TEMPLATES.filter((t) => {
      if (niche !== "all" && t.niche !== niche) return false;
      if (occasion !== "all" && t.occasion !== occasion) return false;
      if (aesthetic !== "all" && t.aesthetic !== aesthetic) return false;
      if (query && !t.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [query, niche, occasion, aesthetic]);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-6 md:px-10 py-12 md:py-16">
        <div className="grid md:grid-cols-[1.1fr_1fr] gap-10 mb-12 items-end border-b border-border pb-10">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-5">
              Vol. 01 · The Catalog
            </p>
            <h1 className="font-display text-5xl md:text-7xl font-semibold leading-[0.95]">
              Pick a template.
              <br />
              <span className="italic font-normal text-muted-foreground">Make it yours.</span>
            </h1>
          </div>
          <p className="text-base md:text-lg text-muted-foreground max-w-md md:justify-self-end leading-relaxed">
            Layout is locked by a designer. You type the words, drop in the photos, set your colors —
            and it always looks right.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3 mb-10">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-11 bg-background border-border rounded-none"
            />
          </div>
          <FacetPills label="Niche" value={niche} options={FACETS.niche} onChange={setNiche} />
          <FacetPills label="Occasion" value={occasion} options={FACETS.occasion} onChange={setOccasion} />
          <FacetPills label="Style" value={aesthetic} options={FACETS.aesthetic} onChange={setAesthetic} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-12">
          {filtered.map((t, i) => (
            <Link
              key={t.id}
              to="/editor/$templateId"
              params={{ templateId: t.id }}
              className="group block"
            >
              <div
                className="aspect-square overflow-hidden bg-background relative border border-border"
                style={{ containerType: "inline-size" }}
              >
                <div className="absolute top-3 left-3 z-10 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  №&nbsp;{String(i + 1).padStart(2, "0")}
                </div>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: t.ast.sizes[0].w,
                    height: t.ast.sizes[0].h,
                    transform: `scale(calc(100cqw / ${t.ast.sizes[0].w}))`,
                    transformOrigin: "top left",
                  }}
                >
                  <ASTRenderer ast={t.ast} scale={1} />
                </div>
                <div className="absolute inset-0 ring-0 group-hover:ring-1 ring-foreground/60 transition pointer-events-none" />
              </div>
              <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
                <div>
                  <div className="font-display text-lg leading-tight">{t.name}</div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mt-1">
                    {t.niche} · {t.occasion.replace("-", " ")}
                  </div>
                </div>
                <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition translate-x-0 group-hover:-translate-x-0.5">
                  Open →
                </span>
              </div>
            </Link>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-20 text-muted-foreground text-sm">
              No templates match those filters.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function FacetPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-background border border-border px-2 h-11">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground pr-2">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`text-xs px-2.5 py-1 capitalize transition ${
            value === o
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.replace("-", " ")}
        </button>
      ))}
    </div>
  );
}

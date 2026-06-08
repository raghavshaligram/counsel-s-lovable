import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { FIXTURE_TEMPLATES } from "@/lib/ast/fixtures";
import { ASTRenderer } from "@/lib/ast/renderer";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

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
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-2 mb-8">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Catalog</p>
          <h1 className="font-[Fraunces] text-4xl md:text-5xl font-700 tracking-tight">
            Pick a template. <span className="text-muted-foreground italic">Make it yours.</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mt-2">
            Layout is locked. Type, swap photos, and recolor — you can't make it ugly.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search templates…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 h-11 bg-background"
            />
          </div>
          <FacetPills label="Niche" value={niche} options={FACETS.niche} onChange={setNiche} />
          <FacetPills label="Occasion" value={occasion} options={FACETS.occasion} onChange={setOccasion} />
          <FacetPills label="Style" value={aesthetic} options={FACETS.aesthetic} onChange={setAesthetic} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((t) => (
            <Link
              key={t.id}
              to="/editor/$templateId"
              params={{ templateId: t.id }}
              className="group block"
            >
              <div className="aspect-square overflow-hidden rounded-xl border border-border bg-background relative">
                <div className="absolute inset-0 grid place-items-center p-6">
                  <ASTRenderer ast={t.ast} scale={300 / t.ast.sizes[0].w} />
                </div>
                <div className="absolute inset-0 ring-0 group-hover:ring-2 ring-primary/40 transition rounded-xl pointer-events-none" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{t.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">
                    {t.niche} · {t.occasion.replace("-", " ")}
                  </div>
                </div>
                <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition">
                  Edit →
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
    <div className="flex items-center gap-1 bg-background border border-border rounded-lg px-2 h-11">
      <span className="text-xs text-muted-foreground pr-1">{label}</span>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`text-xs px-2.5 py-1 rounded-md capitalize transition ${
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

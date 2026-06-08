import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FIXTURE_TEMPLATES } from "@/lib/ast/fixtures";
import { ASTRenderer } from "@/lib/ast/renderer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  const [selectedId, setSelectedId] = useState(FIXTURE_TEMPLATES[0].id);
  const selected = FIXTURE_TEMPLATES.find((t) => t.id === selectedId)!;
  const [astText, setAstText] = useState(JSON.stringify(selected.ast, null, 2));
  const [parsed, setParsed] = useState(selected.ast);
  const [err, setErr] = useState<string | null>(null);

  function pick(id: string) {
    const t = FIXTURE_TEMPLATES.find((x) => x.id === id)!;
    setSelectedId(id);
    setAstText(JSON.stringify(t.ast, null, 2));
    setParsed(t.ast);
    setErr(null);
  }

  function apply() {
    try {
      const next = JSON.parse(astText);
      setParsed(next);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <AppShell>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] h-[calc(100vh-3.5rem)]">
        <aside className="border-r border-border bg-background overflow-y-auto p-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Templates</p>
            <Button size="sm" variant="ghost" className="h-7 text-xs">+ New</Button>
          </div>
          <ul className="space-y-1">
            {FIXTURE_TEMPLATES.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => pick(t.id)}
                  className={`w-full text-left text-xs px-2 py-2 rounded-md transition ${
                    selectedId === t.id ? "bg-secondary" : "hover:bg-secondary/50 text-muted-foreground"
                  }`}
                >
                  <div className="font-medium text-foreground">{t.name}</div>
                  <div className="capitalize text-[10px] mt-0.5">{t.niche} · {t.aesthetic}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-6 p-3 rounded-md bg-secondary/50 border border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Co-Pilot</p>
            <p className="text-xs text-muted-foreground">OpenAI template generation lands in Phase 4.</p>
          </div>
        </aside>

        <section className="bg-[var(--studio-bg)] grid place-items-center p-6 overflow-hidden">
          <ASTRenderer ast={parsed} scale={Math.min(0.4, 480 / parsed.sizes[0].w)} />
        </section>

        <section className="border-l border-border bg-background flex flex-col min-h-0">
          <div className="px-4 h-11 border-b border-border flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Raw AST</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                <Link to="/editor/$templateId" params={{ templateId: selectedId }}>Open in editor</Link>
              </Button>
              <Button size="sm" onClick={apply} className="h-7 text-xs">Apply</Button>
            </div>
          </div>
          <Textarea
            value={astText}
            onChange={(e) => setAstText(e.target.value)}
            className="flex-1 font-mono text-[11px] rounded-none border-0 resize-none focus-visible:ring-0"
          />
          {err && (
            <div className="px-4 py-2 text-xs text-destructive border-t border-destructive/30 bg-destructive/5">
              {err}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

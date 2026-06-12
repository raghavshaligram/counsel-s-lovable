/**
 * Tool panels — per-tool inspector bodies. Exactly ONE renders inside the
 * single Inspector container at any time. No outer card/wrapper here: the
 * Inspector already provides the header, border, and scroll area.
 */
import { useState } from "react";
import { Sparkles, Search, Tag, ShieldCheck, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

type PanelProps = { toolId: string };

export function ToolPanel({ toolId }: PanelProps) {
  switch (toolId) {
    case "redact":
      return <RedactPanel />;
    default:
      return <ComingSoonPanel label={toolId} />;
  }
}

/* ------------------------------ Redact ------------------------------ */

function RedactPanel() {
  const [query, setQuery] = useState("");
  const [exemption, setExemption] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Section title="Get started">
        <p className="text-[11.5px] leading-snug text-text-2">
          Drag a box over the page to redact, or use the tools below. Redactions
          are baked in on export — never reversible.
        </p>
      </Section>

      <Section title="Auto-detect PII" icon={<Wand2 className="h-3 w-3" />}>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          Scan this document
        </button>
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Finds names, emails, phone numbers, SSNs, addresses.
        </p>
      </Section>

      <Section title="Find &amp; redact" icon={<Search className="h-3 w-3" />}>
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Text or /regex/"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
          />
          <button
            type="button"
            disabled={!query.trim()}
            className={cn(
              "rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3",
              !query.trim() && "opacity-40 cursor-not-allowed",
            )}
          >
            Find
          </button>
        </div>
      </Section>

      <Section title="Exemption label" icon={<Tag className="h-3 w-3" />}>
        <input
          value={exemption}
          onChange={(e) => setExemption(e.target.value)}
          placeholder="e.g. FOIA (b)(6)"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
        />
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Stamped on each redaction mark.
        </p>
      </Section>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ----------------------------- Generic ------------------------------ */

function ComingSoonPanel({ label }: { label: string }) {
  return (
    <p className="text-[11.5px] leading-snug text-text-2">
      The native <span className="text-foreground">{label}</span> panel is being
      mounted here. The full controls land in the next pass — same single
      inspector, no second column.
    </p>
  );
}

/* ----------------------------- Section ------------------------------ */

function Section({
  title,
  icon,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

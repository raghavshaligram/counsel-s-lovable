import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ArrowRight, Search, Lock } from "lucide-react";
import { KB, type KBEntry } from "@/lib/assist/knowledge-base";

const SEO_TITLE = "Help Center — CounselPDF";
const SEO_DESCRIPTION =
  "How every CounselPDF tool works — redaction, Bates, exhibit binders, privilege review, OCR, workflows, privacy, and plans. Runs entirely on your device.";

/**
 * Section grouping for the public help center. IDs mirror `KB` in
 * src/lib/assist/knowledge-base.ts — adding a new KB entry means adding
 * its id to the right section here (or a new section below).
 */
const SECTIONS: Array<{ title: string; ids: string[] }> = [
  {
    title: "Redaction",
    ids: ["redact-basics", "redact-ai-detect", "redact-bulk", "verifiable-redaction"],
  },
  { title: "Bates numbering", ids: ["bates-single", "bates-multi"] },
  {
    title: "Legal workflows",
    ids: ["exhibit-binder", "privilege-review", "citation-hyperlinker", "toa", "doc-hash", "templates"],
  },
  {
    title: "Editing & assembly",
    ids: ["sanitize", "ocr", "compress", "repair", "merge", "split", "organize", "sign", "watermark", "compare"],
  },
  { title: "AI & automation", ids: ["workflows", "pre-discovery", "counsel-itself"] },
  { title: "Privacy", ids: ["privacy-on-device", "offline", "verify-privacy"] },
  { title: "Plans", ids: ["plans"] },
];

function faqJsonLd(entries: KBEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.questions[0],
      acceptedAnswer: {
        "@type": "Answer",
        text: e.steps && e.steps.length
          ? `${e.answer} Steps: ${e.steps.join("; ")}.`
          : e.answer,
      },
    })),
  };
}

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: SEO_TITLE },
      { name: "description", content: SEO_DESCRIPTION },
      { property: "og:title", content: SEO_TITLE },
      { property: "og:description", content: SEO_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/help" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "/help" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(faqJsonLd(KB)),
      },
    ],
  }),
  component: HelpPage,
});

function HelpPage() {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(KB.map((e) => [e.id, e])), []);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return null;
    return KB.filter((e) => {
      const hay = [e.answer, ...e.questions, ...(e.steps ?? []), ...(e.topic ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(query);
    });
  }, [query]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-6 py-16">
        {/* Hero */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[10.5px] uppercase tracking-[0.18em] text-text-muted">
            <Lock className="h-3 w-3 text-vault" strokeWidth={2.5} />
            On-device help center
          </div>
          <h1 className="mt-3 font-display text-4xl leading-tight text-foreground">
            How CounselPDF works
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] text-text-muted">
            Every tool, every workflow. Same knowledge Counsel (the in-app
            assistant) uses to answer questions — published here so you can
            browse it, share links to it, and audit what the assistant knows.
          </p>

          {/* Search */}
          <div className="mt-6 flex max-w-xl items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2">
            <Search className="h-4 w-4 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search — redact SSNs, bates multi-file, work offline…"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              aria-label="Search help center"
            />
          </div>
        </header>

        {/* Results */}
        {filtered ? (
          <section>
            <div className="mb-3 text-[11px] uppercase tracking-wider text-text-muted">
              {filtered.length} result{filtered.length === 1 ? "" : "s"} for “{q}”
            </div>
            <div className="space-y-4">
              {filtered.map((e) => (
                <Entry key={e.id} entry={e} />
              ))}
              {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed border-border bg-surface-2/40 p-6 text-[13px] text-text-muted">
                  Nothing matched. Try a different phrasing, or open{" "}
                  <Link to="/workspace" className="text-vault underline">
                    Counsel
                  </Link>{" "}
                  and ask the assistant directly.
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="space-y-12">
            {SECTIONS.map((s) => {
              const items = s.ids.map((id) => byId.get(id)).filter(Boolean) as KBEntry[];
              if (items.length === 0) return null;
              return (
                <section key={s.title}>
                  <h2 className="mb-4 font-display text-xl text-foreground">
                    {s.title}
                  </h2>
                  <div className="space-y-4">
                    {items.map((e) => (
                      <Entry key={e.id} entry={e} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <footer className="mt-16 flex items-center justify-between border-t border-border pt-6 text-[12px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3 text-vault" strokeWidth={2.5} />
            Everything documented here runs on your device.
          </span>
          <Link
            to="/workspace"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-vault hover:bg-vault/10"
          >
            Open the workspace
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </footer>
      </main>
    </AppShell>
  );
}

function Entry({ entry }: { entry: KBEntry }) {
  return (
    <article
      id={entry.id}
      className="rounded-xl border border-border bg-card/40 p-5"
    >
      <h3 className="font-display text-[17px] leading-snug text-foreground">
        {entry.questions[0]}
      </h3>
      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/90">
        {entry.answer}
      </p>
      {entry.steps && entry.steps.length > 0 && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-foreground/85">
          {entry.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        {entry.tool && (
          <Link
            to="/workspace"
            search={{ tool: entry.tool } as never}
            className="inline-flex items-center gap-1.5 rounded-md bg-vault px-2.5 py-1 text-[12px] font-medium text-vault-foreground hover:bg-vault/90"
          >
            Open {entry.toolLabel ?? entry.tool}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        {entry.questions.slice(1, 4).map((q) => (
          <span
            key={q}
            className="rounded-md border border-border bg-surface-1 px-1.5 py-0.5 text-[10.5px] text-text-muted"
          >
            also asked: “{q}”
          </span>
        ))}
      </div>
    </article>
  );
}

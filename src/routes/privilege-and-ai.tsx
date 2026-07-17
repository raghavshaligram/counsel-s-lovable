import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ArrowRight, Scale, ShieldCheck, ExternalLink, AlertTriangle } from "lucide-react";

const SEO_TITLE =
  "Privilege & AI — Why On-Device Matters After UK v Secretary of State and US v Heppner | PDFMacro";
const SEO_DESCRIPTION =
  "In 2026, UK and US courts began holding that uploading privileged material to public AI tools can waive privilege. PDFMacro runs entirely on your device — nothing is uploaded.";

export const Route = createFileRoute("/privilege-and-ai")({
  head: () => ({
    meta: [
      { title: SEO_TITLE },
      { name: "description", content: SEO_DESCRIPTION },
      { property: "og:title", content: SEO_TITLE },
      { property: "og:description", content: SEO_DESCRIPTION },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SEO_TITLE },
      { name: "twitter:description", content: SEO_DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "/privilege-and-ai" }],
  }),
  component: PrivilegeAndAiPage,
});

function PrivilegeAndAiPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-3xl px-5 md:px-8 py-16 md:py-24">
        <header className="mb-12">
          <div className="font-mono text-[11px] text-muted-foreground mb-4 flex items-center gap-2">
            <Scale className="h-3.5 w-3.5 text-vault" />
            / privilege &amp; AI · 2026 rulings
          </div>
          <h1
            className="font-display leading-[1.05] tracking-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}
          >
            Uploading privileged material to a public AI can waive privilege.
          </h1>
          <p className="mt-6 text-base md:text-lg text-muted-foreground leading-relaxed">
            Two 2026 rulings — one in the United Kingdom, one in the Southern
            District of New York — drew an explicit line between AI that runs
            in a closed environment under your control and public AI services
            that receive your data as a third party.
          </p>
        </header>

        <section className="space-y-10">
          <CaseCard
            jurisdiction="United Kingdom"
            citation="UK v Secretary of State (UK Upper Tribunal, 2026)"
            holding={
              <>
                The Upper Tribunal found that uploading documents to an{" "}
                <em>open</em>, publicly available AI tool breaches
                confidentiality and waives legal professional privilege. The
                Tribunal distinguished public tools from closed AI systems
                operating within a secure network under the firm&rsquo;s
                control — only the latter preserved confidentiality on the
                facts before it.
              </>
            }
          />
          <CaseCard
            jurisdiction="United States · S.D.N.Y."
            citation="United States v. Heppner, S.D.N.Y. (Feb. 17, 2026)"
            holding={
              <>
                The court held that exchanges with a publicly available AI
                platform are not protected by the attorney&ndash;client
                privilege or the work-product doctrine. It found there is no
                reasonable expectation of confidentiality when a user
                communicates substantive case material with a third-party AI
                platform.
              </>
            }
          />
        </section>

        <section className="mt-16 rounded-xl border border-border bg-surface-canvas/60 p-7 md:p-9">
          <div className="font-mono text-[11px] text-muted-foreground mb-4 flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-vault" />
            How PDFMacro answers this
          </div>
          <h2 className="font-display text-2xl md:text-3xl tracking-tight leading-tight">
            PDFMacro&rsquo;s AI runs entirely on your device.
          </h2>
          <p className="mt-5 text-muted-foreground leading-relaxed">
            Nothing is uploaded to any AI platform. Detection, summarisation,
            privilege review and entity recognition all execute in your
            browser via WebAssembly and on-device models. Your privileged
            material is never exposed to a third party — which is the precise
            risk the 2026 rulings identify.
          </p>
          <p className="mt-4 text-muted-foreground leading-relaxed">
            You can verify this yourself. Open DevTools, watch the Network
            panel, and run any tool on a real file — the JavaScript bundle
            loads and nothing else leaves the device.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to="/verify-privacy"
              className="inline-flex items-center gap-1.5 rounded-md bg-vault text-vault-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 transition"
            >
              Verify the network claim
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/security-architecture"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-card transition"
            >
              Security architecture
            </Link>
          </div>
        </section>

        <section className="mt-12">
          <h3 className="font-display text-lg tracking-tight mb-4">Sources</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <a
                href="https://www.bailii.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-vault hover:underline underline-offset-4"
              >
                BAILII — search for the Upper Tribunal opinion
                <ExternalLink className="h-3 w-3" />
              </a>
              <span className="ml-2 text-muted-foreground">
                (UK case law database)
              </span>
            </li>
            <li>
              <a
                href="https://www.courtlistener.com/?q=%22United+States+v.+Heppner%22&type=o"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-vault hover:underline underline-offset-4"
              >
                CourtListener — United States v. Heppner (S.D.N.Y.)
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          </ul>
        </section>

        <aside
          className="mt-12 rounded-md border border-border bg-card/40 p-5 flex gap-3"
          role="note"
          aria-label="Legal disclaimer"
        >
          <AlertTriangle className="h-4 w-4 text-vault shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">
              This is not legal advice.
            </span>{" "}
            Consult the rulings and your own professional judgment. The
            summaries above are provided for context; the operative text of
            each opinion controls, and privilege analysis is jurisdiction-
            and fact-specific.
          </p>
        </aside>
      </article>
    </AppShell>
  );
}

function CaseCard({
  jurisdiction,
  citation,
  holding,
}: {
  jurisdiction: string;
  citation: string;
  holding: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6 md:p-7">
      <div className="font-mono text-[11px] text-muted-foreground mb-2">
        {jurisdiction}
      </div>
      <h2 className="font-display text-xl md:text-2xl tracking-tight leading-snug">
        {citation}
      </h2>
      <p className="mt-4 text-[15px] text-muted-foreground leading-relaxed">
        {holding}
      </p>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Check, X, ArrowRight, Minus, WifiOff, Plane, Sparkles } from "lucide-react";

const SEO_TITLE =
  "CounselPDF — Private PDF Redaction & Bates Stamping for Lawyers";
const SEO_DESCRIPTION =
  "Redact, Bates-stamp, and review PDFs for privilege entirely on your device. Built for solo and small-firm lawyers. Nothing uploaded. Works offline.";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "How do I redact a PDF for court?",
    a: "Open the PDF in CounselPDF's Redact tool, let the on-device detector find names, Social Security numbers, account numbers and addresses, confirm each box, then export. CounselPDF burns the text out of the underlying content stream — it does not just paint a black rectangle over it — so the redacted version is safe to file under FRCP 5.2 and equivalent state rules.",
  },
  {
    q: "Is browser-based PDF redaction secure?",
    a: "Yes, when the tool is genuinely on-device. CounselPDF runs entirely in your browser using WebAssembly. Your documents are never uploaded to a server. You can verify this yourself: open DevTools, watch the Network panel, and run any tool on a real file — you will see the JavaScript bundle load and nothing else.",
  },
  {
    q: "Does CounselPDF work offline?",
    a: "Yes. After the first load the entire app is cached as a progressive web app. Disconnect from Wi-Fi and you can still redact, Bates-stamp, OCR, sanitize, sign and merge PDFs in an airplane, a courthouse, or any room without internet.",
  },
  {
    q: "How is CounselPDF different from Adobe Acrobat?",
    a: "Acrobat is a desktop install that processes documents locally but is priced and licensed for enterprises. Cloud redaction services upload your files to a server you do not control. CounselPDF runs in any browser on Windows, Mac or iPad, keeps every document on your device, and is priced for solo and small-firm lawyers — without giving up the legal-grade redaction, Bates and privilege-review workflows you need.",
  },
  {
    q: "Can I Bates stamp a whole discovery production at once?",
    a: "Yes. Drop a folder of PDFs into the Bates tool, set a prefix and starting number, and CounselPDF stamps every page across every file with consistent placement and padding in a single pass — without uploading anything.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: SEO_TITLE },
      { name: "description", content: SEO_DESCRIPTION },
      { name: "keywords", content: "redact PDF for court, Bates numbering, privileged documents, redaction software for law firms, strip metadata before filing, FRCP 5.2, discovery, on-device PDF editor" },
      { property: "og:title", content: SEO_TITLE },
      { property: "og:description", content: SEO_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SEO_TITLE },
      { name: "twitter:description", content: SEO_DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "CounselPDF",
          description: SEO_DESCRIPTION,
          applicationCategory: "BusinessApplication",
          applicationSubCategory: "Legal PDF Editor",
          operatingSystem: "Web",
          url: "/",
          offers: [
            {
              "@type": "Offer",
              name: "Free",
              price: "0",
              priceCurrency: "USD",
              description: "Free on-device PDF tools forever.",
            },
            {
              "@type": "Offer",
              name: "Solo — founder's rate",
              price: "17",
              priceCurrency: "USD",
              description: "Per month, billed annually. All Pro workflows for a solo practice.",
            },
            {
              "@type": "Offer",
              name: "Small-firm annual pass",
              price: "1490",
              priceCurrency: "USD",
              description: "Per year, up to 10 seats.",
            },
          ],
          featureList: [
            "On-device PDF redaction",
            "Bates numbering across files",
            "Privilege review",
            "Sanitize and strip metadata before filing",
            "OCR (make searchable)",
            "Works offline as a PWA",
          ],
          publisher: { "@type": "Organization", name: "CounselPDF" },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Re-arm on scroll: toggle is-visible on/off so the transition replays
    // every time an element re-enters the viewport. Honors reduced motion.
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
          } else if (!prefersReduced) {
            e.target.classList.remove("is-visible");
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <AppShell>
      <Keyframes />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-40" />
        <div className="relative mx-auto max-w-7xl px-5 md:px-8 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
            <div className="reveal">
              <div className="font-mono text-[11px] text-muted-foreground mb-6 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-vault animate-pulse" />
                For solo &amp; small-firm lawyers
              </div>
              <h1 className="text-sm md:text-base font-semibold tracking-tight text-vault mb-5">
                Private PDF Redaction &amp; Bates Stamping, Built for Lawyers
              </h1>
              <p
                className="font-display leading-[0.92] tracking-tight"
                style={{ fontSize: "clamp(2.75rem, 7.5vw, 6.25rem)" }}
                aria-hidden="true"
              >
                Documents you'd
                <br />
                <span className="italic text-vault">never upload.</span>
              </p>
              <p className="mt-8 max-w-md text-base md:text-lg text-muted-foreground leading-relaxed">
                Redact PDFs for court, Bates-stamp a discovery set, review for privilege and
                strip metadata before filing — entirely on your device. No Adobe required.
                Your files never upload, and CounselPDF keeps working offline.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  to="/workspace"
                  className="group inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
                >
                  Start free
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/auth"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-3 text-sm font-medium hover:bg-card transition"
                >
                  Sign in
                </Link>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                Free tools forever. Pro features unlock with a subscription — Windows, Mac, iPad, no install.
              </p>
            </div>

            <DemoCanvas />
          </div>
        </div>
      </section>

      {/* NO BYTES LEAVE — kept, with network monitor animation */}
      <section className="relative border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-24 md:py-36">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
            <div className="reveal">
              <div className="font-mono text-[11px] text-muted-foreground mb-8 flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-vault opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-vault" />
                </span>
                Network panel — observed live
              </div>
              <h2
                className="font-display leading-[0.95] tracking-tight"
                style={{ fontSize: "clamp(2.25rem, 7vw, 5.5rem)" }}
              >
                Redact privileged documents
                <br />
                <span className="italic">— on your device.</span>
              </h2>
              <div className="mt-10 space-y-5 max-w-lg text-muted-foreground leading-relaxed">
                <p>
                  Open DevTools <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-card border border-border">F12</kbd>. Open the Network panel.
                  Run any tool on the largest PDF you have. You'll see the JavaScript bundle load, and
                  exactly nothing else.
                </p>
                <p>
                  The only network call we make is a tiny auth check to verify your subscription is active.
                  Your documents stay on your device.
                </p>
                <Link
                  to="/verify-privacy"
                  className="inline-flex items-center gap-1.5 text-sm text-vault hover:underline underline-offset-4"
                >
                  How to verify it yourself
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
            <NetworkMonitor />
          </div>
        </div>
      </section>

      {/* OFFLINE */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-24 md:py-32">
          <div className="grid lg:grid-cols-[1fr_1.05fr] gap-12 lg:gap-16 items-center">
            <OfflinePanel />
            <div className="reveal">
              <div className="font-mono text-[11px] text-muted-foreground mb-8 flex items-center gap-2">
                <Plane className="h-3 w-3 text-vault" />
                Airplane · courthouse · anywhere
              </div>
              <h2
                className="font-display leading-[0.95] tracking-tight"
                style={{ fontSize: "clamp(2.25rem, 7vw, 5.5rem)" }}
              >
                Works offline
                <br />
                <span className="italic text-vault">— no installation.</span>
              </h2>
              <div className="mt-10 space-y-5 max-w-lg text-muted-foreground leading-relaxed">
                <p>
                  Once loaded, CounselPDF runs entirely in your browser with no connection. Redact,
                  Bates-stamp, OCR and sanitize on a plane, in a courthouse, or anywhere with no Wi-Fi —
                  your work never depends on a server being up.
                </p>
                <p className="text-foreground/90">
                  Disconnect and see for yourself. Working offline is the proof that nothing needed to
                  leave your device in the first place.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* LEGAL USE CASES */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-14 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ legal workflows</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Bates stamp, redact, and strip metadata before filing.
            </h2>
            <p className="mt-4 text-sm text-muted-foreground max-w-xl">
              Redaction software for law firms that handles the real workflows —
              production-ready discovery sets, FRCP 5.2-compliant redactions,
              privilege review, and sanitization before e-filing.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
            <UseCase
              kicker="Production"
              title="Redact a deposition for production."
              body="On-device detection of names, SSNs, account numbers and addresses. Confirm each box. Burn the text layer — not just black rectangles over it."
              to="/redact"
              cta="Open Redact"
            />
            <UseCase
              kicker="Discovery"
              title="Bates stamp a discovery set."
              body="Stamp a prefix and starting number across hundreds of files in one pass. Consistent placement, configurable padding, no round-trip."
              to="/bates"
              cta="Open Bates"
            />
            <UseCase
              kicker="Privilege"
              title="Review for privilege."
              body="Scan a production set for attorney names, common privilege markers and sensitive phrases — flagged for your eyes only, never logged."
              to="/privilege-scan"
              cta="Open Privilege Review"
            />
            <UseCase
              kicker="Filing"
              title="Sanitize before filing."
              body="Strip metadata, comments, hidden text and embedded files so the version you file is the version opposing counsel sees."
              to="/flatten"
              cta="Open Sanitize"
            />
          </div>
          <p className="mt-8 text-sm text-muted-foreground reveal">
            Also does: OCR (make searchable), merge / split / extract, compare versions, sign &amp; fill,
            watermark, protect / unlock, and yes — mail-merge and table extraction when you need them.
            <Link to="/workspace" className="ml-1 text-foreground hover:underline underline-offset-4">
              See all tools →
            </Link>
          </p>
        </div>
      </section>

      {/* PRIVILEGE & AI — 2026 rulings */}
      <section className="border-b border-border bg-surface-canvas/60" aria-labelledby="privilege-ai-heading">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-10 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-vault" />
              / privilege &amp; AI · 2026 rulings
            </div>
            <h2
              id="privilege-ai-heading"
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Uploading privileged material to a public AI can waive privilege.
            </h2>
            <p className="mt-4 text-sm md:text-base text-muted-foreground leading-relaxed">
              In 2026 courts on both sides of the Atlantic drew a line between
              AI that runs in a closed environment under your control and
              public AI services that receive your data as a third party.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 reveal">
            <div className="rounded-xl border border-border bg-card/40 p-6">
              <div className="font-mono text-[11px] text-muted-foreground mb-2">United Kingdom</div>
              <h3 className="font-display text-lg tracking-tight leading-snug">
                UK v Secretary of State (UK Upper Tribunal, 2026)
              </h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Uploading documents to an open, publicly available AI tool
                breaches confidentiality and waives legal professional
                privilege — distinguishing public tools from closed AI
                operating within a secure network.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-6">
              <div className="font-mono text-[11px] text-muted-foreground mb-2">United States · S.D.N.Y.</div>
              <h3 className="font-display text-lg tracking-tight leading-snug">
                United States v. Heppner (Feb. 17, 2026)
              </h3>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Exchanges with a publicly available AI platform are not
                protected by attorney&ndash;client privilege or work product;
                no reasonable expectation of confidentiality when
                communicating with a third-party AI platform.
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-xl border border-border bg-surface-canvas p-6 md:p-7 reveal">
            <p className="text-base md:text-lg leading-relaxed">
              <span className="font-semibold text-foreground">
                CounselPDF&rsquo;s AI runs entirely on your device.
              </span>{" "}
              <span className="text-muted-foreground">
                Nothing is uploaded to any AI platform — so your privileged
                material is never exposed to a third party.
              </span>
            </p>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm">
              <Link
                to="/privilege-and-ai"
                className="inline-flex items-center gap-1.5 text-vault hover:underline underline-offset-4 font-medium"
              >
                Read the full briefing &amp; sources
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/verify-privacy"
                className="inline-flex items-center gap-1.5 text-vault hover:underline underline-offset-4"
              >
                Verify the network claim
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <p className="mt-5 text-xs text-muted-foreground leading-relaxed">
              This is not legal advice; consult the rulings and your own
              professional judgment.
            </p>
          </div>
        </div>
      </section>



      {/* PRO — stop doing it by hand */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-12 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ pro</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Pro: stop doing it by hand.
            </h2>
            <p className="mt-4 text-sm md:text-base text-muted-foreground leading-relaxed">
              Free covers manual, single-file work. Pro is automatic, bulk, and AI —
              the parts that take hours when you do them one document at a time.
            </p>
          </div>

          <div className="space-y-10">
            {PRO_GROUPS.map((group) => (
              <div key={group.title} className="reveal">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-vault mb-4">
                  {group.title}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((it) => (
                    <ProFeatureCard key={it.name} name={it.name} body={it.body} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* COMPARISON — legal players */}
      <section className="border-b border-border bg-card/30">

        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-12 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ vs. the legal stack</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              CounselPDF vs Adobe, Kofax, and cloud redaction tools.
            </h2>
            <p className="mt-4 text-sm text-muted-foreground">
              We compare against the tools lawyers actually evaluate — not consumer PDF sites.
            </p>
          </div>
          <ComparisonTable />
        </div>
      </section>

      {/* PRICING — founder's rate */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-12 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ founder's rate</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Affordable for a solo practice.
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <PriceCard
              eyebrow="Solo — founder's rate"
              price="$17"
              cadence="/mo, billed annually"
              note="Locked for life. Limited time."
              features={[
                "Every tool, every workflow",
                "On-device — your files never upload",
                "Works offline after first load",
                "Windows, Mac, iPad — no install",
              ]}
              cta="Claim founder's rate"
              highlight
            />
            <PriceCard
              eyebrow="Small-firm annual pass"
              price="$1,490"
              cadence="/year · up to 10 seats"
              note="One invoice. One renewal. No per-seat seat-counting."
              features={[
                "Everything in Solo",
                "Shared firm billing",
                "Priority email support",
                "Onboarding for paralegals",
              ]}
              cta="Get the firm pass"
            />
          </div>
        </div>
      </section>

      {/* FAQ — answers the questions lawyers actually search for */}
      <section className="border-b border-border" aria-labelledby="faq-heading">
        <div className="mx-auto max-w-4xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-10 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ frequently asked</div>
            <h2
              id="faq-heading"
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Questions lawyers ask before switching.
            </h2>
          </div>
          <dl className="divide-y divide-border border border-border rounded-xl overflow-hidden">
            {FAQ.map((item) => (
              <div key={item.q} className="p-6 md:p-7 reveal">
                <dt>
                  <h3 className="text-base md:text-lg font-semibold text-foreground tracking-tight">
                    {item.q}
                  </h3>
                </dt>
                <dd className="mt-3 text-sm md:text-[15px] text-muted-foreground leading-relaxed">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>



      {/* CTA — bus line kept */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative mx-auto max-w-3xl px-5 md:px-8 py-24 md:py-32 text-center reveal">
          <h2
            className="font-display leading-[1.02] tracking-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
          >
            Stop uploading documents you wouldn't print and leave on a bus.
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/workspace"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/auth"
              className="inline-flex items-center gap-2 rounded-md border border-border px-6 py-3 text-sm font-medium hover:bg-card"
            >
              Sign in
            </Link>
          </div>
          <div className="mt-10 flex justify-center gap-6 text-sm">
            <Link to="/verify-privacy" className="text-vault hover:underline underline-offset-4 font-medium">
              Verify our privacy →
            </Link>
            <Link to="/security-architecture" className="text-vault hover:underline underline-offset-4 font-medium">
              Security architecture →
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

/* ——— Demo canvas (kept, with animated redaction loop) ——— */

function DemoCanvas() {
  return (
    <div className="relative">
      <div className="absolute -top-3 -left-3 right-12 h-8 rounded-md bg-card/80 backdrop-blur border border-border flex items-center px-3 gap-2 text-[10px] font-mono text-muted-foreground z-10">
        <span className="h-2 w-2 rounded-full bg-evidence" />
        deposition_johnson_v_meridian.pdf
        <span className="ml-auto text-vault">sha256: 4f2a9c…</span>
      </div>

      <div
        role="img"
        aria-label="Redacted deposition transcript with burned text layer — names, social security number, account number and email all blacked out."
        className="relative rounded-lg border border-border bg-[#f7f3ea] text-[#1a1a1a] aspect-[8.5/11] max-h-[560px] mx-auto shadow-[var(--shadow-float)] overflow-hidden"
      >
        <div className="p-8 text-[10px] leading-[1.6] font-mono space-y-2">
          <div className="text-center font-display text-base text-black mb-4">
            DEPOSITION TRANSCRIPT — vol. III
          </div>
          <p>Q. Please state your full name for the record.</p>
          <p>
            A. My name is{" "}
            <RedactStamp delay={0.6} width="7rem">Marcus T. Johnson</RedactStamp>, residing at{" "}
            <RedactStamp delay={1.2} width="10rem">418 Linden Ave, Apt 6B</RedactStamp>.
          </p>
          <p>Q. And your social security number, for our records?</p>
          <p>
            A. It's <RedactStamp delay={1.8} width="6rem">123-45-6789</RedactStamp>.
          </p>
          <p>Q. Account at Meridian — number on file?</p>
          <p>
            A. The routing account is <RedactStamp delay={2.4} width="8rem">4521-9087-3344</RedactStamp>{" "}
            and I can be reached at <RedactStamp delay={3.0} width="9rem">m.johnson@privatemail.io</RedactStamp>.
          </p>
          <p className="opacity-60">
            Q. Thank you. Let the record reflect counsel for both parties have stipulated…
          </p>
          <p className="opacity-40">
            Q. Mr. Johnson, returning to the exhibit marked Plaintiff's 14 — can you describe the
            document in your own words for the jury?
          </p>
          <p className="opacity-30">A. It appears to be a wire transfer confirmation dated…</p>
        </div>

        <div
          className="absolute inset-x-0 top-0 h-24 pointer-events-none opacity-0 motion-safe:animate-[uv-sweep_4s_ease-in-out_infinite]"
          style={{
            background:
              "linear-gradient(180deg, transparent, color-mix(in oklab, var(--vault) 25%, transparent), transparent)",
          }}
        />
      </div>

      <div className="absolute -bottom-4 left-8 right-8 rounded-md bg-card/95 backdrop-blur border border-border shadow-[var(--shadow-float)] flex items-center px-3 py-2 gap-2 text-[10px] font-mono">
        <span className="text-vault">●</span>
        <span className="text-foreground">redacted · 5 detections</span>
        <span className="text-muted-foreground">· 2 PII · 1 SSN · 2 accounts</span>
        <span className="ml-auto px-2 py-0.5 rounded-sm bg-evidence/15 text-evidence">
          Burn text layer
        </span>
      </div>
    </div>
  );
}

function RedactStamp({
  children,
  delay = 0,
  width,
}: {
  children: React.ReactNode;
  delay?: number;
  width: string;
}) {
  return (
    <span className="relative inline-block align-middle" style={{ width, height: "1.1em" }}>
      <span className="invisible">{children}</span>
      <span
        className="absolute inset-0 rounded-[2px] motion-safe:animate-[burn-loop_4s_ease-in-out_infinite]"
        style={{
          background:
            "repeating-linear-gradient(45deg, #0a0a0a 0 4px, #1a1a1a 4px 8px)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.6), 0 2px 6px -2px rgba(0,0,0,0.5)",
          animationDelay: `${delay}s`,
        }}
      />
    </span>
  );
}

/* ——— useInView hook ——— */

function useInView<T extends HTMLElement>(once = false) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setInView(true);
            if (once) io.unobserve(e.target);
          } else if (!once) {
            setInView(false);
          }
        });
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);
  return [ref, inView] as const;
}

/* ——— Network monitor mock ——— */

/* ——— Offline panel ——— */

function OfflinePanel() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const tools = ["Redact", "Bates stamp", "OCR", "Sanitize"];
  return (
    <div
      ref={ref}
      className="reveal rounded-lg border border-border bg-background shadow-[var(--shadow-float)] overflow-hidden"
    >
      {/* Browser-style chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/60 text-[11px] font-mono text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-evidence" />
        <span className="h-2 w-2 rounded-full bg-vault/60" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        <span className="ml-2 truncate">counselpdf.app/workspace</span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border transition-colors duration-500 ${
            inView
              ? "border-vault/30 bg-vault/10 text-vault"
              : "border-border text-muted-foreground"
          }`}
        >
          <WifiOff className="h-3 w-3" strokeWidth={2.25} />
          {inView ? "Offline — fully functional" : "Online"}
        </span>
      </div>

      {/* Body */}
      <div className="p-6 md:p-8">
        <div className="font-mono text-[10px] text-muted-foreground mb-4">/ on-device task queue</div>
        <ul className="space-y-3">
          {tools.map((t, i) => (
            <li
              key={t}
              className="flex items-center gap-3 text-sm transition-all duration-500 ease-out"
              style={{
                opacity: inView ? 1 : 0.25,
                transform: inView ? "translateX(0)" : "translateX(-6px)",
                transitionDelay: `${i * 220 + 350}ms`,
              }}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${
                  inView ? "border-vault/40 bg-vault/10" : "border-border"
                }`}
              >
                <Check
                  className="h-3.5 w-3.5 text-vault"
                  strokeWidth={2.75}
                  style={{
                    opacity: inView ? 1 : 0,
                    transition: "opacity 300ms ease-out",
                    transitionDelay: `${i * 220 + 500}ms`,
                  }}
                />
              </span>
              <span className="text-foreground">{t}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                done · on-device
              </span>
            </li>
          ))}
        </ul>

        <div
          className="mt-6 pt-5 border-t border-border flex items-center justify-between text-[11px] font-mono transition-opacity duration-500"
          style={{ opacity: inView ? 1 : 0, transitionDelay: "1300ms" }}
        >
          <span className="text-muted-foreground">Network requests during work</span>
          <span className="font-semibold text-vault tabular-nums">0</span>
        </div>
      </div>
    </div>
  );
}

function NetworkMonitor() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const rows = [
    { name: "app.bundle.js", type: "script", size: "812 KB", status: "200" },
    { name: "ocr.worker.wasm", type: "wasm", size: "1.4 MB", status: "200" },
    { name: "pdfium.js", type: "script", size: "624 KB", status: "200" },
    { name: "/api/subscription/verify", type: "fetch", size: "182 B", status: "200" },
  ];

  return (
    <div
      ref={ref}
      className="reveal rounded-lg border border-border bg-background shadow-[var(--shadow-float)] overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/60 text-[11px] font-mono text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-evidence" />
        <span className="h-2 w-2 rounded-full bg-vault/60" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        <span className="ml-2">DevTools — Network</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full bg-evidence ${inView ? "motion-safe:animate-pulse" : ""}`}
          />
          Recording
        </span>
      </div>

      {/* Processing chip */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 text-[11px] font-mono">
        <span className="text-muted-foreground">file:</span>
        <span className="text-foreground truncate">production_set_vol3.pdf</span>
        <span
          className={`ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-vault/10 text-vault transition-opacity duration-500 ${
            inView ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-vault motion-safe:animate-pulse" />
          processing on device
        </span>
      </div>

      <div className="px-4 py-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[11px] font-mono text-muted-foreground border-b border-border">
        <span>Name</span><span>Type</span><span>Size</span><span>Status</span>
      </div>
      <div className="px-4 py-2 text-[12px] font-mono">
        {rows.map((r, i) => (
          <div
            key={r.name}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 py-1.5 transition-all duration-500 ease-out"
            style={{
              opacity: inView ? 1 : 0,
              transform: inView ? "translateY(0)" : "translateY(4px)",
              transitionDelay: `${i * 300 + 250}ms`,
            }}
          >
            <span className="text-foreground truncate">{r.name}</span>
            <span className="text-muted-foreground">{r.type}</span>
            <span className="text-muted-foreground">{r.size}</span>
            <span className="text-vault">{r.status}</span>
          </div>
        ))}

        <div
          className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px] transition-opacity duration-500"
          style={{ opacity: inView ? 1 : 0, transitionDelay: "1700ms" }}
        >
          <span className="text-muted-foreground">Uploaded from your documents</span>
          <span
            className={`font-semibold text-vault tabular-nums px-2 py-0.5 rounded-sm bg-vault/5 ${
              inView ? "motion-safe:animate-[pulse-zero_2s_ease-in-out_1.7s_2]" : ""
            }`}
          >
            0 bytes
          </span>
        </div>
      </div>
    </div>
  );
}

/* ——— Comparison table ——— */

type MarkValue = true | false | "partial" | { note: string };

const PRO_GROUPS: Array<{ title: string; items: Array<{ name: string; body: string }> }> = [
  {
    title: "Redaction & privilege",
    items: [
      { name: "AI sensitive-data detection", body: "Auto-find SSNs, accounts, cards, names, and privilege markers across hundreds of pages — on your device." },
      { name: "Pattern & bulk redaction", body: "Redact every instance of a name or term in one pass." },
      { name: "Privilege review", body: "Surface attorney names, privilege markers, and confidential phrases for review before disclosure." },
    ],
  },
  {
    title: "Discovery & production",
    items: [
      { name: "Multi-file Bates", body: "One continuous Bates sequence across an entire discovery set." },
      { name: "Exhibit Binder", body: "Court-ready bundle with hyperlinked ToC, labeled tabs, and continuous numbering." },
      { name: "Citation Hyperlinker", body: "Turn legal citations into clickable links to the public case text." },
      { name: "Court e-filing optimization", body: "Compress massive filings under court upload caps without losing readability." },
    ],
  },
  {
    title: "Automation & AI",
    items: [
      { name: "Workflows & automation", body: "Chain OCR → detect → redact → Bates → sanitize into one-click discovery prep." },
      { name: "Batch processing", body: "Run any workflow across a whole folder at once." },
      { name: "AI fact chronology", body: "Extract dates and key actors into a timeline — privately." },
      { name: "Private AI assist", body: "Summarize a deposition or find every mention of a term — on docs you could never upload to cloud AI." },
    ],
  },
  {
    title: "Integrity",
    items: [
      { name: "Document hashing", body: "SHA-256 fingerprints to prove evidence hasn't changed since a given date." },
    ],
  },
];

const COMP_ROWS: Array<{ label: string; vals: [MarkValue, MarkValue, MarkValue, MarkValue]; emphasize?: boolean }> = [
  { label: "Built for legal workflows", vals: [true, false, false, false] },
  { label: "Documents stay on device", vals: [true, false, true, false], emphasize: true },
  { label: "AI runs locally, not cloud", vals: [true, false, false, false], emphasize: true },
  { label: "AI sensitive-data detection", vals: [true, { note: "cloud add-on" }, false, { note: "cloud" }] },
  { label: "Permanent verifiable redaction (incl. metadata)", vals: [true, true, true, "partial"] },
  { label: "Scanned-doc pixel redaction", vals: [true, true, "partial", "partial"] },
  { label: "Multi-file Bates", vals: [true, true, true, "partial"] },
  { label: "Exhibit binder w/ hyperlinked ToC", vals: [true, "partial", "partial", false] },
  { label: "One-click legal workflows", vals: [true, false, false, "partial"] },
  { label: "Private AI assist (on-device)", vals: [true, false, false, false] },
  { label: "Works offline", vals: [true, "partial", true, false] },
  { label: "No installation, any device", vals: [true, false, false, true] },
  { label: "Affordable for solo / small firm", vals: [true, "partial", "partial", false] },
];

function ProFeatureCard({ name, body }: { name: string; body: string }) {
  return (
    <div className="group relative rounded-xl border border-border bg-background p-5 hover:border-vault/40 hover:bg-card transition-colors h-full flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground leading-snug">
          {name}
        </h3>
        <span
          className="inline-flex items-center gap-1 rounded-sm border border-vault/30 bg-vault/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-[0.14em] text-vault shrink-0"
          aria-label="Pro feature"
        >
          <Sparkles className="h-2.5 w-2.5" />
          Pro
        </span>
      </div>
      <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}



function ComparisonTable() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="overflow-x-auto rounded-xl border border-border bg-background/40 reveal"
    >
      <table className="w-full text-sm min-w-[720px]">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left p-4 font-medium w-[34%]">Capability</th>
            <th className="p-4 text-center font-semibold text-vault bg-vault/[0.06] border-x border-vault/20">
              CounselPDF
            </th>
            <th className="p-4 text-center font-medium">Adobe Acrobat</th>
            <th className="p-4 text-center font-medium">Kofax Power PDF</th>
            <th className="p-4 text-center font-medium">Cloud redaction (e.g. Redactable)</th>
          </tr>
        </thead>
        <tbody>
          {COMP_ROWS.map((row, i) => (
            <tr key={row.label} className="border-t border-border">
              <td className="p-4 text-foreground">{row.label}</td>
              {row.vals.map((v, j) => (
                <td
                  key={j}
                  className={`p-4 text-center transition-all duration-400 ease-out ${
                    j === 0 ? "bg-vault/[0.06] border-x border-vault/20" : ""
                  }`}
                  style={{
                    opacity: inView ? 1 : 0,
                    transform: inView ? "scale(1)" : "scale(0.85)",
                    transitionDelay: `${i * 90 + j * 60 + 150}ms`,
                  }}
                >
                  <MarkIcon v={v} highlight={j === 0} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkIcon({ v, highlight }: { v: MarkValue; highlight?: boolean }) {
  if (v === true)
    return (
      <Check
        className={`h-5 w-5 mx-auto ${highlight ? "text-vault" : "text-foreground/80"}`}
        strokeWidth={highlight ? 2.5 : 2}
      />
    );
  if (v === false) return <X className="h-5 w-5 text-muted-foreground/40 mx-auto" />;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
      <Minus className="h-3.5 w-3.5" />
      partial
    </span>
  );
}

/* ——— Use case card ——— */

function UseCase({
  kicker, title, body, to, cta,
}: {
  kicker: string; title: string; body: string; to: string; cta: string;
}) {
  return (
    <Link
      to={to}
      className="group relative bg-background p-8 flex flex-col hover:bg-card transition-colors"
    >
      <div className="font-mono text-[11px] text-vault mb-6">{kicker}</div>
      <h3 className="font-display text-2xl md:text-[26px] leading-tight tracking-tight mb-3">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
      <div className="mt-6 inline-flex items-center gap-1.5 text-sm text-foreground">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

/* ——— Pricing card ——— */

function PriceCard({
  eyebrow, price, cadence, note, features, cta, highlight,
}: {
  eyebrow: string; price: string; cadence: string; note: string;
  features: string[]; cta: string; highlight?: boolean;
}) {
  return (
    <div
      className={`reveal rounded-xl border p-7 flex flex-col ${
        highlight ? "border-vault/50 bg-vault/[0.04] shadow-[var(--shadow-float)]" : "border-border bg-background"
      }`}
    >
      <div className="font-mono text-[11px] text-vault mb-4">{eyebrow}</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl tracking-tight">{price}</span>
        <span className="text-sm text-muted-foreground">{cadence}</span>
      </div>
      <p className="mt-2 text-sm text-foreground/80">{note}</p>
      <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground flex-1">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="h-4 w-4 text-vault flex-shrink-0 mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        to="/pricing"
        className={`mt-7 inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold transition ${
          highlight
            ? "bg-vault text-vault-foreground hover:opacity-90"
            : "border border-border hover:bg-card"
        }`}
      >
        {cta} <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}


/* ——— Keyframes + reveal-on-scroll ——— */

function Keyframes() {
  return (
    <style>{`
      @keyframes uv-sweep {
        0% { transform: translateY(-100%); opacity: 0; }
        15% { opacity: 1; }
        80% { opacity: 1; }
        100% { transform: translateY(560px); opacity: 0; }
      }
      @keyframes burn-loop {
        0%, 8% { transform: scaleX(0); transform-origin: left center; opacity: 0; }
        18% { transform: scaleX(1); opacity: 1; }
        88% { transform: scaleX(1); opacity: 1; }
        96%, 100% { transform: scaleX(1); opacity: 0; }
      }
      @keyframes pulse-zero {
        0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--vault) 35%, transparent); }
        50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--vault) 0%, transparent); }
      }
      .reveal { opacity: 0; transform: translateY(8px); transition: opacity 600ms ease-out, transform 600ms ease-out; }
      .reveal.is-visible { opacity: 1; transform: none; }
      @media (prefers-reduced-motion: reduce) {
        .reveal { opacity: 1; transform: none; transition: none; }
      }
    `}</style>
  );
}

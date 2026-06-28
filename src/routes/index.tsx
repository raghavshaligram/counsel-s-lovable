import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Check, X, ArrowRight, Minus } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaultPDF — On-device PDF tools for solo & small-firm lawyers" },
      {
        name: "description",
        content:
          "Redact, Bates-stamp, privilege-review and sanitize PDFs without uploading. Your documents never leave your device — you sign in only to verify your subscription.",
      },
      { property: "og:title", content: "VaultPDF — Legal PDF tools that stay on your device" },
      {
        property: "og:description",
        content:
          "Built for solo and small-firm lawyers. Redaction, Bates, privilege review and sanitize — all on-device. Founder's rate available.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "VaultPDF — Legal PDF tools that stay on your device" },
      {
        name: "twitter:description",
        content: "Redact, Bates, privilege review, sanitize. On-device. For solo and small-firm lawyers.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Landing,
});

function Landing() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
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
              <div className="font-mono text-[11px] text-muted-foreground mb-8 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-vault animate-pulse" />
                For solo &amp; small-firm lawyers
              </div>
              <h1
                className="font-display leading-[0.92] tracking-tight"
                style={{ fontSize: "clamp(2.75rem, 7.5vw, 6.25rem)" }}
              >
                Documents you'd
                <br />
                <span className="italic text-vault">never upload.</span>
              </h1>
              <p className="mt-8 max-w-md text-base md:text-lg text-muted-foreground leading-relaxed">
                Redact, Bates-stamp, privilege-review and sanitize PDFs entirely on your device.
                You sign in only to verify your subscription — your files are never uploaded.
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
                  to="/pricing"
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
                No bytes leave
                <br />
                <span className="italic">this tab.</span>
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

      {/* LEGAL USE CASES */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-14 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ legal workflows</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Built around the work you actually do.
            </h2>
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

      {/* COMPARISON — legal players */}
      <section className="border-b border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-12 reveal">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ vs. the legal stack</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              The honest comparison.
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
              price="Contact"
              cadence="up to 10 seats"
              note="One invoice. One renewal. No per-seat seat-counting."
              features={[
                "Everything in Solo",
                "Shared firm billing",
                "Priority email support",
                "Onboarding for paralegals",
              ]}
              cta="Talk to us"
            />
          </div>
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
              to="/pricing"
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

      <div className="relative rounded-lg border border-border bg-[#f7f3ea] text-[#1a1a1a] aspect-[8.5/11] max-h-[560px] mx-auto shadow-[var(--shadow-float)] overflow-hidden">
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

/* ——— Network monitor mock ——— */

function NetworkMonitor() {
  const rows: Array<{ name: string; type: string; size: string; status: string; muted?: boolean }> = [
    { name: "app.bundle.js", type: "script", size: "812 KB", status: "200" },
    { name: "ocr.worker.wasm", type: "wasm", size: "1.4 MB", status: "200" },
    { name: "pdfium.js", type: "script", size: "624 KB", status: "200" },
    { name: "/api/subscription/verify", type: "fetch", size: "182 B", status: "200" },
  ];
  return (
    <div className="reveal rounded-lg border border-border bg-background shadow-[var(--shadow-float)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card/60 text-[11px] font-mono text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-evidence" />
        <span className="h-2 w-2 rounded-full bg-vault/60" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        <span className="ml-2">DevTools — Network</span>
        <span className="ml-auto">Filter: all · Recording</span>
      </div>
      <div className="px-4 py-3 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[11px] font-mono text-muted-foreground border-b border-border">
        <span>Name</span><span>Type</span><span>Size</span><span>Status</span>
      </div>
      <div className="px-4 py-2 text-[12px] font-mono">
        {rows.map((r, i) => (
          <div
            key={r.name}
            className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 py-1.5 opacity-0 motion-safe:animate-[fade-in_400ms_ease-out_forwards]"
            style={{ animationDelay: `${i * 350 + 200}ms` }}
          >
            <span className="text-foreground truncate">{r.name}</span>
            <span className="text-muted-foreground">{r.type}</span>
            <span className="text-muted-foreground">{r.size}</span>
            <span className="text-vault">{r.status}</span>
          </div>
        ))}
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Uploaded from your documents</span>
          <span className="font-semibold text-vault">0 bytes</span>
        </div>
      </div>
    </div>
  );
}

/* ——— Comparison table ——— */

type Mark = true | false | "partial";

const COMP_ROWS: Array<{ label: string; vals: [Mark, Mark, Mark, Mark] }> = [
  { label: "Built for legal workflows", vals: [true, "partial", "partial", true] },
  { label: "Documents stay on your device", vals: [true, "partial", "partial", false] },
  { label: "AI redaction runs locally (not cloud)", vals: [true, false, false, false] },
  { label: "Works offline", vals: [true, true, true, false] },
  { label: "No installation — any device", vals: [true, false, false, true] },
  { label: "Bates stamp across files", vals: [true, true, true, false] },
  { label: "Affordable for solo / small firm", vals: [true, false, false, "partial"] },
];

function ComparisonTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background/40 reveal">
      <table className="w-full text-sm min-w-[720px]">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left p-4 font-medium w-[34%]">Capability</th>
            <th className="p-4 text-center font-semibold text-vault">VaultPDF</th>
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
                  className={`p-4 text-center ${j === 0 ? "bg-vault/5" : ""} opacity-0 motion-safe:animate-[fade-in_350ms_ease-out_forwards]`}
                  style={{ animationDelay: `${i * 90 + j * 50}ms` }}
                >
                  <Mark v={v} highlight={j === 0} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Mark({ v, highlight }: { v: Mark; highlight?: boolean }) {
  if (v === true)
    return <Check className={`h-4 w-4 mx-auto ${highlight ? "text-vault" : "text-foreground/80"}`} />;
  if (v === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
  return <Minus className="h-4 w-4 text-muted-foreground/60 mx-auto" />;
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
      .reveal { opacity: 0; transform: translateY(8px); transition: opacity 600ms ease-out, transform 600ms ease-out; }
      .reveal.is-visible { opacity: 1; transform: none; }
      @media (prefers-reduced-motion: reduce) {
        .reveal { opacity: 1; transform: none; transition: none; }
      }
    `}</style>
  );
}

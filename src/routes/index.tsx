import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { WaitlistForm } from "@/components/waitlist-form";
import {
  ShieldCheck,
  FileStack,
  Table2,
  Check,
  X,
  ArrowRight,
  ArrowUpRight,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaultPDF — Redact, sign, extract. Without uploading a thing." },
      {
        name: "description",
        content:
          "A serious PDF toolkit that runs entirely in your browser tab. Redact PII, mail-merge contracts, extract tables — your file never leaves the device.",
      },
      { property: "og:title", content: "VaultPDF — PDFs that never leave your browser" },
      {
        property: "og:description",
        content:
          "Redact, sign, mail-merge, and extract — 100% client-side. No upload endpoint. Pay once, use forever.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "VaultPDF — PDFs that never leave your browser" },
      {
        name: "twitter:description",
        content: "Serious PDF tools. Zero uploads. Built for documents you'd never trust to a SaaS.",
      },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Landing,
});

function Landing() {
  return (
    <AppShell>
      {/* HERO — split screen */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-40" />
        <div className="relative mx-auto max-w-7xl px-5 md:px-8 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="grid lg:grid-cols-[1.05fr_1fr] gap-12 lg:gap-16 items-center">
            {/* Left — statement */}
            <div>
              <div className="font-mono text-[11px] text-muted-foreground mb-8 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-vault animate-pulse" />
                v1.4 · client-side build
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
                A serious PDF toolkit that runs entirely inside your browser tab.
                No upload endpoint. No account. No trust required.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-5">
                <Link
                  to="/redact"
                  className="group inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
                >
                  Open the redactor
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  to="/pricing"
                  className="text-sm text-foreground/80 hover:text-foreground underline-offset-4 hover:underline"
                >
                  Lifetime — $29
                </Link>
              </div>
              <p className="mt-5 text-sm text-muted-foreground">
                Works on any device — Windows, Mac, iPad — with no installation. Just open it in your browser.
              </p>
            </div>

            {/* Right — mock canvas with animated redaction */}
            <DemoCanvas />
          </div>
        </div>
      </section>

      {/* STATEMENT — no bytes leave this tab */}
      <section className="relative border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-28 md:py-40">
          <div className="font-mono text-[11px] text-muted-foreground mb-8 flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-vault opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-vault" />
            </span>
            Network panel — observed live
          </div>
          <h2
            className="font-display leading-[0.95] tracking-tight"
            style={{ fontSize: "clamp(2.5rem, 8vw, 6.5rem)" }}
          >
            No bytes leave
            <br />
            <span className="italic">this tab.</span>
          </h2>
          <div className="mt-12 grid md:grid-cols-2 gap-8 max-w-3xl">
            <p className="text-muted-foreground leading-relaxed">
              Every other PDF tool ships your file to a server and asks you to trust
              the privacy policy. We can't ask for that trust — we removed the option.
              There is no <code className="font-mono text-vault">POST /upload</code> in this app.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Open DevTools. Open the Network panel. Run any tool on the largest PDF
              you have. You'll see XHR for the JavaScript bundle and exactly nothing else.
            </p>
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ built for</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              Work nobody else will touch.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
            <UseCase
              kicker="Legal"
              title="Redact a deposition."
              body="Detect names, SSNs, account numbers, addresses with an on-device model. Confirm each box. Burn the text layer — not just black rectangles over it."
              to="/redact"
              cta="Try Smart Redact"
            />
            <UseCase
              kicker="Operations"
              title="Mail-merge 500 NDAs."
              body="Drop a PDF template + a CSV. Get a zip of named, filled, ready-to-send PDFs. Nothing batches faster when nothing has to round-trip."
              to="/merge"
              cta="Try Mail Merge"
            />
            <UseCase
              kicker="Finance"
              title="Tables from statements."
              body="Pull layout-aware tables from bank statements, invoices, and research PDFs. OCR fallback for scans. Export XLSX, CSV, or JSON."
              to="/extract"
              cta="Try Table Extract"
            />
          </div>
          <div className="mt-10 flex justify-end">
            <Link
              to="/tools"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition group"
            >
              All 18 tools
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </section>

      {/* COMPARISON — trimmed */}
      <section className="border-b border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="max-w-2xl mb-12">
            <div className="font-mono text-[11px] text-muted-foreground mb-4">/ vs. the alternatives</div>
            <h2
              className="font-display leading-[1] tracking-tight"
              style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
            >
              The honest comparison.
            </h2>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border bg-background/40">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left p-4 font-medium">Capability</th>
                  <Th highlight>VaultPDF</Th>
                  <Th>Adobe</Th>
                  <Th>Smallpdf</Th>
                  <Th>iLovePDF</Th>
                </tr>
              </thead>
              <tbody>
                <Row label="File stays on device" v={true} a={true} s={false} i={false} />
                <Row label="AI PII redaction" v={true} a="add-on" s={false} i={false} />
                <Row label="Batch CSV mail merge" v={true} a={false} s={false} i={false} />
                <Row label="Works offline" v={true} a={true} s={false} i={false} />
                <Row label="Pay once, use forever" v={true} a={false} s={false} i={false} />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: "var(--gradient-glow)" }} />
        <div className="relative mx-auto max-w-3xl px-5 md:px-8 py-24 md:py-32 text-center">
          <h2
            className="font-display leading-[1.02] tracking-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}
          >
            Stop uploading documents you wouldn't print and leave on a bus.
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/redact"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Open Smart Redact <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14 max-w-md mx-auto">
            <p className="font-mono text-[11px] text-muted-foreground mb-3">
              one email when the AppSumo deal goes live
            </p>
            <WaitlistForm source="home" placeholder="you@firm.com" />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

/* ——— Demo canvas mock ——— */

function DemoCanvas() {
  return (
    <div className="relative">
      {/* Floating chrome */}
      <div className="absolute -top-3 -left-3 right-12 h-8 rounded-md bg-card/80 backdrop-blur border border-border flex items-center px-3 gap-2 text-[10px] font-mono text-muted-foreground z-10">
        <span className="h-2 w-2 rounded-full bg-evidence" />
        deposition_johnson_v_meridian.pdf
        <span className="ml-auto text-vault">sha256: 4f2a9c…</span>
      </div>

      {/* Page */}
      <div className="relative rounded-lg border border-border bg-[#f7f3ea] text-[#1a1a1a] aspect-[8.5/11] max-h-[560px] mx-auto shadow-[var(--shadow-float)] overflow-hidden">
        <div className="p-8 text-[10px] leading-[1.6] font-mono space-y-2">
          <div className="text-center font-display text-base text-black mb-4">
            DEPOSITION TRANSCRIPT — vol. III
          </div>
          <p>
            Q. Please state your full name for the record.
          </p>
          <p className="relative">
            A. My name is{" "}
            <RedactStamp delay={0.6} width="7rem">Marcus T. Johnson</RedactStamp>
            , residing at{" "}
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
          <p className="opacity-30">
            A. It appears to be a wire transfer confirmation dated…
          </p>
        </div>

        {/* UV sweep */}
        <div
          className="absolute inset-x-0 top-0 h-24 pointer-events-none opacity-0"
          style={{
            background: "linear-gradient(180deg, transparent, color-mix(in oklab, var(--vault) 25%, transparent), transparent)",
            animation: "uv-sweep 3.6s ease-in-out infinite",
          }}
        />
      </div>

      {/* Floating tool bar */}
      <div className="absolute -bottom-4 left-8 right-8 rounded-md bg-card/95 backdrop-blur border border-border shadow-[var(--shadow-float)] flex items-center px-3 py-2 gap-2 text-[10px] font-mono">
        <span className="text-vault">●</span>
        <span className="text-foreground">5 detections</span>
        <span className="text-muted-foreground">· 2 PII · 1 SSN · 2 accounts</span>
        <span className="ml-auto px-2 py-0.5 rounded-sm bg-evidence/15 text-evidence">
          Burn text layer
        </span>
      </div>

      <style>{`
        @keyframes uv-sweep {
          0% { transform: translateY(-100%); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translateY(560px); opacity: 0; }
        }
        @keyframes stamp-in {
          0% { transform: scale(1.15); opacity: 0; }
          60% { transform: scale(0.98); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
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
        className="absolute inset-0 rounded-[2px]"
        style={{
          background:
            "repeating-linear-gradient(45deg, #0a0a0a 0 4px, #1a1a1a 4px 8px)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.6), 0 2px 6px -2px rgba(0,0,0,0.5)",
          animation: `stamp-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}s both`,
        }}
      />
    </span>
  );
}

/* ——— presentational helpers ——— */

function UseCase({
  kicker,
  title,
  body,
  to,
  cta,
}: {
  kicker: string;
  title: string;
  body: string;
  to: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="group relative bg-background p-8 flex flex-col hover:bg-card transition-colors"
    >
      <div className="font-mono text-[11px] text-vault mb-6">{kicker}</div>
      <h3 className="font-display text-2xl md:text-[28px] leading-tight tracking-tight mb-4">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
      <div className="mt-8 inline-flex items-center gap-1.5 text-sm text-foreground">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

function Th({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <th className={`p-4 text-center font-medium ${highlight ? "text-vault" : ""}`}>{children}</th>
  );
}

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="h-4 w-4 text-vault mx-auto" />;
  if (v === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
  return <span className="text-xs text-muted-foreground">{v}</span>;
}

function Row({
  label,
  v,
  a,
  s,
  i,
}: {
  label: string;
  v: boolean | string;
  a: boolean | string;
  s: boolean | string;
  i: boolean | string;
}) {
  return (
    <tr className="border-t border-border">
      <td className="p-4 text-foreground">{label}</td>
      <td className="p-4 text-center bg-vault/5"><Cell v={v} /></td>
      <td className="p-4 text-center"><Cell v={a} /></td>
      <td className="p-4 text-center"><Cell v={s} /></td>
      <td className="p-4 text-center"><Cell v={i} /></td>
    </tr>
  );
}

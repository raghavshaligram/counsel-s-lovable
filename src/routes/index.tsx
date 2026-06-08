import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import {
  Lock,
  ShieldCheck,
  FileStack,
  Table2,
  WifiOff,
  Infinity as InfinityIcon,
  Check,
  X,
  ArrowRight,
  CircleDot,
  Scissors,
  RotateCw,
  Stamp,
  PenLine,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaultPDF — The PDF toolkit for documents you'd never upload" },
      {
        name: "description",
        content:
          "Redact, sign, mail-merge, and extract tables from PDFs — 100% in your browser. Your files never leave this tab. Pay once, use forever.",
      },
      { property: "og:title", content: "VaultPDF — PDFs that never leave your browser" },
      {
        property: "og:description",
        content:
          "Privacy-architected PDF toolkit. AI redaction, signing, batch mail-merge, smart table extraction — all client-side.",
      },
      { property: "og:url", content: "/" },
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
  component: Landing,
});

function Landing() {
  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-60" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--gradient-glow)" }}
        />
        <div className="relative mx-auto max-w-6xl px-5 md:px-8 pt-20 md:pt-28 pb-20 md:pb-28">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-2 rounded-full border border-vault/40 bg-vault/10 hover:bg-vault/20 backdrop-blur px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-vault mb-8 transition-colors"
          >
            <CircleDot className="h-3 w-3" />
            AppSumo Lifetime Deal — see pricing
          </Link>
          <h1 className="font-display text-5xl md:text-7xl lg:text-[88px] leading-[0.95] tracking-tight max-w-4xl">
            The PDF toolkit for documents you'd{" "}
            <span className="text-vault italic">never upload</span> to the cloud.
          </h1>
          <p className="mt-8 max-w-2xl text-lg md:text-xl text-muted-foreground leading-relaxed">
            Redact PII. Mail-merge 500 contracts. Extract tables from bank statements. All in your
            browser tab. Your file never touches a server — we couldn't see it if we wanted to.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              to="/redact"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-5 py-3 text-sm font-semibold hover:opacity-90 transition"
            >
              Try Smart Redact <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#tools"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 backdrop-blur px-5 py-3 text-sm font-medium hover:bg-accent transition"
            >
              See all tools
            </a>
          </div>

          <div className="mt-14 flex flex-wrap gap-x-8 gap-y-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <Stat icon={Lock}>100% client-side</Stat>
            <Stat icon={InfinityIcon}>No file size limit</Stat>
            <Stat icon={WifiOff}>Works offline</Stat>
            <Stat icon={ShieldCheck}>No accounts to start</Stat>
          </div>
        </div>
      </section>

      {/* TOOLS */}
      <section id="tools" className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <SectionHead
            label="Four Hero Tools"
            title="Built for the work nobody else will touch."
            kicker="Confidential PDFs that lawyers, accountants, HR, and brokers handle every day."
          />
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            <ToolCard
              to="/redact"
              icon={ShieldCheck}
              name="Smart Redact"
              tag="Ready to try"
              live
              description="AI detects names, SSNs, account numbers, addresses. You confirm. Content is permanently removed from the PDF."
              bullets={["On-device AI", "True content removal", "Metadata stripped"]}
            />
            <ToolCard
              to="/sign"
              icon={PenLine}
              name="Sign & Fill"
              tag="Ready to try"
              live
              description="Draw, type, or upload your signature. Drop it on any page, add text and dates, then flatten — never email an unsigned doc again."
              bullets={["Draw / Type / Upload", "Drag & resize on page", "Flattened output"]}
            />
            <ToolCard
              to="/merge"
              icon={FileStack}
              name="Batch Mail Merge"
              tag="Ready to try"
              live
              description="Upload a PDF template and a CSV. Generate hundreds of filled, named, ready-to-send PDFs in a zip."
              bullets={["CSV / XLSX / JSON", "Auto-rename by field", "Up to 10k per batch"]}
            />
            <ToolCard
              to="/extract"
              icon={Table2}
              name="Smart Table Extract"
              tag="Ready to try"
              live
              description="Pull tables from statements, invoices, papers. Layout-aware with OCR fallback. Export Excel/CSV/JSON."
              bullets={["Multi-page stitching", "OCR for scans", "XLSX/CSV/JSON"]}
            />
          </div>

          {/* Utilities row */}
          <div className="mt-16">
            <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground mb-5">
              Plus everyday utilities
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <UtilCard to="/split" icon={Scissors} name="Split" desc="Pages or ranges into separate PDFs." />
              <UtilCard to="/rotate" icon={RotateCw} name="Rotate" desc="Fix sideways scans, page by page." />
              <UtilCard to="/watermark" icon={Stamp} name="Watermark" desc="CONFIDENTIAL across every page." />
            </div>
          </div>
        </div>
      </section>

      {/* TRUST / HOW PRIVACY WORKS */}
      <section id="trust" className="border-b border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 items-start">
            <div>
              <SectionHead
                label="The Moat"
                title="Privacy isn't a policy. It's the architecture."
              />
              <p className="mt-6 text-muted-foreground leading-relaxed">
                Every other PDF tool — Smallpdf, iLovePDF, Sejda, Adobe Online — sends your file to
                their servers. They ask you to trust their privacy policy. We don't have that
                option: VaultPDF runs entirely in your browser tab using WebAssembly. There is no
                upload endpoint to leak from.
              </p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                That's why our pricing works. No servers to pay for means we can sell a lifetime
                license. And it means HIPAA, GDPR, attorney-client privilege, NDAs — your file
                doesn't trigger any of them, because it never moves.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background/60 backdrop-blur p-6 md:p-8 shadow-[var(--shadow-stamp)]">
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-4">
                What happens when you open a PDF here
              </div>
              <ol className="space-y-4 font-mono text-xs leading-relaxed">
                <Step n={1} ok>
                  Your PDF is read by JavaScript running on your CPU.
                </Step>
                <Step n={2} ok>
                  WebAssembly modules process it inside your browser tab's sandbox.
                </Step>
                <Step n={3} ok>
                  The modified PDF is written back as a file on your device.
                </Step>
                <Step n={4} bad>
                  Nothing is ever uploaded. There is no /upload endpoint.
                </Step>
              </ol>
              <div className="mt-6 pt-6 border-t border-border text-xs text-muted-foreground">
                Want proof? Open your browser's Network tab while using any tool. You'll see zero
                file uploads.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-20 md:py-28">
          <SectionHead
            label="Side by side"
            title="What you actually get vs. the alternatives."
          />
          <div className="mt-10 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-4 font-medium">Feature</th>
                  <Th highlight>VaultPDF</Th>
                  <Th>Adobe Acrobat</Th>
                  <Th>Smallpdf</Th>
                  <Th>iLovePDF</Th>
                  <Th>UPDF</Th>
                </tr>
              </thead>
              <tbody>
                <Row label="Files stay on your device" v={true} a={true} s={false} i={false} u={true} />
                <Row label="AI PII redaction" v={true} a="add-on" s={false} i={false} u={false} />
                <Row label="Batch CSV mail merge" v={true} a={false} s={false} i={false} u={false} />
                <Row label="Smart table extract" v={true} a="basic" s="basic" i="basic" u="basic" />
                <Row label="No file size limit" v={true} a={true} s={false} i="100MB" u={true} />
                <Row label="Works offline" v={true} a={true} s={false} i={false} u={false} />
                <Row label="Pay once, use forever" v={true} a={false} s={false} i={false} u="partial" />
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--gradient-glow)" }}
        />
        <div className="relative mx-auto max-w-4xl px-5 md:px-8 py-24 md:py-32 text-center">
          <h2 className="font-display text-4xl md:text-6xl leading-tight">
            Stop uploading documents you wouldn't print and leave on a bus.
          </h2>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            VaultPDF is free to try, with no account. The lifetime license drops on AppSumo soon —
            be first in line.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/redact"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Open Smart Redact <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

/* ——— small presentational helpers ——— */

function Stat({ icon: Icon, children }: { icon: typeof Lock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-vault" />
      <span>{children}</span>
    </div>
  );
}

function SectionHead({
  label,
  title,
  kicker,
}: {
  label: string;
  title: string;
  kicker?: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="text-[11px] uppercase tracking-[0.24em] text-vault mb-4">{label}</div>
      <h2 className="font-display text-4xl md:text-5xl leading-tight tracking-tight">{title}</h2>
      {kicker && <p className="mt-4 text-muted-foreground text-lg">{kicker}</p>}
    </div>
  );
}

function ToolCard({
  to,
  icon: Icon,
  name,
  description,
  bullets,
  tag,
  live,
}: {
  to: string;
  icon: typeof Lock;
  name: string;
  description: string;
  bullets: string[];
  tag: string;
  live?: boolean;
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col rounded-xl border border-border bg-card/50 hover:bg-card hover:border-vault/50 p-6 transition-all"
    >
      <div className="flex items-start justify-between mb-5">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-vault/10 text-vault">
          <Icon className="h-5 w-5" />
        </div>
        <span
          className={`text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded-full ${
            live ? "bg-vault/15 text-vault" : "bg-muted text-muted-foreground"
          }`}
        >
          {tag}
        </span>
      </div>
      <div className="font-display text-2xl mb-2">{name}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      <ul className="mt-5 space-y-1.5 text-xs text-muted-foreground">
        {bullets.map((b) => (
          <li key={b} className="flex items-center gap-2">
            <Check className="h-3 w-3 text-vault shrink-0" />
            {b}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center gap-1.5 text-xs text-vault font-medium opacity-70 group-hover:opacity-100 transition">
        Open tool <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function UtilCard({
  to,
  icon: Icon,
  name,
  desc,
}: {
  to: string;
  icon: typeof Lock;
  name: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-4 rounded-lg border border-border bg-card/40 hover:bg-card hover:border-vault/50 p-4 transition"
    >
      <div className="grid h-9 w-9 place-items-center rounded-md bg-vault/10 text-vault shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-muted-foreground truncate">{desc}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-vault transition shrink-0" />
    </Link>
  );
}



function Step({ n, ok, bad, children }: { n: number; ok?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`shrink-0 mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? "bg-vault/15 text-vault" : bad ? "bg-destructive/20 text-destructive" : "bg-muted"
        }`}
      >
        {n}
      </span>
      <span className="text-foreground/90">{children}</span>
    </li>
  );
}

function Th({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <th
      className={`p-4 text-center font-medium ${
        highlight ? "text-vault" : ""
      }`}
    >
      {children}
    </th>
  );
}

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="h-4 w-4 text-vault mx-auto" />;
  if (v === false) return <X className="h-4 w-4 text-muted-foreground/50 mx-auto" />;
  return <span className="text-xs text-muted-foreground">{v}</span>;
}

function Row({
  label,
  v,
  a,
  s,
  i,
  u,
}: {
  label: string;
  v: boolean | string;
  a: boolean | string;
  s: boolean | string;
  i: boolean | string;
  u: boolean | string;
}) {
  return (
    <tr className="border-t border-border">
      <td className="p-4 text-foreground">{label}</td>
      <td className="p-4 text-center bg-vault/5">
        <Cell v={v} />
      </td>
      <td className="p-4 text-center">
        <Cell v={a} />
      </td>
      <td className="p-4 text-center">
        <Cell v={s} />
      </td>
      <td className="p-4 text-center">
        <Cell v={i} />
      </td>
      <td className="p-4 text-center">
        <Cell v={u} />
      </td>
    </tr>
  );
}

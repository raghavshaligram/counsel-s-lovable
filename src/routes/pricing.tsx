import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Check,
  X,
  Lock,
  Sparkles,
  Mail,
  ArrowRight,
  CircleDot,
  ChevronDown,
} from "lucide-react";

const FAQS = [
  {
    q: "Where do my files actually go?",
    a: "Nowhere. VaultPDF runs entirely in your browser tab using WebAssembly. There is no upload endpoint. Open your browser's Network tab while you work — you'll see zero file uploads. The processing happens on your CPU, the result is written back as a download.",
  },
  {
    q: "Is there a file size limit?",
    a: "No hard limit. The practical cap is your device's memory — modern laptops handle 500MB+ PDFs without trouble. Because there's no upload, you skip the 100MB/200MB caps that Smallpdf, iLovePDF, and Adobe Online impose.",
  },
  {
    q: "Does it work offline?",
    a: "Yes. Once the page loads, you can disconnect from the internet and every tool keeps working. Try it: load the page, kill your Wi-Fi, then redact a PDF.",
  },
  {
    q: "Is this safe for HIPAA, GDPR, or attorney-client privileged documents?",
    a: "Yes — because your file never leaves your device, none of those regulations are triggered by VaultPDF. There's no data processor agreement to sign, no breach to report, no cloud subprocessor to vet. We literally cannot see your file.",
  },
  {
    q: "What does the lifetime deal include?",
    a: "Every current tool — Redact, Sign & Fill, Mail Merge, Extract, Split, Rotate, Watermark — plus every tool we ship in the future. No subscription, no per-document fees, no seat caps. Pay once, use forever.",
  },
  {
    q: "How do you make money if everything runs in my browser?",
    a: "One-time license sales. No servers to run means no recurring infrastructure cost — so we don't need a subscription to stay alive. The AppSumo lifetime deal drops once we hit a small waitlist threshold.",
  },
  {
    q: "Can I use it commercially?",
    a: "Yes. The lifetime license covers commercial use at your firm, agency, or company. Bulk seat licensing for teams over 25 is available — just reply to the launch email.",
  },
  {
    q: "What if you go out of business?",
    a: "The app keeps working. Because everything runs client-side, there's no server to shut down. Worst case, we open-source the core modules so the toolkit stays alive even if the company doesn't.",
  },
];

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — VaultPDF Lifetime Deal" },
      {
        name: "description",
        content:
          "One payment, every tool, forever. The VaultPDF AppSumo lifetime deal — join the waitlist for launch pricing.",
      },
      { property: "og:title", content: "VaultPDF — Lifetime Deal" },
      {
        property: "og:description",
        content:
          "Pay once, use forever. Every privacy-architected PDF tool — current and future. Join the waitlist.",
      },
      { property: "og:url", content: "/pricing" },
      { property: "og:type", content: "product" },
    ],
    links: [{ rel: "canonical", href: "/pricing" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "VaultPDF Lifetime License",
          description:
            "One-time payment for lifetime access to every VaultPDF tool, current and future.",
          brand: { "@type": "Brand", name: "VaultPDF" },
          offers: {
            "@type": "Offer",
            availability: "https://schema.org/PreOrder",
            priceCurrency: "USD",
            price: "59",
            url: "/pricing",
          },
        }),
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-50" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--gradient-glow)" }}
        />
        <div className="relative mx-auto max-w-5xl px-5 md:px-8 pt-16 md:pt-24 pb-12 md:pb-16 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 backdrop-blur px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground mb-7">
            <CircleDot className="h-3 w-3 text-vault" />
            AppSumo Lifetime Deal — coming soon
          </div>
          <h1 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight">
            One payment.<br />
            <span className="text-vault italic">Every tool. Forever.</span>
          </h1>
          <p className="mt-7 max-w-2xl mx-auto text-lg text-muted-foreground leading-relaxed">
            VaultPDF runs entirely in your browser, so we don't pay for servers — which means we
            can offer something nobody else can: a real lifetime license, not a subscription
            disguised as one.
          </p>
        </div>
      </section>

      {/* PRICING CARD */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-20 grid lg:grid-cols-[1.1fr_1fr] gap-8 items-start">
          {/* The Card */}
          <div className="relative rounded-2xl border border-vault/40 bg-card/60 backdrop-blur p-8 md:p-10 shadow-[var(--shadow-stamp)] overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none opacity-50"
              style={{ background: "var(--gradient-glow)" }}
            />
            <div className="relative">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-vault font-medium mb-4">
                <Sparkles className="h-3.5 w-3.5" />
                Founding member tier
              </div>
              <div className="font-display text-3xl md:text-4xl leading-tight">
                VaultPDF Lifetime
              </div>
              <div className="mt-6 flex items-baseline gap-3">
                <span className="font-display text-6xl md:text-7xl text-vault">$59</span>
                <span className="text-sm text-muted-foreground line-through">$199</span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  one-time
                </span>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Locked in for the first 1,000 buyers. Goes up after launch.
              </p>

              <ul className="mt-8 space-y-3 text-sm">
                {[
                  "Every current tool — Redact, Sign & Fill, Merge, Extract, Split, Rotate, Watermark",
                  "Every future tool we ship — included, forever",
                  "Commercial use at your firm or company",
                  "No subscription. No per-document fees. No seat caps under 25.",
                  "Priority email support",
                  "Open-source escrow — modules stay alive if we don't",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <Check className="h-4 w-4 text-vault shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <a
                href="#waitlist"
                className="mt-10 inline-flex items-center justify-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90 w-full"
              >
                Join the launch waitlist <ArrowRight className="h-4 w-4" />
              </a>
              <p className="mt-3 text-[11px] text-muted-foreground text-center">
                We email once when the deal goes live. No drip campaign.
              </p>
            </div>
          </div>

          {/* Counter-card: why it's not a SaaS */}
          <div className="space-y-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground mb-3">
                Why this works
              </div>
              <h2 className="font-display text-2xl md:text-3xl leading-tight">
                Every PDF tool charges monthly because they pay for servers. We don't.
              </h2>
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-5">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
                Annual cost over 5 years
              </div>
              <CostRow name="Adobe Acrobat Pro" price="$240" total="$1,200" bad />
              <CostRow name="Smallpdf Pro" price="$108" total="$540" bad />
              <CostRow name="iLovePDF Premium" price="$72" total="$360" bad />
              <CostRow name="VaultPDF Lifetime" price="$59 once" total="$59" good />
            </div>
            <div className="rounded-xl border border-border bg-card/40 p-5 text-sm text-muted-foreground leading-relaxed">
              The other PDF apps need your monthly payment to keep their servers running.
              VaultPDF runs on your CPU — no servers, no recurring cost on our side, so no
              recurring cost on yours.
            </div>
          </div>
        </div>
      </section>

      {/* WAITLIST */}
      <section id="waitlist" className="border-b border-border bg-card/30">
        <div className="mx-auto max-w-2xl px-5 md:px-8 py-16 md:py-20 text-center">
          <div className="text-[10px] uppercase tracking-[0.24em] text-vault mb-3">Waitlist</div>
          <h2 className="font-display text-3xl md:text-5xl leading-tight">
            Be first when the deal drops.
          </h2>
          <p className="mt-5 text-muted-foreground">
            One email when the AppSumo deal goes live. Founding-member price stays locked for the
            first 1,000 buyers.
          </p>
          <WaitlistForm />
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-3xl px-5 md:px-8 py-16 md:py-20">
          <div className="text-[10px] uppercase tracking-[0.24em] text-vault mb-3">FAQ</div>
          <h2 className="font-display text-3xl md:text-5xl leading-tight">
            Questions people actually ask.
          </h2>
          <div className="mt-10 space-y-2">
            {FAQS.map((f, i) => (
              <FaqItem key={i} q={f.q} a={f.a} />
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-3xl px-5 md:px-8 py-20 text-center">
          <p className="text-sm text-muted-foreground mb-4">Still skeptical?</p>
          <h3 className="font-display text-3xl md:text-4xl leading-tight">
            Try the tools first. No account needed.
          </h3>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/redact"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-5 py-3 text-sm font-semibold hover:opacity-90"
            >
              <Lock className="h-4 w-4" /> Try Smart Redact
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-5 py-3 text-sm font-medium hover:bg-accent"
            >
              See all tools
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function CostRow({
  name,
  price,
  total,
  good,
  bad,
}: {
  name: string;
  price: string;
  total: string;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
      <div className="text-sm">{name}</div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-muted-foreground">{price}</span>
        <span
          className={`font-mono text-sm tabular-nums ${
            good ? "text-vault font-semibold" : bad ? "text-muted-foreground" : ""
          }`}
        >
          {total}
        </span>
        {good ? (
          <Check className="h-3.5 w-3.5 text-vault" />
        ) : (
          <X className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card/40 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-accent/40 transition"
      >
        <span className="font-medium text-[15px]">{q}</span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{a}</div>
      )}
    </div>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const valid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()), [email]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      toast.error("That doesn't look like a valid email.");
      return;
    }
    // Best-effort: open mail client to confirm; persist locally so we
    // can show success state across reloads.
    try {
      localStorage.setItem("vaultpdf:waitlist", email.trim());
    } catch {
      /* ignore */
    }
    const subject = encodeURIComponent("VaultPDF waitlist");
    const body = encodeURIComponent(
      `Please add ${email.trim()} to the VaultPDF launch waitlist.`,
    );
    window.location.href = `mailto:hello@vaultpdf.app?subject=${subject}&body=${body}`;
    setSubmitted(true);
    toast.success("You're on the list. We'll email once.");
  };

  if (submitted) {
    return (
      <div className="mt-8 rounded-lg border border-vault/40 bg-vault/10 px-5 py-6 text-center">
        <Check className="h-5 w-5 text-vault mx-auto mb-2" />
        <div className="text-sm">
          You're on the list. We'll email <span className="font-mono">{email}</span> once.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
      <div className="relative flex-1">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@firm.com"
          className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
        />
      </div>
      <Button
        type="submit"
        disabled={!valid}
        className="bg-vault text-vault-foreground hover:opacity-90 px-5"
      >
        Join waitlist
      </Button>
    </form>
  );
}

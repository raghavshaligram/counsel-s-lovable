import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Lock, Shield, WifiOff, Eye, ArrowRight, Terminal } from "lucide-react";

export const Route = createFileRoute("/verify-privacy")({
  head: () => ({
    meta: [
      { title: "Verify Our Privacy — VaultPDF" },
      {
        name: "description",
        content:
          "Don't trust us. Verify it yourself. Open the Network tab, run any tool, and confirm zero uploads. VaultPDF is 100% client-side.",
      },
      { property: "og:title", content: "Verify Our Privacy — VaultPDF" },
      {
        property: "og:description",
        content:
          "Challenge our privacy claim yourself. Open DevTools, run a redaction, and watch the network log prove zero uploads.",
      },
      { property: "og:url", content: "/verify-privacy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/verify-privacy" }],
  }),
  component: VerifyPrivacyPage,
});

function VerifyPrivacyPage() {
  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-40" />
        <div className="relative mx-auto max-w-5xl px-5 md:px-8 pt-16 md:pt-24 pb-16 md:pb-20">
          <div className="font-mono text-[11px] text-muted-foreground mb-6 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-vault animate-pulse" />
            Independent verification
          </div>
          <h1
            className="font-display leading-[0.92] tracking-tight"
            style={{ fontSize: "clamp(2.5rem, 6vw, 5.5rem)" }}
          >
            Don&apos;t trust us.
            <br />
            <span className="italic text-vault">Verify it yourself.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base md:text-lg text-muted-foreground leading-relaxed">
            The strongest privacy claim is one you can test. We invite you to inspect
            VaultPDF the same way you would inspect any evidence: with your own eyes,
            under your own control.
          </p>
        </div>
      </section>

      {/* 3-STEP CHALLENGE */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            The challenge — three steps
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <StepCard
              num="01"
              title="Open the VaultPDF workspace."
              body="Navigate to any tool — Redact for production, Bates stamp, or OCR. The workspace loads entirely in your browser. No installer, no login, no cloud account."
            />
            <StepCard
              num="02"
              title="Press F12 and open the Network tab."
              body="Use Chrome, Edge, Firefox, or Safari. Filter by 'Doc' or 'XHR'. Keep the panel visible. You are now monitoring every byte that leaves this tab."
            />
            <StepCard
              num="03"
              title="Drop in a document and run a tool."
              body="Upload the largest, most sensitive PDF you have. Run redaction, OCR, or Bates numbering. Watch the network log. You will see zero outgoing requests carrying your document. Your files never leave your browser."
            />
          </div>

          <div className="mt-12 rounded-xl border border-vault/20 bg-accent-soft p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-vault/15">
                <Eye className="h-5 w-5 text-vault" />
              </div>
              <div>
                <div className="text-[15px] font-medium text-foreground">
                  What you should see
                </div>
                <p className="mt-2 text-sm text-text-2 leading-relaxed">
                  The Network panel will show static assets — JavaScript bundles, fonts,
                  and stylesheets — loaded from the same origin or cache. You will see
                  <strong className="text-foreground"> no POST requests containing PDF data</strong>,
                  no multipart uploads, no calls to remote analysis APIs, and no telemetry
                  batches carrying document content. If you see anything that looks like a file
                  upload, screenshot it and send it to us. We will fix it immediately.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16 items-start">
            <div>
              <div className="font-mono text-[11px] text-muted-foreground mb-4 uppercase tracking-[0.16em]">
                Architecture
              </div>
              <h2
                className="font-display leading-[1] tracking-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
              >
                Fully client-side.
                <br />
                <span className="italic">By design, not by promise.</span>
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed">
                VaultPDF is built with WebAssembly and modern browser APIs. The PDF parser,
                the redaction engine, the OCR model, and the export compressor all run inside
                your browser tab. There is no server-side component that handles your file.
                We did not merely turn off uploads — we removed the upload path entirely.
              </p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Your document is read into memory as an ArrayBuffer, processed by local code,
                and written back to disk via the browser&apos;s native download mechanism.
                At no point is your data serialized and sent over a network connection.
              </p>
            </div>

            <div className="space-y-4">
              <DetailRow
                icon={<Terminal className="h-4 w-4" />}
                label="No upload endpoint"
                value="There is no /upload, /process, or /convert route on our server. The application is a static site."
              />
              <DetailRow
                icon={<Lock className="h-4 w-4" />}
                label="No remote API calls"
                value="We do not call Google Cloud Vision, AWS Textract, or any third-party OCR or analysis service."
              />
              <DetailRow
                icon={<Shield className="h-4 w-4" />}
                label="No telemetry with document data"
                value="Analytics events contain page views and errors. They never contain filenames, text content, or page images."
              />
              <DetailRow
                icon={<WifiOff className="h-4 w-4" />}
                label="Works offline"
                value="Once loaded, every tool functions without an internet connection. The Service Worker caches all assets."
              />
            </div>
          </div>
        </div>
      </section>

      {/* OFFLINE & DATA HANDLING */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-10">
            <div className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-vault font-medium mb-4">
                <WifiOff className="h-3.5 w-3.5" />
                Works offline
              </div>
              <h3 className="font-display text-xl md:text-2xl leading-tight mb-4">
                Disconnect the internet and keep working.
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Load VaultPDF while connected. Then disable Wi-Fi or unplug your ethernet
                cable. Open a document, redact it, Bates-stamp it, and export the result.
                Everything functions exactly as before because nothing in the workflow depends
                on a server round-trip. This is not a fallback mode — it is the default architecture.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-vault font-medium mb-4">
                <Lock className="h-3.5 w-3.5" />
                Data handling
              </div>
              <h3 className="font-display text-xl md:text-2xl leading-tight mb-4">
                Nothing is uploaded. Ever.
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                No server — ours or anyone else&apos;s — ever receives your documents. There is
                no cloud storage bucket, no processing queue, and no temporary cache on a remote
                machine. Your files remain in your browser&apos;s memory and are discarded when you
                close the tab. We do not have access to your documents, which means we cannot lose
                them, leak them, or be compelled to disclose them.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--gradient-glow)" }}
        />
        <div className="relative mx-auto max-w-3xl px-5 md:px-8 py-20 md:py-28 text-center">
          <h2
            className="font-display leading-[1.02] tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}
          >
            The only way to be certain is to see it for yourself.
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/workspace"
              search={{ tool: "redact" }}
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Open the workspace <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-6 py-3 text-sm font-medium hover:bg-accent transition"
            >
              Back to home
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function StepCard({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6 md:p-7">
      <div className="font-mono text-[11px] text-vault mb-4">{num}</div>
      <h3 className="font-display text-lg md:text-xl leading-tight mb-3">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/40 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-vault/10 text-vault">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{value}</p>
      </div>
    </div>
  );
}

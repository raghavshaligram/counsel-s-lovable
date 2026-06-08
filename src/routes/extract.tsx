import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ArrowLeft, Table2 } from "lucide-react";

export const Route = createFileRoute("/extract")({
  head: () => ({
    meta: [
      { title: "Smart Table Extract — VaultPDF" },
      {
        name: "description",
        content:
          "Pull tables out of PDFs into clean Excel, CSV, or JSON. Coming soon to VaultPDF.",
      },
    ],
  }),
  component: ComingSoon,
});

function ComingSoon() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-5 md:px-8 py-24 text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-xl bg-vault/10 text-vault">
          <Table2 className="h-6 w-6" />
        </div>
        <h1 className="font-display text-4xl md:text-5xl leading-tight">Smart Table Extract</h1>
        <p className="mt-4 text-muted-foreground text-lg">
          Layout-aware table detection with OCR fallback. Outputs clean Excel, CSV, JSON.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Built for bank statements, invoices, lab reports, SEC filings — the data you'd never
          paste into a free cloud tool.
        </p>
        <div className="mt-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-5 py-3 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

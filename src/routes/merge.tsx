import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ArrowLeft, FileStack } from "lucide-react";

export const Route = createFileRoute("/merge")({
  head: () => ({
    meta: [
      { title: "Batch Mail Merge — VaultPDF" },
      {
        name: "description",
        content:
          "Generate hundreds of filled PDFs from a CSV in your browser. Coming soon to VaultPDF.",
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
          <FileStack className="h-6 w-6" />
        </div>
        <h1 className="font-display text-4xl md:text-5xl leading-tight">Batch Mail Merge</h1>
        <p className="mt-4 text-muted-foreground text-lg">
          Upload a PDF template + a CSV, get 500 filled PDFs in a zip. Building this next.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Use cases we're optimising for: mortgage disclosure packets, offer letters, NDAs,
          invoices, donation receipts.
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

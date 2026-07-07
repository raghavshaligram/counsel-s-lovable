import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  CreditCard, ArrowLeft, ExternalLink, ShieldCheck, Users, Loader2, FileText, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getMyBilling, openMyBillingPortal, createMyCheckout } from "@/lib/billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { refreshLicense } from "@/lib/use-license-activation";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Subscription & billing — CounselPDF" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BillingPage,
});

function planLabel(p: "free" | "solo" | "firm") {
  return p === "solo" ? "Founder's plan" : p === "firm" ? "Firm pass" : "Free";
}
function statusLabel(s: string) {
  return s === "active" ? "Active" : s === "trialing" ? "Trialing" : s === "past_due" ? "Past due" : s === "canceled" ? "Canceled" : s;
}

function BillingPage() {
  const fetchBilling = useServerFn(getMyBilling);
  const { data: b, isPending } = useQuery({
    queryKey: ["my-billing"],
    queryFn: () => fetchBilling(),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <h1 className="font-display text-2xl tracking-tight">Subscription &amp; billing</h1>
        <p className="mt-1 text-[13px] text-text-2">
          Cards and invoices are handled by Stripe. CounselPDF never stores card data — we only read your plan status.
        </p>

        {isPending || !b ? (
          <div className="mt-10 flex items-center gap-2 text-text-2 text-[13px]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading subscription…
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-5">
            <PlanCard b={b} />
            {b.plan === "firm" && <SeatsCard used={b.seats?.used ?? 1} total={b.seats?.total ?? 10} />}
            <BillingHistoryCard hasCustomer={b.hasStripeCustomer} />
            {b.plan !== "free" && <CancelCard />}
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-surface-1/60 backdrop-blur">
      <div className="mx-auto max-w-3xl px-5 h-12 flex items-center justify-between">
        <Link to="/workspace" className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
        </Link>
        <Link to="/account" className="text-[12.5px] text-text-2 hover:text-foreground">Account settings →</Link>
      </div>
    </header>
  );
}

function Card({ title, icon, description, children }: { title: string; icon: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface-1 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-vault">{icon}</span>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-text-2">{description}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function PlanCard({ b }: { b: { plan: "free" | "solo" | "firm"; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } }) {
  const open = useServerFn(openMyBillingPortal);
  const portal = useMutation({
    mutationFn: async () => open(),
    onSuccess: (res) => { if ((res as { url?: string } | undefined)?.url) window.location.href = (res as { url: string }).url; },
    onError: (e) => toast.error((e as Error).message, { duration: 6000 }),
  });
  const checkout = useServerFn(createMyCheckout);
  const upgrade = useMutation({
    mutationFn: async (plan: "solo" | "firm") => checkout({ data: { plan } }),
    onSuccess: (res) => { if ((res as { url?: string } | undefined)?.url) window.location.href = (res as { url: string }).url; },
    onError: (e) => toast.error((e as Error).message, { duration: 6000 }),
  });

  const renewLine = b.currentPeriodEnd
    ? new Date(b.currentPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <Card title="Current plan" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
      <div className="rounded-md border border-border bg-surface-2/50 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-display text-[18px] text-foreground">{planLabel(b.plan)}</div>
            <div className="mt-0.5 text-[11.5px] text-text-2">
              Status: <span className="text-foreground">{statusLabel(b.status)}</span>
              {renewLine && (b.plan !== "free") && (
                <> · {b.cancelAtPeriodEnd ? "Ends" : "Renews"} <span className="text-foreground">{renewLine}</span></>
              )}
            </div>
          </div>
          <span className={cn(
            "rounded-sm border px-2 py-0.5 text-[10.5px] uppercase tracking-[0.12em]",
            b.status === "active" ? "border-vault/30 bg-accent-soft text-vault" : "border-border text-text-2",
          )}>{b.status}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {b.plan === "free" ? (
          <>
            <button onClick={() => upgrade.mutate("solo")} disabled={upgrade.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90 disabled:opacity-50">
              Upgrade to Founder&apos;s plan
            </button>
            <button onClick={() => upgrade.mutate("firm")} disabled={upgrade.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-2 disabled:opacity-50">
              Get the firm pass
            </button>
          </>
        ) : (
          <button onClick={() => portal.mutate()} disabled={portal.isPending} className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90 disabled:opacity-50">
            <ExternalLink className="h-3.5 w-3.5" /> {portal.isPending ? "Opening…" : "Manage billing"}
          </button>
        )}
        <Link to="/pricing" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-2">
          Compare plans
        </Link>
      </div>
      <p className="text-[10.5px] leading-snug text-text-muted">
        Cards, invoices and cancellation are handled in Stripe&apos;s billing portal. We never see or store card data.
      </p>
    </Card>
  );
}

function SeatsCard({ used, total }: { used: number; total: number }) {
  return (
    <Card title="Firm seats" icon={<Users className="h-3.5 w-3.5" />} description="Invite colleagues to share your firm pass. Each member signs in with their own account; documents stay on their device.">
      <div className="rounded-md border border-border bg-surface-2/50 p-3 text-[12.5px]">
        <span className="text-foreground">{used}</span><span className="text-text-2"> of {total} seats used</span>
      </div>
      <SeatInviteForm />
      <p className="text-[10.5px] leading-snug text-text-muted">
        Seat management activates when the firm pass is purchased. Invite emails go out through CounselPDF; signups create independent accounts under the same firm subscription.
      </p>
    </Card>
  );
}

function SeatInviteForm() {
  return (
    <form onSubmit={(e) => { e.preventDefault(); toast.info("Seat invites activate once the firm pass is connected to Stripe.", { duration: 5000 }); }} className="flex gap-2">
      <input type="email" placeholder="colleague@firm.com" className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] focus:border-vault/40 focus:outline-none" />
      <button type="submit" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-2">
        Invite
      </button>
    </form>
  );
}

function BillingHistoryCard({ hasCustomer }: { hasCustomer: boolean }) {
  const open = useServerFn(openMyBillingPortal);
  const portal = useMutation({
    mutationFn: async () => open(),
    onSuccess: (res) => { if ((res as { url?: string } | undefined)?.url) window.location.href = (res as { url: string }).url; },
    onError: (e) => toast.error((e as Error).message, { duration: 6000 }),
  });
  return (
    <Card title="Billing history" icon={<FileText className="h-3.5 w-3.5" />} description="Invoices and receipts live in Stripe.">
      {hasCustomer ? (
        <button onClick={() => portal.mutate()} className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-surface-2">
          <ExternalLink className="h-3.5 w-3.5" /> View invoices in Stripe
        </button>
      ) : (
        <div className="rounded-md border border-border bg-surface-2/50 px-3 py-3 text-[12.5px] text-text-2">
          No billing history yet — you&apos;re on the free plan.
        </div>
      )}
    </Card>
  );
}

function CancelCard() {
  const open = useServerFn(openMyBillingPortal);
  const portal = useMutation({
    mutationFn: async () => open(),
    onSuccess: (res) => { if ((res as { url?: string } | undefined)?.url) window.location.href = (res as { url: string }).url; },
    onError: (e) => toast.error((e as Error).message, { duration: 6000 }),
  });
  return (
    <section className="rounded-md border border-border/70 bg-surface-1 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-surface-2 text-text-2"><AlertCircle className="h-3.5 w-3.5" /></span>
        <div>
          <h2 className="font-display text-[15px] tracking-tight">Cancel subscription</h2>
          <p className="mt-0.5 text-[12px] text-text-2">
            Cancelling keeps your access until the end of the current period. After that you&apos;ll lose:
            unlimited redactions, privilege review, Bates-stamp batches, and certificate of redaction.
            Your free tools (basic redact, merge, split, sanitize) keep working.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button onClick={() => portal.mutate()} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-text-2 hover:text-foreground hover:bg-surface-2">
          <ExternalLink className="h-3.5 w-3.5" /> Cancel in Stripe portal
        </button>
      </div>
    </section>
  );
}

// Silence unused-import warnings.
void useNavigate; void CreditCard;

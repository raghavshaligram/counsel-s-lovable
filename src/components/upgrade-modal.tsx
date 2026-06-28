/**
 * Upgrade modal — the single entry point when a non-Pro user activates a
 * paid tool or paid feature. Replaces the previous "bounce straight to
 * /auth" UX. Shows the two tiers (Solo Founder's, Small-firm annual pass)
 * with a short "what you unlock" list, and two paths:
 *
 *   • Subscribe   → calls `createMyCheckout` server fn. While Stripe
 *     payments aren't connected on the project, that throws and we
 *     surface the message + route the user to /pricing as a fallback.
 *   • Sign in     → /auth with `?redirect` back to the tool, so an
 *     existing subscriber lands right back on the feature they clicked.
 *
 * Modal state is a tiny zustand store so any call site (the tool rail,
 * inline paid-feature buttons inside free tools, etc.) can open it
 * without prop-drilling.
 */
import { useCallback, useState } from "react";
import { create } from "zustand";
import { Link, useNavigate } from "@tanstack/react-router";
import { Lock, Check, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { useServerFn } from "@tanstack/react-start";
import { createMyCheckout } from "@/lib/billing.functions";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLoginModal } from "@/components/login-modal";

type UpgradeReason = {
  featureName?: string;
  /** Path to return to after sign-in / subscribe. Defaults to current href. */
  returnTo?: string;
};

type UpgradeModalState = {
  open: boolean;
  reason: UpgradeReason | null;
  openModal: (reason?: UpgradeReason) => void;
  close: () => void;
};

export const useUpgradeModal = create<UpgradeModalState>((set) => ({
  open: false,
  reason: null,
  openModal: (reason) => set({ open: true, reason: reason ?? null }),
  close: () => set({ open: false }),
}));

const UNLOCKS: string[] = [
  "AI sensitive-data detection",
  "Pattern & bulk redaction",
  "Multi-file Bates stamping",
  "Batch processing across folders",
  "Workflows & automation",
  "Privilege review (AI)",
  "Private AI assist",
];

type Tier = {
  id: "solo" | "firm";
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  cta: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "solo",
    name: "Solo Founder's",
    price: "$17",
    cadence: "/mo, billed annually",
    blurb: "For solo lawyers and paralegals. One seat, every Pro feature.",
    cta: "Subscribe — Solo",
    featured: true,
  },
  {
    id: "firm",
    name: "Small-firm annual pass",
    price: "$1,490",
    cadence: "/yr · up to 10 seats",
    blurb: "Shared seats for a small practice. Centralised billing.",
    cta: "Subscribe — Firm",
  },
];

export function UpgradeModal() {
  const { open, reason, close } = useUpgradeModal();
  const navigate = useNavigate();
  const openLogin = useLoginModal((s) => s.openLogin);
  const checkout = useServerFn(createMyCheckout);
  const [pending, setPending] = useState<Tier["id"] | null>(null);



  const onSubscribe = useCallback(
    async (plan: Tier["id"]) => {
      setPending(plan);
      try {
        const result = (await checkout({ data: { plan } })) as unknown as
          | { url?: string }
          | null
          | undefined;
        const url = result?.url;
        if (url) {
          window.location.href = url;
          return;
        }
        // No URL but no error: treat as not configured.
        throw new Error("Checkout isn't connected yet.");
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Checkout isn't available right now.";
        toast.message("Subscriptions open on the Pricing page", {
          description: msg,
        });
        close();
        void navigate({ to: "/pricing" });
      } finally {
        setPending(null);
      }
    },
    [checkout, close, navigate],
  );

  const onSignIn = useCallback(() => {
    close();
    openLogin();
  }, [close, openLogin]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0 transform-gpu antialiased">
        <DialogHeader className="border-b border-border bg-surface-1 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-vault/15 text-vault">
              <Lock className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-display text-[17px] leading-tight antialiased tracking-normal">
                Unlock VaultPDF Pro
              </DialogTitle>
              <DialogDescription className="mt-1 text-[13px] text-text-2">
                {reason?.featureName
                  ? `“${reason.featureName}” is a Pro feature. Subscribe or sign in to continue — everything still runs on your device.`
                  : "Subscribe or sign in to continue — everything still runs on your device."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-5 p-5 md:grid-cols-[1fr_minmax(0,0.9fr)]">
          {/* What you unlock */}
          <section aria-label="What you unlock">
            <h3 className="font-display text-[13px] uppercase tracking-[0.18em] text-text-2">
              What you unlock
            </h3>
            <ul className="mt-3 space-y-2 text-[13px] text-foreground">
              {UNLOCKS.map((u) => (
                <li key={u} className="flex items-start gap-2">
                  <Check
                    className="mt-[3px] h-3.5 w-3.5 shrink-0 text-vault"
                    strokeWidth={2.5}
                  />
                  <span className="leading-snug">{u}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[11.5px] leading-relaxed text-text-2">
              Free tools — Redact, Bates, Merge, Split, Sign &amp; Fill, OCR
              and the rest — stay free, signed-in or not.
            </p>
          </section>

          {/* Tiers */}
          <section aria-label="Choose a plan" className="flex flex-col gap-3">
            {TIERS.map((tier) => (
              <article
                key={tier.id}
                className={cn(
                  "rounded-lg border bg-surface-1 p-4",
                  tier.featured
                    ? "border-vault/50 shadow-[0_0_0_1px_var(--vault)]/20"
                    : "border-border",
                )}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h4 className="font-display text-[14px]">{tier.name}</h4>
                  {tier.featured && (
                    <span className="rounded-sm bg-vault/15 px-1.5 py-px text-[10px] uppercase tracking-[0.16em] text-vault">
                      Popular
                    </span>
                  )}
                </header>
                <div className="mt-1.5 flex items-baseline gap-1">
                  <span className="font-display text-[22px] leading-none">
                    {tier.price}
                  </span>
                  <span className="text-[11.5px] text-text-2">
                    {tier.cadence}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-text-2">
                  {tier.blurb}
                </p>
                <button
                  type="button"
                  onClick={() => void onSubscribe(tier.id)}
                  disabled={pending !== null}
                  className={cn(
                    "mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-[12.5px] font-medium transition-opacity",
                    tier.featured
                      ? "bg-vault text-vault-foreground hover:opacity-90"
                      : "border border-border bg-surface-2 text-foreground hover:bg-surface-2/80",
                    pending !== null && "opacity-60",
                  )}
                >
                  {pending === tier.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Opening checkout…
                    </>
                  ) : (
                    <>
                      {tier.cta}
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </article>
            ))}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-1 px-5 py-3 text-[12px] text-text-2">
          <span>
            Already a subscriber?{" "}
            <button
              type="button"
              onClick={onSignIn}
              className="font-medium text-vault hover:underline underline-offset-4"
            >
              Sign in
            </button>{" "}
            to unlock.
          </span>
          <Link
            to="/pricing"
            onClick={() => close()}
            className="hover:text-foreground"
          >
            Compare plans →
          </Link>
        </footer>

      </DialogContent>
    </Dialog>
  );
}

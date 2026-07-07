/**
 * Billing server functions — read the caller's subscription row and surface
 * a normalized snapshot for the Billing page. The Stripe portal opener is
 * a stub until Stripe payments are enabled on this project; the UI calls
 * it and shows the returned message.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BillingSnapshot = {
  plan: "free" | "solo" | "firm";
  status: "active" | "trialing" | "past_due" | "canceled";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
  seats: { used: number; total: number } | null;
};

export const getMyBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingSnapshot> => {
    const { data } = await context.supabase
      .from("subscriptions")
      .select("plan, status, current_period_end, stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const plan = (data?.plan ?? "free") as BillingSnapshot["plan"];
    return {
      plan,
      status: (data?.status ?? "active") as BillingSnapshot["status"],
      currentPeriodEnd: data?.current_period_end ?? null,
      cancelAtPeriodEnd: false,
      hasStripeCustomer: !!data?.stripe_customer_id,
      seats: plan === "firm" ? { used: 1, total: 10 } : null,
    };
  });

/**
 * Returns a Stripe Billing Portal URL for the caller. Until Stripe payments
 * are enabled on this workspace, throws a clear error the UI surfaces as a
 * toast. The portal handles cards, invoices and cancellation — we never
 * touch card data ourselves.
 */
export const openMyBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new Error(
      "Billing portal isn't connected yet. Enable Stripe payments on this project to manage cards, invoices, and cancellations.",
    );
  });

/** Stripe Checkout session for plan upgrades — stub until Stripe is enabled. */
export const createMyCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => d as { plan: "solo" | "firm" })
  .handler(async () => {
    throw new Error(
      "Checkout isn't connected yet. Enable Stripe payments to start subscriptions.",
    );
  });

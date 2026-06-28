import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LicenseSnapshot = {
  userId: string;
  email: string | null;
  plan: "free" | "solo" | "firm";
  status: "active" | "trialing" | "past_due" | "canceled";
  currentPeriodEnd: string | null;
  entitled: boolean;
  validatedAt: string;
};

/**
 * Server-side license validation. Reads the caller's subscription row
 * (RLS-scoped) and returns a normalized snapshot the client caches locally.
 * Runs in the TanStack server runtime — never trust client-side state for
 * entitlement decisions.
 */
export const getLicense = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LicenseSnapshot> => {
    const { supabase, userId, claims } = context;

    const { data, error } = await supabase
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const plan = (data?.plan ?? "free") as LicenseSnapshot["plan"];
    const status = (data?.status ?? "active") as LicenseSnapshot["status"];
    const currentPeriodEnd = data?.current_period_end ?? null;

    const periodOk =
      !currentPeriodEnd || new Date(currentPeriodEnd).getTime() > Date.now();
    const entitled =
      (status === "active" || status === "trialing") && periodOk && plan !== "free"
        ? true
        : plan === "free" && status === "active"; // free tier is always "entitled" to free tools

    return {
      userId,
      email: (claims as { email?: string } | null)?.email ?? null,
      plan,
      status,
      currentPeriodEnd,
      entitled,
      validatedAt: new Date().toISOString(),
    };
  });

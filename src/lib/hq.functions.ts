/**
 * /hq super-admin server functions. Every handler verifies the caller's
 * user id matches OWNER_USER_ID before doing anything. Non-owners get a
 * generic "Not found" error so the panel's existence isn't leaked.
 */
import { createServerFn } from "@tanstack/react-start";
import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const requireOwner = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const ownerId = process.env.OWNER_USER_ID;
    if (!ownerId || context.userId !== ownerId) {
      // Same error shape regardless of cause — don't disclose panel existence.
      throw new Error("Not found");
    }
    return next();
  });

export type HqUserRow = {
  userId: string;
  email: string | null;
  fullName: string | null;
  plan: string;
  subscriptionStatus: string | null;
  suspendedAt: string | null;
  deletedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

export const hqAmOwner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return { isOwner: context.userId === process.env.OWNER_USER_ID };
  });

export const hqListUsers = createServerFn({ method: "GET" })
  .middleware([requireOwner])
  .handler(async ({ context }): Promise<HqUserRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: usersRes, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersErr) throw new Error(usersErr.message);

    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, full_name, plan, suspended_at, deleted_at");
    if (profilesErr) throw new Error(profilesErr.message);

    const { data: subs, error: subsErr } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, status");
    if (subsErr) throw new Error(subsErr.message);

    const profMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const subMap = new Map((subs ?? []).map((s) => [s.user_id, s]));

    const ownerSub = subMap.get(context.userId);
    const ownerProfile = profMap.get(context.userId);
    // Raw load signal for the admin panel. The dropdown below binds to
    // `subscriptions.plan`; `profiles.plan` is logged only to spot legacy drift.
    // eslint-disable-next-line no-console
    console.info(
      `[hq] raw plan load user=${context.userId} subscriptions.plan=${ownerSub?.plan ?? "<missing>"} subscriptions.status=${ownerSub?.status ?? "<missing>"} profiles.plan=${ownerProfile?.plan ?? "<missing>"}`,
    );

    return usersRes.users.map((u) => {
      const p = profMap.get(u.id);
      const s = subMap.get(u.id);
      return {
        userId: u.id,
        email: u.email ?? null,
        fullName: (p?.full_name as string | null) ?? (u.user_metadata?.full_name as string | null) ?? null,
        // Single source of truth for subscription gating and the admin dropdown.
        plan: (s?.plan as string | undefined) ?? "free",
        subscriptionStatus: (s?.status as string | undefined) ?? null,
        suspendedAt: (p?.suspended_at as string | null) ?? null,
        deletedAt: (p?.deleted_at as string | null) ?? null,
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      };
    });
  });

const userIdInput = z.object({ userId: z.string().uuid() });

export const hqSuspendUser = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid(), suspend: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id: data.userId, suspended_at: data.suspend ? new Date().toISOString() : null },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqSoftDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => userIdInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id: data.userId, deleted_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqRestoreUser = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => userIdInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { user_id: data.userId, deleted_at: null, suspended_at: null },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const planEnum = z.enum(["free", "solo", "firm"]);
const statusEnum = z.enum(["active", "trialing", "past_due", "canceled"]);

export const hqSetPlan = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), plan: planEnum, status: statusEnum.default("active") }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subRow, error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(
        { user_id: data.userId, plan: data.plan, status: data.status },
        { onConflict: "user_id" },
      )
      .select("plan, status")
      .single();
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("profiles")
      .upsert({ user_id: data.userId, plan: data.plan }, { onConflict: "user_id" });
    // Echo persisted values so the UI binds to the DB truth, not the
    // optimistic guess. Also lets the admin verify the write round-tripped.
    // eslint-disable-next-line no-console
    console.info(`[hq] setPlan user=${data.userId} -> plan=${subRow?.plan} status=${subRow?.status}`);
    return {
      ok: true as const,
      userId: data.userId,
      plan: (subRow?.plan as "free" | "solo" | "firm") ?? data.plan,
      status: (subRow?.status as "active" | "trialing" | "past_due" | "canceled") ?? data.status,
    };
  });

// ----- Subscriptions snapshot -----

export type HqSubsSnapshot = {
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  mrrCents: number;
  totalActive: number;
  rows: Array<{
    userId: string;
    email: string | null;
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
  }>;
};

const PLAN_PRICE_CENTS: Record<string, number> = { free: 0, solo: 1900, firm: 9900 };

export const hqListSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireOwner])
  .handler(async (): Promise<HqSubsSnapshot> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subs, error } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, plan, status, current_period_end, stripe_customer_id");
    if (error) throw new Error(error.message);

    const { data: usersRes } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const emailMap = new Map((usersRes?.users ?? []).map((u) => [u.id, u.email ?? null]));

    const byStatus: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    let mrrCents = 0;
    let totalActive = 0;
    for (const s of subs ?? []) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      byPlan[s.plan] = (byPlan[s.plan] ?? 0) + 1;
      if (s.status === "active" || s.status === "trialing") {
        totalActive += 1;
        mrrCents += PLAN_PRICE_CENTS[s.plan] ?? 0;
      }
    }
    return {
      byStatus,
      byPlan,
      mrrCents,
      totalActive,
      rows: (subs ?? []).map((s) => ({
        userId: s.user_id,
        email: emailMap.get(s.user_id) ?? null,
        plan: s.plan,
        status: s.status,
        currentPeriodEnd: s.current_period_end,
        stripeCustomerId: s.stripe_customer_id,
      })),
    };
  });

// ----- Offers -----

const offerInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  discountType: z.enum(["percent", "amount"]),
  discountValue: z.number().positive(),
  stripeCouponId: z.string().max(120).optional().nullable(),
  checkoutUrl: z.string().url().max(500).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  enabled: z.boolean().default(false),
  targetPlan: z.enum(["all", "free", "solo", "firm"]).default("all"),
});
type OfferInput = z.infer<typeof offerInput>;

function toDbOffer(d: OfferInput) {
  return {
    name: d.name,
    description: d.description ?? null,
    discount_type: d.discountType,
    discount_value: d.discountValue,
    stripe_coupon_id: d.stripeCouponId ?? null,
    checkout_url: d.checkoutUrl ?? null,
    starts_at: d.startsAt ?? null,
    ends_at: d.endsAt ?? null,
    enabled: d.enabled,
    target_plan: d.targetPlan,
  };
}

export const hqListOffers = createServerFn({ method: "GET" })
  .middleware([requireOwner])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("offers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const hqCreateOffer = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => offerInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("offers").insert(toDbOffer(data));
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqUpdateOffer = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) =>
    offerInput.partial().extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { id, ...rest } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: {
      name?: string;
      description?: string | null;
      discount_type?: "percent" | "amount";
      discount_value?: number;
      stripe_coupon_id?: string | null;
      checkout_url?: string | null;
      starts_at?: string | null;
      ends_at?: string | null;
      enabled?: boolean;
      target_plan?: "all" | "free" | "solo" | "firm";
    } = {};
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.description !== undefined) patch.description = rest.description;
    if (rest.discountType !== undefined) patch.discount_type = rest.discountType;
    if (rest.discountValue !== undefined) patch.discount_value = rest.discountValue;
    if (rest.stripeCouponId !== undefined) patch.stripe_coupon_id = rest.stripeCouponId;
    if (rest.checkoutUrl !== undefined) patch.checkout_url = rest.checkoutUrl;
    if (rest.startsAt !== undefined) patch.starts_at = rest.startsAt;
    if (rest.endsAt !== undefined) patch.ends_at = rest.endsAt;
    if (rest.enabled !== undefined) patch.enabled = rest.enabled;
    if (rest.targetPlan !== undefined) patch.target_plan = rest.targetPlan;
    const { error } = await supabaseAdmin.from("offers").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqDeleteOffer = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("offers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ----- Notifications -----

const notifInput = z.object({
  title: z.string().min(1).max(160),
  body: z.string().max(800).optional().nullable(),
  linkUrl: z.string().url().max(500).optional().nullable(),
  targetPlan: z.enum(["all", "free", "solo", "firm"]).default("all"),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  enabled: z.boolean().default(true),
});

export const hqListNotifications = createServerFn({ method: "GET" })
  .middleware([requireOwner])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const hqCreateNotification = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => notifInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("notifications").insert({
      title: data.title,
      body: data.body ?? null,
      link_url: data.linkUrl ?? null,
      target_plan: data.targetPlan,
      starts_at: data.startsAt ?? null,
      ends_at: data.endsAt ?? null,
      enabled: data.enabled,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqToggleNotification = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("notifications")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hqDeleteNotification = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("notifications").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

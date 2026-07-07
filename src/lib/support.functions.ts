/**
 * Support-request server functions — Help & Feature-request submissions.
 *
 * `submitSupportRequest` is public (works signed-out too). It writes a
 * row via the admin client (RLS-safe grants also allow anon INSERT) and
 * fires a best-effort admin email via Resend. Both failure paths are
 * swallowed so the modal never gets stuck; the user always sees a
 * confirmation.
 *
 * `hqListSupportRequests` and `hqUpdateSupportRequestStatus` are
 * owner-gated using the same OWNER_USER_ID pattern as hq.functions.ts.
 */
import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const requireOwner = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const ownerId = process.env.OWNER_USER_ID;
    if (!ownerId || context.userId !== ownerId) {
      throw new Error("Not found");
    }
    return next();
  });

const submitSchema = z.object({
  type: z.enum(["help", "feature"]),
  title: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().min(10, "Add at least a sentence").max(2000),
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email().max(200).optional().or(z.literal("")).default(""),
  page: z.string().max(300).optional().default(""),
  userAgent: z.string().max(500).optional().default(""),
});

export type SubmitSupportInput = z.infer<typeof submitSchema>;

export type SupportRow = {
  id: string;
  type: "help" | "feature";
  title: string | null;
  message: string;
  name: string | null;
  email: string | null;
  plan: string | null;
  page: string | null;
  user_agent: string | null;
  status: string;
  user_id: string | null;
  created_at: string;
};

export const submitSupportRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    // Load admin client lazily so this module stays client-graph-safe.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Best-effort: look up the signed-in user from the incoming Supabase
    // bearer token so we can attach user_id + plan. Anon submissions
    // still work; we just leave those fields null.
    let userId: string | null = null;
    let plan: string | null = null;
    try {
      // Access the request via TanStack's runtime helper.
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      const auth = req?.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token) {
        const { data: userRes } = await supabaseAdmin.auth.getUser(token);
        userId = userRes.user?.id ?? null;
        if (userId) {
          const { data: sub } = await supabaseAdmin
            .from("subscriptions")
            .select("plan")
            .eq("user_id", userId)
            .maybeSingle();
          plan = (sub?.plan as string | undefined) ?? "free";
        }
      }
    } catch {
      /* anon — no session */
    }

    const insert = {
      type: data.type,
      title: data.title || null,
      message: data.message,
      name: data.name || null,
      email: data.email || null,
      plan,
      page: data.page || null,
      user_agent: data.userAgent || null,
      user_id: userId,
    };

    try {
      const { error } = await supabaseAdmin.from("support_requests").insert(insert);
      if (error) {
        console.error("[support] insert failed", error);
      }
    } catch (err) {
      console.error("[support] insert threw", err);
    }

    // Best-effort admin email via Resend. Missing key or provider error
    // never blocks the response.
    const resendKey = process.env.RESEND_API_KEY;
    const ownerId = process.env.OWNER_USER_ID;
    if (resendKey && ownerId) {
      try {
        const { data: ownerRes } = await supabaseAdmin.auth.admin.getUserById(ownerId);
        const ownerEmail = ownerRes.user?.email;
        if (ownerEmail) {
          const subject =
            data.type === "help"
              ? `[CounselPDF] Help request from ${data.name || data.email || "user"}`
              : `[CounselPDF] Feature request — ${data.title || "(no title)"}`;
          const rows = [
            ["Type", data.type],
            ["From", `${data.name || "(anon)"} <${data.email || "(no email)"}>`],
            ["Plan", plan ?? "(unknown)"],
            ["Page", data.page || "(unknown)"],
            ["User agent", data.userAgent || "(unknown)"],
            ["User id", userId ?? "(anon)"],
          ];
          if (data.type === "feature") rows.push(["Title", data.title || "(no title)"]);
          const html = `
            <div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.5;color:#111">
              <h2 style="font-size:15px;margin:0 0 10px">${subject}</h2>
              <table style="border-collapse:collapse;margin-bottom:12px">
                ${rows
                  .map(
                    ([k, v]) =>
                      `<tr><td style="padding:2px 8px 2px 0;color:#666">${k}</td><td style="padding:2px 0">${escapeHtml(String(v))}</td></tr>`,
                  )
                  .join("")}
              </table>
              <div style="white-space:pre-wrap;border-left:3px solid #4C7FB8;padding:6px 10px;background:#f6f8fc">${escapeHtml(data.message)}</div>
            </div>
          `;
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: "CounselPDF <onboarding@resend.dev>",
              to: [ownerEmail],
              subject,
              html,
              reply_to: data.email || undefined,
            }),
          });
        }
      } catch (err) {
        console.warn("[support] admin email failed (non-fatal)", err);
      }
    }

    return { ok: true };
  });

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const hqListSupportRequests = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .handler(async (): Promise<SupportRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("support_requests")
      .select(
        "id, type, title, message, name, email, plan, page, user_agent, status, user_id, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []) as SupportRow[];
  });

const updateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in-progress", "done"]),
});

export const hqUpdateSupportRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireOwner])
  .inputValidator((input: unknown) => updateStatusSchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_requests")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

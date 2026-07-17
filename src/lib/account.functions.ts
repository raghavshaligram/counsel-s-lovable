/**
 * Account server functions — profile, email change, password set/change,
 * account deletion. All scoped to the signed-in caller via requireSupabaseAuth.
 *
 * No business data lives here. PDFMacro only stores identity + subscription
 * — documents never touch the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const nameSchema = z.object({
  fullName: z.string().trim().max(120).default(""),
});
const emailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email("Enter a valid email").max(255),
});
const pwSchema = z.object({
  newPassword: z
    .string()
    .min(8, "At least 8 characters")
    .max(128, "Too long"),
});

export type ProfileSnapshot = {
  userId: string;
  email: string | null;
  fullName: string;
  hasPassword: boolean;
  provider: string;
  createdAt: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProfileSnapshot> => {
    const {
      data: { user },
      error,
    } = await context.supabase.auth.getUser();
    if (error || !user) throw new Error("Not signed in");
    const identities = user.identities ?? [];
    const hasPassword = identities.some((i) => i.provider === "email");
    return {
      userId: user.id,
      email: user.email ?? null,
      fullName:
        ((user.user_metadata as Record<string, unknown> | null)?.full_name as
          | string
          | undefined) ?? "",
      hasPassword,
      provider: identities[0]?.provider ?? "email",
      createdAt: user.created_at ?? null,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => nameSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.auth.updateUser({
      data: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const requestMyEmailChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => emailSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.auth.updateUser({
      email: data.newEmail,
    });
    if (error) throw new Error(error.message);
    return {
      ok: true,
      message:
        "Confirmation email sent to both your old and new address. The change activates once you confirm.",
    };
  });

export const setMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pwSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.auth.updateUser({
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

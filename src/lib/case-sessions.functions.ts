/**
 * Case Sessions — cloud-synced workspace session manifests.
 *
 * Stores a small JSON manifest describing what was open in the workspace
 * (file name / size / hash, current Bates settings, etc.) so a user can
 * restore their setup after their browser cache clears. File BYTES never
 * leave the device — restoration prompts the user to re-attach the same
 * file from disk.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  manifest: jsonSchema,
  sourceName: z.string().trim().max(255).optional().nullable(),
});
const idSchema = z.object({ id: z.string().uuid() });

export type CaseSessionSummary = {
  id: string;
  name: string;
  sourceName: string | null;
  updatedAt: string;
};

export type CaseSession = CaseSessionSummary & { manifest: Json };

export const saveCaseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("case_sessions")
      .insert({
        user_id: context.userId,
        name: data.name,
        manifest: data.manifest,
        source_name: data.sourceName ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const listCaseSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaseSessionSummary[]> => {
    const { data, error } = await context.supabase
      .from("case_sessions")
      .select("id,name,source_name,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      sourceName: (r.source_name as string | null) ?? null,
      updatedAt: r.updated_at as string,
    }));
  });

export const getCaseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }): Promise<CaseSession> => {
    const { data: row, error } = await context.supabase
      .from("case_sessions")
      .select("id,name,source_name,updated_at,manifest")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      name: row.name as string,
      sourceName: (row.source_name as string | null) ?? null,
      updatedAt: row.updated_at as string,
      manifest: (row.manifest as Json) ?? {},
    };
  });

export const deleteCaseSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("case_sessions")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Workflow Builder persistence — per-user, RLS-scoped save/load/rename/delete.
 *
 * Stores ONLY the pipeline config (op sequence + params) — never document
 * bytes or the files it was authored against. Reused by the Workflow Builder
 * modal to sync "My Workflows" across devices.
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

const stepSchema = z.object({
  op: z.string().min(1).max(64),
  params: jsonSchema,
  label: z.string().max(120).optional(),
});

export type SavedWorkflowStep = z.infer<typeof stepSchema>;

export type SavedWorkflow = {
  id: string;
  name: string;
  steps: SavedWorkflowStep[];
  updatedAt: string;
};

const saveSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(120),
  steps: z.array(stepSchema).min(1).max(64),
});

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

const idSchema = z.object({ id: z.string().uuid() });

export const listWorkflows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedWorkflow[]> => {
    const { data, error } = await context.supabase
      .from("workflows")
      .select("id,name,steps,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      steps: (r.steps as SavedWorkflowStep[]) ?? [],
      updatedAt: r.updated_at as string,
    }));
  });

export const saveWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const payload = {
      user_id: context.userId,
      name: data.name,
      steps: data.steps as unknown as Json,
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("workflows")
        .update({ name: payload.name, steps: payload.steps })
        .eq("id", data.id)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id as string };
    }
    // Upsert-by-name: overwrite an existing workflow the user saves under the same name.
    const { data: existing } = await context.supabase
      .from("workflows")
      .select("id")
      .eq("user_id", context.userId)
      .ilike("name", data.name)
      .maybeSingle();
    if (existing?.id) {
      const { data: row, error } = await context.supabase
        .from("workflows")
        .update({ name: payload.name, steps: payload.steps })
        .eq("id", existing.id as string)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id as string };
    }
    const { data: row, error } = await context.supabase
      .from("workflows")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const renameWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => renameSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workflows")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("workflows")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

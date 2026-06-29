/**
 * Firm Templates — cloud-synced config presets for repeat work
 * (Bates layouts, header/footer styles, watermark/stamp presets).
 *
 * Only configuration JSON is stored — never document bytes, never
 * the actual filings the templates were authored against.
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

const templateKind = z.enum(["bates", "header-footer", "stamp"]);
export type FirmTemplateKind = z.infer<typeof templateKind>;

export type FirmTemplate = {
  id: string;
  kind: FirmTemplateKind;
  name: string;
  config: Json;
  sourceName: string | null;
  updatedAt: string;
};

const saveSchema = z.object({
  kind: templateKind,
  name: z.string().trim().min(1).max(120),
  config: jsonSchema,
  sourceName: z.string().trim().max(255).optional().nullable(),
});

const listSchema = z.object({ kind: templateKind });
const idSchema = z.object({ id: z.string().uuid() });

export const saveFirmTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("firm_templates")
      .insert({
        user_id: context.userId,
        kind: data.kind,
        name: data.name,
        config: data.config,
        source_name: data.sourceName ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const listFirmTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data, context }): Promise<FirmTemplate[]> => {
    const { data: rows, error } = await context.supabase
      .from("firm_templates")
      .select("id,kind,name,config,source_name,updated_at")
      .eq("kind", data.kind)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as FirmTemplateKind,
      name: r.name as string,
      config: (r.config as Json) ?? {},
      sourceName: (r.source_name as string | null) ?? null,
      updatedAt: r.updated_at as string,
    }));
  });

export const deleteFirmTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("firm_templates")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

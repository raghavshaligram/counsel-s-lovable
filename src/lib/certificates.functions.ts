/**
 * Compliance certificate persistence.
 *
 * Stores only what's needed to regenerate the PDF on demand —
 * counts, hashes, page totals, source file name. The sensitive
 * document content never reaches the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const certKind = z.enum(["redaction", "sanitize", "bates", "sovereignty"]);

const saveSchema = z.object({
  kind: certKind,
  sourceName: z.string().trim().min(1).max(255),
  caseLabel: z.string().trim().max(120).optional().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

const idSchema = z.object({ id: z.string().uuid() });

export type ComplianceCertKind = z.infer<typeof certKind>;

export type ComplianceCertSummary = {
  id: string;
  kind: ComplianceCertKind;
  sourceName: string;
  caseLabel: string | null;
  createdAt: string;
};

export type ComplianceCertRecord = ComplianceCertSummary & {
  payload: Record<string, unknown>;
};

export const saveCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: row, error } = await context.supabase
      .from("compliance_certificates")
      .insert({
        user_id: context.userId,
        kind: data.kind,
        source_name: data.sourceName,
        case_label: data.caseLabel ?? null,
        payload: data.payload,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const listMyCertificates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ComplianceCertSummary[]> => {
    const { data, error } = await context.supabase
      .from("compliance_certificates")
      .select("id,kind,source_name,case_label,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      kind: r.kind as ComplianceCertKind,
      sourceName: r.source_name as string,
      caseLabel: (r.case_label as string | null) ?? null,
      createdAt: r.created_at as string,
    }));
  });

export const getCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }): Promise<ComplianceCertRecord> => {
    const { data: row, error } = await context.supabase
      .from("compliance_certificates")
      .select("id,kind,source_name,case_label,created_at,payload")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      kind: row.kind as ComplianceCertKind,
      sourceName: row.source_name as string,
      caseLabel: (row.case_label as string | null) ?? null,
      createdAt: row.created_at as string,
      payload: (row.payload as Record<string, unknown>) ?? {},
    };
  });

export const deleteCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("compliance_certificates")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

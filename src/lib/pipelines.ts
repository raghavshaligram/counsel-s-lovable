// JSON pipelines: serialized sequences of tool invocations that can be
// shared, version-pinned, and replayed. Pipelines are pure data so they
// can live in localStorage, ship with a doc, or be pasted in chat.

import { z } from "zod";

export const PipelineSchema = z.object({
  $schema: z.literal("vaultpdf.pipeline/1"),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z
    .array(
      z.object({
        tool: z.string(),
        args: z.record(z.unknown()).default({}),
        confirm: z.boolean().optional(),
      }),
    )
    .min(1),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

const KEY = "vaultpdf.pipelines";

export function listPipelines(): Pipeline[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((p) => PipelineSchema.parse(p)) : [];
  } catch {
    return [];
  }
}

export function savePipeline(p: Pipeline): void {
  const all = listPipelines().filter((x) => x.name !== p.name);
  all.push(PipelineSchema.parse(p));
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deletePipeline(name: string): void {
  const all = listPipelines().filter((x) => x.name !== name);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function parsePipeline(json: string): Pipeline {
  return PipelineSchema.parse(JSON.parse(json));
}

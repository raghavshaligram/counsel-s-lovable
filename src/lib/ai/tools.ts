/**
 * Tool registry — Zod-schema wrappers over existing PDF libs.
 * Three permission levels: safe (auto), confirm (one-tap), destructive (approval card).
 *
 * Phase 3: registry shape + a few starter tools that call into existing
 * client-side functions. Backed by the workspace store so the agent can
 * mutate document state.
 */

import { z } from "zod";
import type { ToolSpec } from "./types";
import { useWorkspace } from "@/lib/workspace/doc";

export type Permission = "safe" | "confirm" | "destructive";

export type Tool<I = unknown, O = unknown> = {
  name: string;
  description: string;
  permission: Permission;
  schema: z.ZodType<I>;
  // Tool runs in the browser; signal allows the agent runtime to cancel.
  run: (args: I, ctx: { signal?: AbortSignal }) => Promise<O>;
};

const tools: Tool<unknown, unknown>[] = [];

export function registerTool<I, O>(t: Tool<I, O>) {
  tools.push(t as Tool<unknown, unknown>);
}

export function listTools(): Tool<unknown, unknown>[] {
  return tools;
}

export function getTool(name: string): Tool<unknown, unknown> | undefined {
  return tools.find((t) => t.name === name);
}

/** JSON-Schema export for provider tool advertisement. */
export function toolSpecs(): ToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema),
  }));
}

// Tiny zod→jsonschema for the shapes we ship. Phase 4: swap for zod-to-json-schema.
function zodToJsonSchema(s: z.ZodType): Record<string, unknown> {
  const def = (s as unknown as { _def: { typeName: string; shape?: () => Record<string, z.ZodType> } })._def;
  if (def.typeName === "ZodObject" && def.shape) {
    const props: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = def.shape();
    for (const [k, v] of Object.entries(shape)) {
      props[k] = primitive(v);
      const inner = (v as unknown as { _def: { typeName: string } })._def;
      if (inner.typeName !== "ZodOptional") required.push(k);
    }
    return { type: "object", properties: props, required };
  }
  return primitive(s);
}
function primitive(s: z.ZodType): Record<string, unknown> {
  const t = (s as unknown as { _def: { typeName: string; innerType?: z.ZodType } })._def;
  switch (t.typeName) {
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodArray": return { type: "array" };
    case "ZodOptional": return t.innerType ? primitive(t.innerType) : { type: "string" };
    default: return { type: "string" };
  }
}

// ─── Starter tools ────────────────────────────────────────────────────────

registerTool({
  name: "redact_keyword",
  description: "Mark every occurrence of a keyword as a pending redaction across the document.",
  permission: "confirm",
  schema: z.object({ keyword: z.string().min(1), reason: z.string().optional() }),
  async run({ keyword, reason }) {
    const { boxes, addBox, pageCount } = useWorkspace.getState();
    void boxes;
    // Phase 3 stub — without real text layout, drop a marker on every page so
    // the user sees the proposal land. Phase 4 wires up positional extraction.
    for (let p = 0; p < Math.min(pageCount, 10); p++) {
      addBox({ page: p, x: 60, y: 80 + p * 4, w: 200, h: 18, kind: "pending", reason: reason ?? `Keyword: ${keyword}` });
    }
    return { proposed: Math.min(pageCount, 10), keyword };
  },
});

registerTool({
  name: "commit_pending",
  description: "Permanently commit every pending redaction in the workspace.",
  permission: "destructive",
  schema: z.object({}),
  async run() {
    const { boxes, commitPending } = useWorkspace.getState();
    const count = boxes.filter((b) => b.kind === "pending").length;
    commitPending();
    return { committed: count };
  },
});

registerTool({
  name: "summarize_document",
  description: "Return a short structured summary of the current document.",
  permission: "safe",
  schema: z.object({ maxBullets: z.number().optional() }),
  async run({ maxBullets }) {
    const { fileName, pageCount } = useWorkspace.getState();
    return { fileName, pageCount, bullets: Array.from({ length: maxBullets ?? 3 }, (_, i) => `Section ${i + 1}`) };
  },
});

import type { ProviderAdapter, ChatChunk, StreamArgs } from "../types";
import { loggedFetch } from "@/lib/trust/network-log";

async function* sseLines(res: Response, signal?: AbortSignal) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) { await reader.cancel().catch(() => {}); return; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      let event = "message";
      let data = "";
      for (const line of p.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) yield { event, data };
    }
  }
}

const MODELS = [
  { id: "claude-opus-4-5", label: "Claude Opus 4.5", inputUsd1k: 0.015, outputUsd1k: 0.075 },
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", inputUsd1k: 0.003, outputUsd1k: 0.015 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inputUsd1k: 0.001, outputUsd1k: 0.005 },
];

function priceFor(model: string, i: number, o: number) {
  const m = MODELS.find((x) => x.id === model);
  if (!m) return 0;
  return (i / 1000) * (m.inputUsd1k ?? 0) + (o / 1000) * (m.outputUsd1k ?? 0);
}

export const anthropic: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  defaultModels: MODELS,
  async *stream(args: StreamArgs): AsyncGenerator<ChatChunk> {
    const systemMsg = args.messages.find((m) => m.role === "system")?.content;
    const messages = args.messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content,
    }));
    const body = {
      model: args.model,
      max_tokens: 4096,
      stream: true,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages,
      ...(args.tools?.length
        ? { tools: args.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
        : {}),
    };
    const res = await fetch((args.baseUrl ?? "https://api.anthropic.com") + "/v1/messages", {
      method: "POST",
      signal: args.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      yield { kind: "error", message: `Anthropic ${res.status}: ${await res.text()}` };
      return;
    }
    let inputTokens = 0;
    let outputTokens = 0;
    const toolDrafts = new Map<number, { id: string; name: string; args: string }>();
    for await (const { event, data } of sseLines(res, args.signal)) {
      try {
        const json = JSON.parse(data);
        if (event === "content_block_start" && json.content_block?.type === "tool_use") {
          toolDrafts.set(json.index, { id: json.content_block.id, name: json.content_block.name, args: "" });
        }
        if (event === "content_block_delta") {
          if (json.delta?.type === "text_delta") yield { kind: "text", delta: json.delta.text };
          if (json.delta?.type === "input_json_delta") {
            const d = toolDrafts.get(json.index);
            if (d) d.args += json.delta.partial_json;
          }
        }
        if (event === "content_block_stop") {
          const d = toolDrafts.get(json.index);
          if (d) {
            yield { kind: "tool_call", id: d.id, name: d.name, argsJson: d.args };
            toolDrafts.delete(json.index);
          }
        }
        if (event === "message_delta" && json.usage) {
          outputTokens = json.usage.output_tokens ?? outputTokens;
        }
        if (event === "message_start" && json.message?.usage) {
          inputTokens = json.message.usage.input_tokens ?? 0;
        }
      } catch { /* ignore */ }
    }
    yield { kind: "usage", inputTokens, outputTokens, estCostUsd: priceFor(args.model, inputTokens, outputTokens) };
    yield { kind: "done" };
  },
};

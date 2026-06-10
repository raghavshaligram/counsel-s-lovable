import type { ProviderAdapter, ChatChunk, StreamArgs } from "../types";
import { loggedFetch } from "@/lib/trust/network-log";

async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      for (const line of p.split("\n")) {
        if (line.startsWith("data: ")) yield line.slice(6);
      }
    }
  }
}

function priceFor(model: string, inputTokens: number, outputTokens: number) {
  const m = MODELS.find((x) => x.id === model);
  if (!m) return 0;
  return (inputTokens / 1000) * (m.inputUsd1k ?? 0) + (outputTokens / 1000) * (m.outputUsd1k ?? 0);
}

const MODELS = [
  { id: "gpt-5", label: "GPT-5", inputUsd1k: 0.005, outputUsd1k: 0.015 },
  { id: "gpt-5-mini", label: "GPT-5 mini", inputUsd1k: 0.0003, outputUsd1k: 0.0012 },
  { id: "gpt-4o", label: "GPT-4o", inputUsd1k: 0.0025, outputUsd1k: 0.01 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", inputUsd1k: 0.00015, outputUsd1k: 0.0006 },
];

export const openai: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  defaultModels: MODELS,
  async *stream(args: StreamArgs): AsyncGenerator<ChatChunk> {
    const url = (args.baseUrl ?? "https://api.openai.com") + "/v1/chat/completions";
    const body = {
      model: args.model,
      stream: true,
      messages: args.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId, name: m.toolName } : {}),
      })),
      ...(args.tools?.length
        ? {
            tools: args.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      stream_options: { include_usage: true },
    };
    const res = await loggedFetch("openai", url, {
      method: "POST",
      signal: args.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
      model: args.model,
    });
    if (!res.ok) {
      yield { kind: "error", message: `OpenAI ${res.status}: ${await res.text()}` };
      return;
    }
    const pendingToolCalls = new Map<number, { id: string; name: string; args: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const data of sseLines(res, args.signal)) {
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data);
        const choice = json.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) yield { kind: "text", delta: delta.content };
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = pendingToolCalls.get(idx) ?? { id: tc.id ?? "", name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            pendingToolCalls.set(idx, cur);
          }
        }
        if (choice?.finish_reason === "tool_calls") {
          for (const tc of pendingToolCalls.values()) {
            yield { kind: "tool_call", id: tc.id, name: tc.name, argsJson: tc.args };
          }
          pendingToolCalls.clear();
        }
        if (json.usage) {
          inputTokens = json.usage.prompt_tokens ?? 0;
          outputTokens = json.usage.completion_tokens ?? 0;
        }
      } catch {
        // ignore malformed chunk
      }
    }
    yield {
      kind: "usage",
      inputTokens,
      outputTokens,
      estCostUsd: priceFor(args.model, inputTokens, outputTokens),
    };
    yield { kind: "done" };
  },
};

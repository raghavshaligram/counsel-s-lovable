import type { ProviderAdapter, ChatChunk, StreamArgs } from "../types";

/**
 * Ollama — local-first. No API key needed; we still accept one for
 * authenticated reverse-proxy setups. baseUrl defaults to localhost.
 */
export const ollama: ProviderAdapter = {
  id: "ollama",
  label: "Ollama (local)",
  defaultModels: [
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "qwen2.5", label: "Qwen 2.5" },
    { id: "mistral", label: "Mistral" },
  ],
  async *stream(args: StreamArgs): AsyncGenerator<ChatChunk> {
    const url = (args.baseUrl ?? "http://localhost:11434") + "/api/chat";
    const res = await fetch(url, {
      method: "POST",
      signal: args.signal,
      headers: {
        "content-type": "application/json",
        ...(args.apiKey ? { authorization: `Bearer ${args.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: args.model,
        stream: true,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok || !res.body) {
      yield { kind: "error", message: `Ollama ${res.status}: ${await res.text().catch(() => "no body")}` };
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let inputTokens = 0;
    let outputTokens = 0;
    while (true) {
      if (args.signal?.aborted) { await reader.cancel().catch(() => {}); break; }
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) yield { kind: "text", delta: json.message.content };
          if (json.done) {
            inputTokens = json.prompt_eval_count ?? 0;
            outputTokens = json.eval_count ?? 0;
          }
        } catch { /* ignore */ }
      }
    }
    yield { kind: "usage", inputTokens, outputTokens, estCostUsd: 0 };
    yield { kind: "done" };
  },
};

/** Auto-probe Ollama on localhost:11434. Returns true if reachable. */
export async function probeOllama(baseUrl = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(baseUrl + "/api/tags", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

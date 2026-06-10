/**
 * Normalized provider adapter interface.
 * Every provider exports a `stream()` that yields a unified ChatChunk shape,
 * so the agent runtime / UI never branch on provider.
 *
 * Browser → provider direct. Keys never leave the device unencrypted.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  // JSON Schema describing parameters
  parameters: Record<string, unknown>;
};

export type ChatChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool_call"; id: string; name: string; argsJson: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number; estCostUsd: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type StreamArgs = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  model: string;
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

export type ProviderAdapter = {
  id: ProviderId;
  label: string;
  defaultModels: { id: string; label: string; inputUsd1k?: number; outputUsd1k?: number }[];
  stream: (args: StreamArgs) => AsyncGenerator<ChatChunk, void, unknown>;
};

export type ProviderId = "openai" | "anthropic" | "google" | "ollama" | "openai-compatible";

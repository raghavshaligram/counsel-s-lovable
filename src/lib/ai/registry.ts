import type { ProviderAdapter, ProviderId } from "./types";
import { openai } from "./providers/openai";
import { anthropic } from "./providers/anthropic";
import { ollama } from "./providers/ollama";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai,
  anthropic,
  google: openai, // TODO: Phase 4 — Gemini-native adapter
  ollama,
  "openai-compatible": openai,
};

export function getAdapter(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id];
}

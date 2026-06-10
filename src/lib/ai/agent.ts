/**
 * Agent runtime — state machine with AbortSignal cancellation and cost meter.
 *
 *   idle → thinking → tool_pending → tool_running → streaming → idle
 *                                                  ↘ error  ↗
 *
 * Phase 3: single-turn chat with optional tool-call loop. Chunk & Map (A3.1)
 * lands in Phase 4 once real text extraction is wired.
 */

import { create } from "zustand";
import type { ChatMessage, ChatChunk, ToolSpec } from "./types";
import { getAdapter } from "./registry";
import { activeProvider } from "./keys";
import { getTool, toolSpecs } from "./tools";

export type AgentPhase = "idle" | "thinking" | "tool_pending" | "tool_running" | "streaming" | "error";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  cost?: number;
  tokens?: number;
  state?: "queued" | "streaming" | "settled";
  pendingApproval?: { toolName: string; args: unknown; permission: "confirm" | "destructive" };
};

type AgentState = {
  phase: AgentPhase;
  turns: ChatTurn[];
  totalCost: number;
  totalTokens: number;
  liveCost: number;
  liveTokens: number;
  liveState: "queued" | "streaming" | "settled";
  abort?: AbortController;
  send: (text: string) => Promise<void>;
  approve: (turnId: string) => Promise<void>;
  reject: (turnId: string) => void;
  cancel: () => void;
  reset: () => void;
};

export const useAgent = create<AgentState>((set, get) => ({
  phase: "idle",
  turns: [],
  totalCost: 0,
  totalTokens: 0,
  liveCost: 0,
  liveTokens: 0,
  liveState: "settled",

  async send(text) {
    const provider = activeProvider();
    if (!provider) {
      set((s) => ({
        turns: [...s.turns, { id: crypto.randomUUID(), role: "assistant", text: "No AI provider configured. Open /vault to add one." }],
      }));
      return;
    }
    const adapter = getAdapter(provider.id);

    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text };
    const asstTurn: ChatTurn = { id: crypto.randomUUID(), role: "assistant", text: "", state: "queued" };
    set((s) => ({
      turns: [...s.turns, userTurn, asstTurn],
      phase: "thinking",
      liveCost: 0,
      liveTokens: 0,
      liveState: "queued",
    }));

    const abort = new AbortController();
    set({ abort });

    const messages: ChatMessage[] = get().turns
      .filter((t) => t.role !== "tool" || t.toolResult)
      .map((t) => ({
        role: t.role,
        content: t.role === "tool" ? JSON.stringify(t.toolResult ?? null) : t.text,
        ...(t.role === "tool" && t.toolName ? { toolName: t.toolName } : {}),
      }));

    const specs: ToolSpec[] = toolSpecs();

    try {
      const stream = adapter.stream({
        messages,
        tools: specs,
        model: provider.model,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        signal: abort.signal,
      });

      set({ phase: "streaming", liveState: "streaming" });

      let accText = "";
      const toolCalls: { id: string; name: string; argsJson: string }[] = [];

      for await (const chunk of stream as AsyncGenerator<ChatChunk>) {
        if (chunk.kind === "text") {
          accText += chunk.delta;
          set((s) => ({
            turns: s.turns.map((t) => (t.id === asstTurn.id ? { ...t, text: accText, state: "streaming" } : t)),
          }));
        } else if (chunk.kind === "tool_call") {
          toolCalls.push({ id: chunk.id, name: chunk.name, argsJson: chunk.argsJson });
        } else if (chunk.kind === "usage") {
          set({ liveCost: chunk.estCostUsd, liveTokens: chunk.inputTokens + chunk.outputTokens });
        } else if (chunk.kind === "error") {
          set((s) => ({
            phase: "error",
            turns: s.turns.map((t) => (t.id === asstTurn.id ? { ...t, text: chunk.message } : t)),
          }));
          return;
        }
      }

      // Settle cost on this turn.
      const { liveCost, liveTokens } = get();
      set((s) => ({
        totalCost: s.totalCost + liveCost,
        totalTokens: s.totalTokens + liveTokens,
        liveState: "settled",
        turns: s.turns.map((t) =>
          t.id === asstTurn.id ? { ...t, cost: liveCost, tokens: liveTokens, state: "settled" } : t
        ),
      }));

      // Surface tool calls as approval cards (confirm/destructive) or auto-run (safe).
      for (const tc of toolCalls) {
        const tool = getTool(tc.name);
        if (!tool) continue;
        let parsed: unknown = {};
        try { parsed = JSON.parse(tc.argsJson || "{}"); } catch { /* ignore */ }
        if (tool.permission === "safe") {
          set({ phase: "tool_running" });
          try {
            const result = await tool.run(parsed, { signal: abort.signal });
            set((s) => ({
              turns: [...s.turns, { id: crypto.randomUUID(), role: "tool", text: `Ran ${tc.name}`, toolName: tc.name, toolArgs: parsed, toolResult: result }],
            }));
          } catch (e) {
            set((s) => ({ phase: "error", turns: [...s.turns, { id: crypto.randomUUID(), role: "assistant", text: `Tool failed: ${(e as Error).message}` }] }));
          }
        } else {
          set((s) => ({
            phase: "tool_pending",
            turns: [...s.turns, {
              id: crypto.randomUUID(),
              role: "tool",
              text: `Proposed ${tc.name}`,
              toolName: tc.name,
              toolArgs: parsed,
              pendingApproval: { toolName: tc.name, args: parsed, permission: tool.permission as "confirm" | "destructive" },
            }],
          }));
        }
      }

      if (get().phase !== "tool_pending") set({ phase: "idle" });
    } catch (e) {
      set({ phase: "error" });
      const msg = (e as Error).name === "AbortError" ? "Cancelled." : `Error: ${(e as Error).message}`;
      set((s) => ({ turns: s.turns.map((t) => (t.id === asstTurn.id ? { ...t, text: msg } : t)) }));
    }
  },

  async approve(turnId) {
    const turn = get().turns.find((t) => t.id === turnId);
    if (!turn?.pendingApproval) return;
    const tool = getTool(turn.pendingApproval.toolName);
    if (!tool) return;
    set({ phase: "tool_running" });
    try {
      const result = await tool.run(turn.pendingApproval.args, { signal: get().abort?.signal });
      set((s) => ({
        phase: "idle",
        turns: s.turns.map((t) => (t.id === turnId ? { ...t, pendingApproval: undefined, toolResult: result, text: `Ran ${tool.name}` } : t)),
      }));
    } catch (e) {
      set((s) => ({
        phase: "error",
        turns: s.turns.map((t) => (t.id === turnId ? { ...t, pendingApproval: undefined, text: `Tool failed: ${(e as Error).message}` } : t)),
      }));
    }
  },

  reject(turnId) {
    set((s) => ({
      phase: "idle",
      turns: s.turns.map((t) => (t.id === turnId ? { ...t, pendingApproval: undefined, text: `Declined ${t.toolName}` } : t)),
    }));
  },

  cancel() {
    get().abort?.abort();
    set({ phase: "idle" });
  },

  reset() {
    set({ phase: "idle", turns: [], liveCost: 0, liveTokens: 0, liveState: "settled" });
  },
}));

export type ChatRuntime = "webgpu" | "wasm";

export async function detectRuntime(): Promise<ChatRuntime> {
  if (typeof navigator === "undefined") return "wasm";
  const gpu = (navigator as any).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

export function approxDeviceMemoryGB(): number | null {
  if (typeof navigator === "undefined") return null;
  const m = (navigator as any).deviceMemory;
  return typeof m === "number" ? m : null;
}

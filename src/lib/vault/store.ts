/**
 * Vault store — main-thread facade over crypto-worker.
 * Holds only opaque handle IDs; raw keys never enter React state.
 *
 * A0.3 Multi-tab coordination: BroadcastChannel + navigator.locks wiring in Phase 2.
 */

type WorkerMsg = { id: number; ok: boolean; result?: unknown; error?: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./crypto-worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (ev: MessageEvent<WorkerMsg>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ok) p.resolve(ev.data.result);
    else p.reject(new Error(ev.data.error ?? "vault worker error"));
  });
  return worker;
}

function call<T = unknown>(payload: unknown): Promise<T> {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, payload });
  });
}

export type VaultHandle = number;

export async function unlockWithPassphrase(passphrase: string, salt: Uint8Array): Promise<VaultHandle> {
  const enc = new TextEncoder().encode(passphrase);
  const { handle } = await call<{ handle: VaultHandle }>({
    op: "unlock",
    mode: "passphrase",
    material: enc.buffer,
    salt: salt.buffer,
  });
  return handle;
}

export async function unlockWithPasskey(prfOutput: ArrayBuffer): Promise<VaultHandle> {
  const { handle } = await call<{ handle: VaultHandle }>({
    op: "unlock",
    mode: "passkey",
    material: prfOutput,
  });
  return handle;
}

export async function lockVault() {
  if (!worker) return;
  await call({ op: "lock" });
  worker.terminate();
  worker = null;
}

export async function vaultStatus() {
  if (!worker) return { unlocked: false, hasSigningKey: false };
  return call<{ unlocked: boolean; hasSigningKey: boolean }>({ op: "status" });
}

export async function wrap(handle: VaultHandle, data: ArrayBuffer) {
  return call<{ iv: ArrayBuffer; ct: ArrayBuffer }>({ op: "wrap", handle, data });
}

// Listen for global lock command (⌘K → Lock Vault)
if (typeof window !== "undefined") {
  window.addEventListener("vault:lock", () => {
    void lockVault();
  });
}

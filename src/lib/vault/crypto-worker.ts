/**
 * crypto-worker — A0.2 Key isolation.
 *
 * Raw CryptoKey material and private hex live ONLY inside this worker as
 * module-scoped, non-exported variables. Main thread holds opaque handle IDs
 * (numeric, unforgeable within session) and posts ops in.
 *
 * Skeleton — full PRF + PBKDF2 unlock wired in Phase 2.
 */

type Handle = number;

const keys = new Map<Handle, CryptoKey>();
const ed25519: { pub?: Uint8Array; priv?: Uint8Array } = {};
let nextHandle: Handle = 1;

type Op =
  | { op: "unlock"; mode: "passkey" | "passphrase"; material: ArrayBuffer; salt?: ArrayBuffer }
  | { op: "wrap"; handle: Handle; data: ArrayBuffer }
  | { op: "unwrap"; handle: Handle; data: ArrayBuffer }
  | { op: "sign"; data: ArrayBuffer }
  | { op: "lock" }
  | { op: "status" };

self.addEventListener("message", async (ev: MessageEvent<{ id: number; payload: Op }>) => {
  const { id, payload } = ev.data;
  try {
    const result = await handle(payload);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error).message ?? err) });
  }
});

async function handle(op: Op): Promise<unknown> {
  switch (op.op) {
    case "unlock": {
      let vaultKey: CryptoKey;
      if (op.mode === "passphrase") {
        const passKey = await crypto.subtle.importKey(
          "raw",
          op.material,
          "PBKDF2",
          false,
          ["deriveKey"]
        );
        vaultKey = await crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: op.salt!, iterations: 600_000, hash: "SHA-256" },
          passKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
      } else {
        // passkey PRF output is already 32 bytes of high-entropy material
        vaultKey = await crypto.subtle.importKey(
          "raw",
          op.material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
      }
      const h = nextHandle++;
      keys.set(h, vaultKey);
      return { handle: h };
    }
    case "wrap": {
      const k = keys.get(op.handle);
      if (!k) throw new Error("Invalid handle");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, op.data);
      return { iv: iv.buffer, ct };
    }
    case "unwrap": {
      const k = keys.get(op.handle);
      if (!k) throw new Error("Invalid handle");
      const view = new Uint8Array(op.data);
      const iv = view.slice(0, 12);
      const ct = view.slice(12);
      return await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
    }
    case "sign": {
      // Stub: Ed25519 signing wired in Phase 2 with @noble/curves
      if (!ed25519.priv) throw new Error("No signing key");
      return new Uint8Array(64); // placeholder
    }
    case "lock": {
      keys.clear();
      ed25519.priv = undefined;
      ed25519.pub = undefined;
      return { ok: true };
    }
    case "status": {
      return { unlocked: keys.size > 0, hasSigningKey: !!ed25519.priv };
    }
  }
}

export {};

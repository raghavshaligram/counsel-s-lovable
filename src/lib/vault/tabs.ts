/**
 * A0.3 Multi-tab coordination.
 *
 * - `navigator.locks.request("vault-unlock", …)` serializes the unlock dialog
 *   so only one tab prompts at a time.
 * - `BroadcastChannel("vault-session")` lets an already-unlocked tab seal the
 *   session key to a newly-opened tab's ephemeral X25519 pubkey, so the new
 *   tab unlocks without re-prompting biometrics.
 *
 * Phase 2: BroadcastChannel + locks plumbing. The actual X25519 seal happens
 * inside the crypto-worker; this module is the main-thread coordinator.
 */

import { x25519 } from "@noble/curves/ed25519";

type SessionRequest = { kind: "request"; tabId: string; pub: Uint8Array };
type SessionOffer = { kind: "offer"; toTabId: string; sealedKey: Uint8Array; ephPub: Uint8Array };

const CHANNEL = "vault-session";

export type TabKeypair = { pub: Uint8Array; priv: Uint8Array; tabId: string };

export function makeTabKeypair(): TabKeypair {
  const priv = crypto.getRandomValues(new Uint8Array(32));
  const pub = x25519.getPublicKey(priv);
  const tabId = crypto.randomUUID();
  return { pub, priv, tabId };
}

export function announceTab(tab: TabKeypair, onOffer: (msg: SessionOffer) => void) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (ev: MessageEvent<SessionRequest | SessionOffer>) => {
    if (ev.data.kind === "offer" && ev.data.toTabId === tab.tabId) {
      onOffer(ev.data);
    }
  };
  const req: SessionRequest = { kind: "request", tabId: tab.tabId, pub: tab.pub };
  ch.postMessage(req);
  return () => ch.close();
}

export async function serializeUnlock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request("vault-unlock", fn);
}

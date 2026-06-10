// Tamper-evident export: produces a sidecar JSON with SHA-256 of the
// exported file plus an Ed25519 signature, so anyone with the public key
// can verify nothing was modified after signing.

import { ed25519 } from "@noble/curves/ed25519.js";

export type Certificate = {
  version: 1;
  file: { name: string; bytes: number; sha256: string };
  signedAt: string;
  alg: "Ed25519";
  publicKeyHex: string;
  signatureHex: string;
  exemptions?: string[];
  notes?: string;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view); // ensure plain ArrayBuffer backing
  const hash = await crypto.subtle.digest("SHA-256", copy);
  return toHex(new Uint8Array(hash));
}

/**
 * Sign a file's bytes with the vault's Ed25519 signing key and return a
 * sidecar Certificate. The certificate is a small JSON document; ship it
 * alongside the file as `<name>.certificate.json`.
 */
export async function signExport(opts: {
  fileName: string;
  bytes: Uint8Array;
  privateKeyHex: string;
  exemptions?: string[];
  notes?: string;
}): Promise<Certificate> {
  const sha = await sha256(opts.bytes);
  const privKey = fromHex(opts.privateKeyHex);
  const pubKey = ed25519.getPublicKey(privKey);
  // Sign hash bytes (32 bytes), not the whole file.
  const sig = ed25519.sign(fromHex(sha), privKey);
  return {
    version: 1,
    file: { name: opts.fileName, bytes: opts.bytes.length, sha256: sha },
    signedAt: new Date().toISOString(),
    alg: "Ed25519",
    publicKeyHex: toHex(pubKey),
    signatureHex: toHex(sig),
    exemptions: opts.exemptions,
    notes: opts.notes,
  };
}

export async function verifyExport(bytes: Uint8Array, cert: Certificate): Promise<{ ok: boolean; reason?: string }> {
  const sha = await sha256(bytes);
  if (sha !== cert.file.sha256) return { ok: false, reason: "hash mismatch" };
  try {
    const ok = ed25519.verify(fromHex(cert.signatureHex), fromHex(sha), fromHex(cert.publicKeyHex));
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Trigger a browser download for both the file and its sidecar certificate.
 */
export function downloadWithCertificate(fileName: string, bytes: Uint8Array, cert: Certificate) {
  const pdfBlob = new Blob([bytes], { type: "application/pdf" });
  const certBlob = new Blob([JSON.stringify(cert, null, 2)], { type: "application/json" });
  triggerDownload(pdfBlob, fileName);
  triggerDownload(certBlob, fileName.replace(/\.pdf$/i, "") + ".certificate.json");
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * On-device named signature library — IndexedDB via idb-keyval.
 * Nothing here ever touches the network.
 */
import { get, set } from "idb-keyval";

export type StoredSignature = {
  id: string;
  name: string;
  pngDataUrl: string;
  aspect: number;
  createdAt: number;
};

const KEY = "counselpdf.signatures.v1";

export async function listSignatures(): Promise<StoredSignature[]> {
  try {
    const v = (await get<StoredSignature[]>(KEY)) ?? [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function saveSignature(s: Omit<StoredSignature, "id" | "createdAt"> & { id?: string }): Promise<StoredSignature[]> {
  const list = await listSignatures();
  const entry: StoredSignature = {
    id: s.id ?? Math.random().toString(36).slice(2, 10),
    name: s.name.trim() || "Signature",
    pngDataUrl: s.pngDataUrl,
    aspect: s.aspect,
    createdAt: Date.now(),
  };
  const next = [entry, ...list.filter((x) => x.id !== entry.id)];
  await set(KEY, next);
  return next;
}

export async function deleteSignature(id: string): Promise<StoredSignature[]> {
  const list = await listSignatures();
  const next = list.filter((x) => x.id !== id);
  await set(KEY, next);
  return next;
}

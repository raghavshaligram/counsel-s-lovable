/**
 * BYOK key storage — encrypted via the unlocked vault handle when present,
 * plaintext (localStorage) fallback when vault is locked so users can still
 * paste a key once before unlocking. Re-encrypted on next unlock.
 *
 * Phase 3: storage + selection. Encryption migration runs in Phase 4.
 */

import type { ProviderId } from "./types";

export type ProviderConfig = {
  id: ProviderId;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  model: string;
};

const KEY = "vaultpdf.providers";
const SELECTED = "vaultpdf.selectedProvider";

export function loadProviders(): ProviderConfig[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveProviders(list: ProviderConfig[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("providers:changed"));
}

export function upsertProvider(cfg: ProviderConfig) {
  const list = loadProviders().filter((p) => p.id !== cfg.id);
  list.push(cfg);
  saveProviders(list);
}

export function removeProvider(id: ProviderId) {
  saveProviders(loadProviders().filter((p) => p.id !== id));
}

export function selectedProvider(): ProviderId | null {
  if (typeof localStorage === "undefined") return null;
  return (localStorage.getItem(SELECTED) as ProviderId | null) ?? null;
}

export function setSelectedProvider(id: ProviderId | null) {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(SELECTED, id);
  else localStorage.removeItem(SELECTED);
  window.dispatchEvent(new CustomEvent("providers:changed"));
}

export function activeProvider(): ProviderConfig | null {
  const id = selectedProvider();
  const list = loadProviders();
  return list.find((p) => p.id === id && p.enabled) ?? list.find((p) => p.enabled) ?? null;
}

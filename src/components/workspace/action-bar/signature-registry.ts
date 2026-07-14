/**
 * Lightweight in-memory registry of image dataUrls that were placed via
 * Sign & Fill. The Intelligent Action Bar checks this registry to decide
 * whether a selected image annotation should show the Signature primary
 * action set instead of the plain Image set.
 *
 * We can't tag the annotation itself at insertion time because that path
 * lives in editor-canvas.tsx (off-limits) and the reducer types (also
 * off-limits). This module-level Set is populated when Sign & Fill arms a
 * signature; the bar reads it by dataUrl.
 */

const registry = new Set<string>();

export function markSignatureDataUrl(dataUrl: string): void {
  registry.add(dataUrl);
}

export function isSignatureDataUrl(dataUrl: string | undefined): boolean {
  if (!dataUrl) return false;
  return registry.has(dataUrl);
}

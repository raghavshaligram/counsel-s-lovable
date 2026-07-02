// Offline isolation guard.
//
// When "Offline — Isolated" is on, wraps window.fetch (and XMLHttpRequest)
// so any CROSS-ORIGIN outbound request is rejected before it hits the
// network, and every attempt is counted. Same-origin requests are allowed
// through so the service worker can serve cached JS/WASM/fonts/etc — they
// never leave the browser.
//
// Also queries the service worker cache to verify the app shell + hashed
// assets are present, so we don't switch to isolated mode when a reload
// would still hit the network.

let installed = false;
let blockedCount = 0;
let allowedSameOriginCount = 0;
const listeners = new Set<(state: OfflineGuardState) => void>();

export type OfflineGuardState = {
  active: boolean;
  blocked: number;
  allowed: number;
};

function emit() {
  const state = getState();
  for (const l of listeners) l(state);
}

export function getState(): OfflineGuardState {
  return { active: installed, blocked: blockedCount, allowed: allowedSameOriginCount };
}

export function subscribe(fn: (state: OfflineGuardState) => void): () => void {
  listeners.add(fn);
  fn(getState());
  return () => {
    listeners.delete(fn);
  };
}

let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;

function isSameOrigin(url: string): boolean {
  try {
    const u = new URL(url, location.href);
    // Local-only schemes carry no network traffic — always allow so
    // on-device pipelines (pdf-lib re-fetching a data-URL image, blob
    // downloads, workers, filesystem: URLs) keep working offline.
    if (
      u.protocol === "blob:" ||
      u.protocol === "data:" ||
      u.protocol === "filesystem:" ||
      u.protocol === "chrome-extension:" ||
      u.protocol === "moz-extension:"
    ) {
      return true;
    }
    return u.origin === location.origin;
  } catch {
    return true; // relative → same origin
  }
}

export function installOfflineGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  blockedCount = 0;
  allowedSameOriginCount = 0;

  originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (isSameOrigin(url)) {
      allowedSameOriginCount++;
      emit();
      return originalFetch!(input, init);
    }
    blockedCount++;
    emit();
    return Promise.reject(
      new Error(`Blocked by Offline Isolation: ${new URL(url, location.href).host}`),
    );
  }) as typeof window.fetch;

  originalXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const asStr = typeof url === "string" ? url : url.toString();
    if (!isSameOrigin(asStr)) {
      blockedCount++;
      emit();
      throw new Error(
        `Blocked by Offline Isolation: ${new URL(asStr, location.href).host}`,
      );
    }
    allowedSameOriginCount++;
    emit();
    // @ts-expect-error — passthrough to original signature
    return originalXhrOpen!.call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  emit();
}

export function uninstallOfflineGuard() {
  if (!installed || typeof window === "undefined") return;
  if (originalFetch) window.fetch = originalFetch;
  if (originalXhrOpen) XMLHttpRequest.prototype.open = originalXhrOpen;
  originalFetch = null;
  originalXhrOpen = null;
  installed = false;
  emit();
}

/**
 * Check whether the service worker has cached enough of the app to run
 * without network. Requires an active SW controller and a non-trivial
 * asset cache.
 */
export async function verifyOfflineReadiness(): Promise<{
  ready: boolean;
  reason?: string;
}> {
  if (typeof window === "undefined") return { ready: false, reason: "no-window" };
  if (!("serviceWorker" in navigator)) {
    return { ready: false, reason: "Your browser does not support offline mode." };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !navigator.serviceWorker.controller) {
    return {
      ready: false,
      reason:
        "Offline setup hasn't finished yet. Reload this page once while online, then try again.",
    };
  }
  if (!("caches" in window)) {
    return { ready: false, reason: "Cache storage unavailable." };
  }
  try {
    const keys = await caches.keys();
    const shell = keys.find((k) => k.endsWith("-shell"));
    const assets = keys.find((k) => k.endsWith("-assets"));
    if (!shell || !assets) {
      return {
        ready: false,
        reason:
          "Finishing offline setup — reconnect briefly and reload once, then you can work fully offline.",
      };
    }
    const assetCache = await caches.open(assets);
    const entries = await assetCache.keys();
    if (entries.length < 5) {
      return {
        ready: false,
        reason:
          "Finishing offline setup — reconnect briefly and reload once, then you can work fully offline.",
      };
    }
    return { ready: true };
  } catch (e) {
    return { ready: false, reason: (e as Error).message };
  }
}

// Network isolation — when enabled, blocks ALL outgoing network activity
// initiated by this app: fetch, XMLHttpRequest, sendBeacon, WebSocket,
// EventSource. Same-origin requests for already-cached app assets still
// resolve through the Service Worker cache; only true network egress is
// blocked. This is the trust feature behind "Work Offline".

type Listener = (state: { enabled: boolean; blocked: number }) => void;

const STORAGE_KEY = "counselpdf:work-offline";

// DIAGNOSTIC FLAG (temporary): gate the fetch/XHR/WS/EventSource monkey-patch
// and the service-worker OFFLINE_MODE handshake behind a single switch so we
// can test whether isolation contributes to the open-freeze. Flip to `true`
// to restore full isolation behavior.
const ISOLATION_ENABLED = false;

let installed = false;
let enabled = false;
let blocked = 0;
const listeners = new Set<Listener>();

// Saved originals
let origFetch: typeof fetch | null = null;
let origXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let origXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
let origSendBeacon: ((url: string | URL, data?: BodyInit | null) => boolean) | null = null;
let origWebSocket: typeof WebSocket | null = null;
let origEventSource: typeof EventSource | null = null;

function emit() {
  const snap = { enabled, blocked };
  listeners.forEach((l) => {
    try {
      l(snap);
    } catch {
      /* ignore */
    }
  });
}

function bump(reason: string, url: unknown) {
  blocked += 1;
  // eslint-disable-next-line no-console
  console.warn(`[CounselPDF] Network isolation blocked ${reason}:`, url);
  emit();
}

function notifySW(active: boolean) {
  try {
    if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: "OFFLINE_MODE",
      enabled: active,
    });
  } catch {
    /* ignore */
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  origFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (enabled) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      bump("fetch", url);
      return Promise.reject(
        new TypeError("Network blocked: CounselPDF is in Work Offline mode"),
      );
    }
    return origFetch!(input as RequestInfo, init);
  } as typeof fetch;

  origXhrOpen = XMLHttpRequest.prototype.open;
  origXhrSend = XMLHttpRequest.prototype.send;
  const blockedFlag = Symbol("offlineBlocked");
  type Marked = XMLHttpRequest & { [k: symbol]: unknown };
  XMLHttpRequest.prototype.open = function (
    this: Marked,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as Marked)[blockedFlag] = enabled ? url : null;
    // @ts-expect-error rest passthrough
    return origXhrOpen!.call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: Marked, body?: Document | BodyInit | null) {
    if (enabled) {
      bump("XMLHttpRequest", (this as Marked)[blockedFlag] ?? "(unknown)");
      throw new DOMException(
        "Network blocked: CounselPDF is in Work Offline mode",
        "NetworkError",
      );
    }
    return origXhrSend!.call(this, body as XMLHttpRequestBodyInit | null);
  } as typeof XMLHttpRequest.prototype.send;

  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    origSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
      if (enabled) {
        bump("sendBeacon", url);
        return false;
      }
      return origSendBeacon!(url, data);
    };
  }

  origWebSocket = window.WebSocket;
  function BlockedWebSocket(this: WebSocket, url: string | URL, protocols?: string | string[]) {
    if (enabled) {
      bump("WebSocket", url);
      throw new DOMException(
        "Network blocked: CounselPDF is in Work Offline mode",
        "SecurityError",
      );
    }
    return new origWebSocket!(url, protocols);
  }
  BlockedWebSocket.prototype = origWebSocket.prototype;
  Object.assign(BlockedWebSocket, origWebSocket);
  window.WebSocket = BlockedWebSocket as unknown as typeof WebSocket;

  if (typeof window.EventSource === "function") {
    origEventSource = window.EventSource;
    function BlockedEventSource(
      this: EventSource,
      url: string | URL,
      init?: EventSourceInit,
    ) {
      if (enabled) {
        bump("EventSource", url);
        throw new DOMException(
          "Network blocked: CounselPDF is in Work Offline mode",
          "SecurityError",
        );
      }
      return new origEventSource!(url, init);
    }
    BlockedEventSource.prototype = origEventSource.prototype;
    Object.assign(BlockedEventSource, origEventSource);
    window.EventSource = BlockedEventSource as unknown as typeof EventSource;
  }
}

export function isOfflineEnabled() {
  return enabled;
}

export function getBlockedCount() {
  return blocked;
}

export function setOfflineMode(next: boolean) {
  install();
  if (enabled === next) return;
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  } catch {
    /* ignore */
  }
  notifySW(next);
  emit();
}

export function subscribeOffline(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function initNetworkIsolation() {
  install();
  let pref = false;
  try {
    pref = window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    /* ignore */
  }
  enabled = pref;
  notifySW(enabled);
  emit();
}

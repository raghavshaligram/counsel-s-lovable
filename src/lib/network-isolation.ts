// Network isolation — when enabled, blocks ALL outgoing network activity
// initiated by this app: fetch, XMLHttpRequest, sendBeacon, WebSocket,
// EventSource. Same-origin requests for already-cached app assets still
// resolve through the Service Worker cache; only true network egress is
// blocked. This is the trust feature behind "Work Offline".
//
// In addition to blocking, this module observes every outgoing request the
// app makes (when online) so the "Prove It" panel can show users — in plain
// language — exactly where bytes went and confirm that NO document data
// ever left their device.

export type RequestCategory =
  | "app-assets"
  | "license"
  | "ai"
  | "other";

export type RequestKind = "fetch" | "xhr" | "beacon" | "websocket" | "eventsource";

export type RequestLogEntry = {
  id: number;
  ts: number;
  kind: RequestKind;
  method: string;
  url: string;
  host: string;
  category: RequestCategory;
  uploadBytes: number;
  docBytes: number;
  bodyKind: "none" | "json" | "text" | "form" | "binary" | "unknown";
  blocked: boolean;
  status?: number;
  error?: string;
};

type Listener = (state: { enabled: boolean; blocked: number }) => void;
type LogListener = (entries: RequestLogEntry[]) => void;

const STORAGE_KEY = "counselpdf:work-offline";
const MAX_LOG = 500;

let installed = false;
let enabled = false;
let blocked = 0;
let nextId = 1;
const log: RequestLogEntry[] = [];
const listeners = new Set<Listener>();
const logListeners = new Set<LogListener>();

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

function emitLog() {
  const snap = log.slice();
  logListeners.forEach((l) => {
    try {
      l(snap);
    } catch {
      /* ignore */
    }
  });
}

function pushEntry(entry: Omit<RequestLogEntry, "id" | "ts">) {
  const full: RequestLogEntry = { id: nextId++, ts: Date.now(), ...entry };
  log.push(full);
  if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG);
  emitLog();
  return full;
}

function categorizeUrl(rawUrl: string): { host: string; category: RequestCategory } {
  let host = "";
  try {
    const u = new URL(rawUrl, window.location.href);
    host = u.host;
    if (u.origin === window.location.origin) {
      if (u.pathname.startsWith("/_serverFn") || u.pathname.includes("license")) {
        return { host, category: "license" };
      }
      return { host, category: "app-assets" };
    }
    if (/supabase\.(co|in)$/i.test(u.host) || /\/auth\/v1\//.test(u.pathname) || /\/rest\/v1\//.test(u.pathname)) {
      return { host, category: "license" };
    }
    if (/ai\.gateway|openai|anthropic|huggingface|hf\.co/i.test(u.host)) {
      return { host, category: "ai" };
    }
    return { host, category: "other" };
  } catch {
    return { host, category: "other" };
  }
}

function measureBody(body: BodyInit | Document | null | undefined): {
  uploadBytes: number;
  docBytes: number;
  bodyKind: RequestLogEntry["bodyKind"];
} {
  if (body == null) return { uploadBytes: 0, docBytes: 0, bodyKind: "none" };
  try {
    if (typeof body === "string") {
      const bytes = new Blob([body]).size;
      // Heuristic: short JSON/text is app/license traffic, not document data.
      const kind: RequestLogEntry["bodyKind"] =
        body.startsWith("{") || body.startsWith("[") ? "json" : "text";
      return { uploadBytes: bytes, docBytes: 0, bodyKind: kind };
    }
    if (body instanceof Blob) {
      // Binary blob: count as potential document bytes.
      return { uploadBytes: body.size, docBytes: body.size, bodyKind: "binary" };
    }
    if (body instanceof ArrayBuffer) {
      return { uploadBytes: body.byteLength, docBytes: body.byteLength, bodyKind: "binary" };
    }
    if (ArrayBuffer.isView(body)) {
      const v = body as ArrayBufferView;
      return { uploadBytes: v.byteLength, docBytes: v.byteLength, bodyKind: "binary" };
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      let total = 0;
      let docTotal = 0;
      body.forEach((v) => {
        if (typeof v === "string") total += new Blob([v]).size;
        else {
          total += v.size;
          docTotal += v.size; // a File in FormData counts as document data
        }
      });
      return { uploadBytes: total, docBytes: docTotal, bodyKind: "form" };
    }
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      const s = body.toString();
      return { uploadBytes: new Blob([s]).size, docBytes: 0, bodyKind: "text" };
    }
  } catch {
    /* ignore */
  }
  return { uploadBytes: 0, docBytes: 0, bodyKind: "unknown" };
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
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const { host, category } = categorizeUrl(url);
    const measured = measureBody(init?.body as BodyInit | null | undefined);

    if (enabled) {
      bump("fetch", url);
      pushEntry({
        kind: "fetch",
        method,
        url,
        host,
        category,
        uploadBytes: measured.uploadBytes,
        docBytes: measured.docBytes,
        bodyKind: measured.bodyKind,
        blocked: true,
      });
      return Promise.reject(
        new TypeError("Network blocked: CounselPDF is in Work Offline mode"),
      );
    }
    const entry = pushEntry({
      kind: "fetch",
      method,
      url,
      host,
      category,
      uploadBytes: measured.uploadBytes,
      docBytes: measured.docBytes,
      bodyKind: measured.bodyKind,
      blocked: false,
    });
    return origFetch!(input as RequestInfo, init).then(
      (res) => {
        entry.status = res.status;
        emitLog();
        return res;
      },
      (err) => {
        entry.error = err instanceof Error ? err.message : String(err);
        emitLog();
        throw err;
      },
    );
  } as typeof fetch;

  origXhrOpen = XMLHttpRequest.prototype.open;
  origXhrSend = XMLHttpRequest.prototype.send;
  const urlFlag = Symbol("offlineUrl");
  const methodFlag = Symbol("offlineMethod");
  type Marked = XMLHttpRequest & { [k: symbol]: unknown };
  XMLHttpRequest.prototype.open = function (
    this: Marked,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    (this as Marked)[urlFlag] = url;
    (this as Marked)[methodFlag] = method;
    // @ts-expect-error rest passthrough
    return origXhrOpen!.call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: Marked, body?: Document | BodyInit | null) {
    const rawUrl = String((this as Marked)[urlFlag] ?? "(unknown)");
    const method = String((this as Marked)[methodFlag] ?? "GET").toUpperCase();
    const { host, category } = categorizeUrl(rawUrl);
    const measured = measureBody(body);
    if (enabled) {
      bump("XMLHttpRequest", rawUrl);
      pushEntry({
        kind: "xhr",
        method,
        url: rawUrl,
        host,
        category,
        uploadBytes: measured.uploadBytes,
        docBytes: measured.docBytes,
        bodyKind: measured.bodyKind,
        blocked: true,
      });
      throw new DOMException(
        "Network blocked: CounselPDF is in Work Offline mode",
        "NetworkError",
      );
    }
    pushEntry({
      kind: "xhr",
      method,
      url: rawUrl,
      host,
      category,
      uploadBytes: measured.uploadBytes,
      docBytes: measured.docBytes,
      bodyKind: measured.bodyKind,
      blocked: false,
    });
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

export function getRequestLog(): RequestLogEntry[] {
  return log.slice();
}

export function subscribeRequestLog(fn: LogListener): () => void {
  logListeners.add(fn);
  return () => {
    logListeners.delete(fn);
  };
}

export function clearRequestLog() {
  log.length = 0;
  emitLog();
}

export function getDocBytesUploaded(): number {
  let n = 0;
  for (const e of log) if (!e.blocked) n += e.docBytes;
  return n;
}

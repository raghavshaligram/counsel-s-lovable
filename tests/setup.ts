/**
 * Test setup — patches `fetch` so modules that load /fonts/* via URL
 * during addBates / sanitize keep working under plain Node.
 *
 * The production code calls `fetch("/fonts/liberation/<file>.ttf")`. In
 * the browser that resolves against `public/`. We translate the same
 * path to a filesystem read here.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_ROOT = path.resolve(__dirname, "..", "public");
const originalFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/")) {
    try {
      const buf = await readFile(path.join(PUBLIC_ROOT, url));
      return new Response(buf, { status: 200 });
    } catch (err) {
      return new Response(`not found: ${url} (${(err as Error).message})`, { status: 404 });
    }
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof fetch;

/**
 * Worker polyfill for the redaction pipeline under Node (vitest runs with
 * `environment: "node"`, which has no global `Worker`).
 *
 * The redaction gate (`enforceRedactionGate`) fans its stages out to
 * dedicated Web Workers via `new Worker(new URL("./<name>.worker.ts", …))`.
 * In a real browser those workers host the SAME pure functions we ship —
 * `sanitizePdfBytesWithReport`, `verifyRedactionRemoval`,
 * `verifySideChannelVectors`. There is no browser-only rendering on the
 * sanitize / verify paths (page-geometry pdf.js only runs when a target
 * carries a rect — the gate regression test deliberately uses rect-less
 * targets), so we can run that exact logic in-process here.
 *
 * This polyfill therefore does NOT fake the result: each worker URL is
 * routed to the real module and the genuine sanitize/verify code executes,
 * speaking the same postMessage protocol the production clients expect.
 * A worker path we can't faithfully run in Node (rasterize needs a canvas)
 * emits a loud `error` message rather than a silent success, so any future
 * test that reaches it fails visibly instead of masking a regression.
 */
type WorkerInbound = {
  kind?: string;
  id?: string;
  bytes?: ArrayBuffer;
  targets?: unknown;
  rasterizedPages?: number[];
  sensitiveStrings?: string[];
  sideVerifyStrings?: string[];
  targetFieldNames?: string[];
};

function copyToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

class RedactionWorkerPolyfill extends EventTarget {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private readonly url: string;

  constructor(scriptURL: string | URL) {
    super();
    this.url = typeof scriptURL === "string" ? scriptURL : scriptURL.href;
  }

  postMessage(message: WorkerInbound): void {
    // Deliver on a later microtask so the caller can register its
    // "message" listener before a result is dispatched (the production
    // clients call addEventListener then postMessage synchronously).
    void this.dispatch(message);
  }

  terminate(): void {
    /* nothing to tear down — the work ran in-process */
  }

  private emit(data: Record<string, unknown>): void {
    const ev = new MessageEvent("message", { data });
    if (typeof this.onmessage === "function") this.onmessage(ev);
    this.dispatchEvent(ev);
  }

  private async dispatch(message: WorkerInbound): Promise<void> {
    if (message?.kind === "cancel") return;
    try {
      if (this.url.includes("sanitize.worker")) {
        await this.runSanitize(message);
      } else if (this.url.includes("verify.worker")) {
        await this.runVerify(message);
      } else {
        throw new Error(`No Node Worker polyfill for ${this.url}`);
      }
    } catch (err) {
      this.emit({
        kind: "error",
        id: message?.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async runSanitize(m: WorkerInbound): Promise<void> {
    const { sanitizePdfBytesWithReport } = await import("@/lib/pdf/sanitize");
    const src = new Uint8Array(m.bytes as ArrayBuffer);
    const targetFieldNames = m.targetFieldNames ?? [];
    const { bytes: out, report, pageCount } = await sanitizePdfBytesWithReport(
      src,
      targetFieldNames.length > 0 ? { targetFieldNames } : {},
    );
    let sideLeaks: unknown;
    const sideVerifyStrings = Array.from(
      new Set((m.sideVerifyStrings ?? []).map((s) => s.trim()).filter((s) => s.length >= 3)),
    );
    if (sideVerifyStrings.length > 0) {
      const { verifySideChannelVectors } = await import("@/lib/editor/verify-redaction");
      sideLeaks = await verifySideChannelVectors(out, sideVerifyStrings);
    }
    this.emit({ kind: "result", id: m.id, bytes: copyToArrayBuffer(out), report, pageCount, sideLeaks });
  }

  private async runVerify(m: WorkerInbound): Promise<void> {
    const vr = await import("@/lib/editor/verify-redaction");
    if (m.kind === "verify") {
      const result = await vr.verifyRedactionRemoval(
        new Uint8Array(m.bytes as ArrayBuffer),
        (m.targets ?? []) as Parameters<typeof vr.verifyRedactionRemoval>[1],
        { rasterizedPages: m.rasterizedPages ?? [] },
      );
      this.emit({ kind: "result", id: m.id, result });
    } else if (m.kind === "verify-side-channel") {
      const leaks = await vr.verifySideChannelVectors(
        new Uint8Array(m.bytes as ArrayBuffer),
        m.sensitiveStrings ?? [],
      );
      this.emit({ kind: "side-channel-result", id: m.id, leaks });
    }
  }
}

if (typeof (globalThis as { Worker?: unknown }).Worker === "undefined") {
  (globalThis as unknown as { Worker: unknown }).Worker = RedactionWorkerPolyfill;
}

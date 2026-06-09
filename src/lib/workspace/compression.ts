// Native CompressionStream-based gzip/gunzip, executed in a dedicated Web Worker
// so 50MB snapshots don't block the main thread.
//
// We inline the worker source as a Blob URL — no separate file, no bundler config.
// Falls back to main-thread compression if Worker / CompressionStream is unavailable.

const WORKER_SOURCE = `
self.onmessage = async (e) => {
  const { id, action, buffer } = e.data;
  try {
    const stream = new Blob([buffer]).stream();
    const transformed = stream.pipeThrough(
      action === "gzip"
        ? new CompressionStream("gzip")
        : new DecompressionStream("gzip"),
    );
    const out = await new Response(transformed).arrayBuffer();
    self.postMessage({ id, ok: true, buffer: out }, [out]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
`;

let workerPromise: Promise<Worker | null> | null = null;
let nextId = 1;
const pending = new Map<number, (msg: { ok: boolean; buffer?: ArrayBuffer; error?: string }) => void>();

async function getWorker(): Promise<Worker | null> {
  if (typeof Worker === "undefined") return null;
  if (typeof CompressionStream === "undefined") return null;
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        const w = new Worker(url, { type: "classic" });
        w.onmessage = (e: MessageEvent) => {
          const { id, ok, buffer, error } = e.data as {
            id: number;
            ok: boolean;
            buffer?: ArrayBuffer;
            error?: string;
          };
          const resolver = pending.get(id);
          if (resolver) {
            pending.delete(id);
            resolver({ ok, buffer, error });
          }
        };
        return w;
      } catch {
        return null;
      }
    })();
  }
  return workerPromise;
}

async function runInWorker(action: "gzip" | "gunzip", buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const w = await getWorker();
  if (!w) {
    // Fallback: main-thread CompressionStream if available.
    if (typeof CompressionStream !== "undefined") {
      const stream = new Blob([buffer]).stream();
      const transformed = stream.pipeThrough(
        action === "gzip"
          ? new CompressionStream("gzip")
          : new DecompressionStream("gzip"),
      );
      return await new Response(transformed).arrayBuffer();
    }
    // No compression available — return raw.
    return buffer;
  }
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (msg) => {
      if (msg.ok && msg.buffer) resolve(msg.buffer);
      else reject(new Error(msg.error || "compression failed"));
    });
    w.postMessage({ id, action, buffer }, [buffer]);
  });
}

export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  // Slice so we transfer a clean ArrayBuffer.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const out = await runInWorker("gzip", ab);
  return new Uint8Array(out);
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const out = await runInWorker("gunzip", ab);
  return new Uint8Array(out);
}

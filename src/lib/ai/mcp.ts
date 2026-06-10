// Minimal in-browser MCP client. Speaks JSON-RPC 2.0 over a WebSocket
// (or HTTP-streaming) transport, as used by the local `vaultpdf-mcp`
// helper script. The full handshake / capabilities round-trip will land
// in Phase 4.1; this is the typed surface tools can already depend on.

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpClient = {
  listTools(): Promise<McpTool[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

type JsonRpcReq = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };
type JsonRpcRes = { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string } };

export async function connectMcp(url: string): Promise<McpClient> {
  const ws = new WebSocket(url);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });

  ws.addEventListener("message", (e) => {
    try {
      const msg = JSON.parse(typeof e.data === "string" ? e.data : "") as JsonRpcRes;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } catch {
      // ignore malformed frames
    }
  });

  function send(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    const req: JsonRpcReq = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(req));
    });
  }

  return {
    async listTools() {
      const out = (await send("tools/list")) as { tools?: McpTool[] };
      return out.tools ?? [];
    },
    call(name, args) {
      return send("tools/call", { name, arguments: args });
    },
    close() {
      ws.close();
    },
  };
}

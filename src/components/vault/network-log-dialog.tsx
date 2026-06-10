import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { list, clear, type NetworkLogEntry } from "@/lib/trust/network-log";
import { toast } from "sonner";

function fmtTime(t: number) {
  const d = new Date(t);
  return d.toLocaleString();
}
function fmtBytes(n: number) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function NetworkLogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [entries, setEntries] = useState<NetworkLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    setEntries(await list(500));
    setLoading(false);
  }

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  async function onClear() {
    await clear();
    setEntries([]);
    toast.success("Network log cleared.");
  }

  function onExport() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaultpdf-network-log-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Network Log</DialogTitle>
          <DialogDescription>
            Every outbound AI request from this device. Payloads are hashed, never stored.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs text-ink/60">
          <span>{loading ? "loading…" : `${entries.length} entries`}</span>
          <div className="flex gap-2">
            <button onClick={refresh} className="rounded border border-whisper px-2 py-1 hover:bg-whisper">Refresh</button>
            <button onClick={onExport} disabled={!entries.length} className="rounded border border-whisper px-2 py-1 hover:bg-whisper disabled:opacity-40">Export JSON</button>
            <button onClick={onClear} disabled={!entries.length} className="rounded border border-evidence/40 px-2 py-1 text-evidence hover:bg-evidence/10 disabled:opacity-40">Clear</button>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded border border-whisper">
          {entries.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink/50">No requests yet.</div>
          ) : (
            <table className="w-full text-[12px] font-mono">
              <thead className="bg-whisper/30 text-ink/60">
                <tr className="text-left">
                  <th className="px-2 py-1.5 font-normal">When</th>
                  <th className="px-2 py-1.5 font-normal">Provider</th>
                  <th className="px-2 py-1.5 font-normal">Host</th>
                  <th className="px-2 py-1.5 font-normal">Model</th>
                  <th className="px-2 py-1.5 font-normal text-right">Out</th>
                  <th className="px-2 py-1.5 font-normal text-right">In</th>
                  <th className="px-2 py-1.5 font-normal text-right">ms</th>
                  <th className="px-2 py-1.5 font-normal">Status</th>
                  <th className="px-2 py-1.5 font-normal">Hash</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className="border-t border-whisper/40">
                    <td className="px-2 py-1 text-ink/70">{fmtTime(e.at)}</td>
                    <td className="px-2 py-1">{e.provider}</td>
                    <td className="px-2 py-1 text-ink/70">{e.host}</td>
                    <td className="px-2 py-1 text-ink/70">{e.model ?? "—"}</td>
                    <td className="px-2 py-1 text-right text-ink/60">{fmtBytes(e.bytesOut)}</td>
                    <td className="px-2 py-1 text-right text-ink/60">{fmtBytes(e.bytesIn)}</td>
                    <td className="px-2 py-1 text-right text-ink/60">{e.durationMs}</td>
                    <td className={`px-2 py-1 ${e.ok ? "text-vault" : "text-evidence"}`}>{e.status || "ERR"}</td>
                    <td className="px-2 py-1 text-ink/40" title={e.reqHash}>{e.reqHash.slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

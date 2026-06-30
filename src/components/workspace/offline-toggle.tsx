import { useState, useRef, useEffect } from "react";
import { WifiOff, Wifi, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  setOfflineMode,
  subscribeOffline,
  isOfflineEnabled,
  getBlockedCount,
} from "@/lib/network-isolation";

const OFFLINE_KEY = "counselpdf:work-offline";

export function loadOfflinePref(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(OFFLINE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveOfflinePref(value: boolean) {
  setOfflineMode(value);
}

function useOfflineState() {
  // Start from a stable value so SSR and the first client render match.
  // Hydrate real values after mount.
  const [state, setState] = useState({ enabled: false, blocked: 0 });
  useEffect(() => {
    setState({ enabled: isOfflineEnabled(), blocked: getBlockedCount() });
    return subscribeOffline(setState);
  }, []);
  return state;
}

export function OfflineToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { blocked } = useOfflineState();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !enabled;
          onChange(next);
          saveOfflinePref(next);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
          enabled
            ? "bg-vault/15 text-vault hover:bg-vault/25"
            : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-foreground",
        )}
        title={
          enabled
            ? `Network isolation ON — ${blocked} request${blocked === 1 ? "" : "s"} blocked. Click to disable.`
            : "Work Offline — click to block all network activity from this app"
        }
        aria-label={enabled ? "Disable Work Offline" : "Enable Work Offline"}
        aria-pressed={enabled}
      >
        {enabled ? (
          <WifiOff className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Wifi className="h-3 w-3" strokeWidth={2.5} />
        )}
        <span className="hidden md:inline">
          {enabled ? `Isolated — ${blocked} blocked` : "Work Offline"}
        </span>
        <span className="md:hidden">{enabled ? "Isolated" : "Offline"}</span>
      </button>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-grid h-5 w-5 place-items-center rounded-full text-text-muted hover:bg-surface-3 hover:text-foreground"
        title="About Work Offline"
        aria-label="About Work Offline"
        aria-expanded={open}
      >
        <span className="text-[10px] font-semibold">i</span>
      </button>


      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-[22rem] rounded-xl border border-border bg-surface-2 p-4 shadow-[var(--shadow-float)]"
            role="dialog"
            aria-label="Work Offline settings"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-surface-3 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <div className="flex items-start gap-3 pr-5">
              <div
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                  enabled ? "bg-vault/15" : "bg-surface-3",
                )}
              >
                {enabled ? (
                  <WifiOff className="h-4 w-4 text-vault" strokeWidth={2.5} />
                ) : (
                  <Wifi className="h-4 w-4 text-text-muted" strokeWidth={2.5} />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground">
                  Work Offline
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                  When enabled, CounselPDF blocks all of its own network
                  activity — every <code className="font-mono text-[11px]">fetch</code>,
                  XHR, WebSocket and beacon this app would send is rejected.
                  Your documents cannot leave through this app.
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
                  Verify it yourself: open DevTools → Network, toggle this on,
                  use any tool — zero requests will leave.
                </p>

                <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2.5">
                  <span className="text-[12px] font-medium text-foreground">
                    Network isolation
                  </span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(next) => {
                      onChange(next);
                      saveOfflinePref(next);
                    }}
                    aria-label="Toggle network isolation"
                  />
                </div>

                {enabled && (
                  <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-vault/30 bg-vault/10 px-2 py-1.5 text-[11px] font-medium text-vault">
                    <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
                    <span>
                      Isolated — {blocked} outgoing request
                      {blocked === 1 ? "" : "s"} blocked this session
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function OfflineBadge({ enabled }: { enabled: boolean }) {
  const { blocked } = useOfflineState();
  if (!enabled) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-vault/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vault"
      title={`${blocked} outgoing request${blocked === 1 ? "" : "s"} blocked`}
    >
      <WifiOff className="h-2.5 w-2.5" strokeWidth={2.5} />
      Isolated — {blocked} blocked
    </span>
  );
}

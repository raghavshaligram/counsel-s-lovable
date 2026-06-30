import { useState, useRef, useEffect, useCallback } from "react";
import { WifiOff, Wifi, X, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [state, setState] = useState({ enabled: false, blocked: 0 });
  useEffect(() => {
    setState({ enabled: isOfflineEnabled(), blocked: getBlockedCount() });
    return subscribeOffline(setState);
  }, []);
  return state;
}

type ReadyState = {
  ready: boolean;
  hasShell: boolean;
  assets: number;
  hasSW: boolean;
};

async function checkOfflineReady(): Promise<ReadyState> {
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    !navigator.serviceWorker.controller ||
    typeof caches === "undefined"
  ) {
    return { ready: false, hasShell: false, assets: 0, hasSW: false };
  }
  try {
    const keys = await caches.keys();
    const shellName = keys.find((k) => k.endsWith("-shell"));
    const assetName = keys.find((k) => k.endsWith("-assets"));
    let hasShell = false;
    let assets = 0;
    if (shellName) {
      const c = await caches.open(shellName);
      hasShell = Boolean(await c.match("/"));
    }
    if (assetName) {
      const c = await caches.open(assetName);
      assets = (await c.keys()).length;
    }
    // After one full app load the asset cache holds dozens of chunks. We
    // gate on a reasonable minimum so the user isn't switched offline
    // before the SW has actually warmed.
    return { ready: hasShell && assets >= 20, hasShell, assets, hasSW: true };
  } catch {
    return { ready: false, hasShell: false, assets: 0, hasSW: true };
  }
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
  const [checking, setChecking] = useState(false);
  const [readyState, setReadyState] = useState<ReadyState | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Refresh the readiness check whenever the panel opens in online mode.
  useEffect(() => {
    if (!open || enabled) {
      setReadyState(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    void checkOfflineReady().then((r) => {
      if (!cancelled) {
        setReadyState(r);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, enabled]);

  const goOffline = useCallback(async () => {
    setChecking(true);
    const r = await checkOfflineReady();
    setReadyState(r);
    setChecking(false);
    if (!r.ready) return; // refuse — UI shows the warning
    onChange(true);
    saveOfflinePref(true);
    setOpen(false);
  }, [onChange]);

  const goOnline = useCallback(() => {
    onChange(false);
    saveOfflinePref(false);
    setOpen(false);
  }, [onChange]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
          enabled
            ? "bg-vault/15 text-vault hover:bg-vault/25"
            : "bg-surface-2 text-foreground hover:bg-surface-3",
          open && enabled && "bg-vault/25",
          open && !enabled && "bg-surface-3",
        )}
        title={
          enabled
            ? `Offline — Isolated · ${blocked} request${blocked === 1 ? "" : "s"} blocked`
            : "Online — click to go offline"
        }
        aria-label={
          enabled ? "Network isolation enabled — click to go online" : "Online — click to go offline"
        }
        aria-expanded={open}
      >
        {enabled ? (
          <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <span
            className="inline-block h-2 w-2 rounded-full bg-success shadow-[0_0_0_2px_color-mix(in_oklab,var(--success)_25%,transparent)]"
            aria-hidden="true"
          />
        )}
        <span className="hidden md:inline">
          {enabled ? `Offline — Isolated · ${blocked} blocked` : "Online"}
        </span>
        <span className="md:hidden">{enabled ? "Isolated" : "Online"}</span>
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
            aria-label="Network mode"
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
                  enabled ? "bg-vault/15" : "bg-success/15",
                )}
              >
                {enabled ? (
                  <ShieldCheck className="h-4 w-4 text-vault" strokeWidth={2.5} />
                ) : (
                  <Wifi className="h-4 w-4 text-success" strokeWidth={2.5} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  {enabled ? "Offline — Isolated" : "Online"}
                </div>

                {enabled ? (
                  <>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                      Every <code className="font-mono text-[11px]">fetch</code>,
                      XHR, WebSocket and beacon from this app is being rejected.
                      Documents cannot leave through CounselPDF.
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 rounded-md border border-vault/30 bg-vault/10 px-2 py-1.5 text-[11px] font-medium text-vault">
                      <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
                      <span>
                        0 sent · {blocked} blocked this session
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
                      Verify in DevTools → Network: zero outbound requests.
                    </p>
                    <button
                      type="button"
                      onClick={goOnline}
                      className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-surface-3 px-3 text-[12px] font-medium text-foreground hover:bg-surface-1 transition-colors"
                    >
                      <Wifi className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Go back online
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                      Switch to <span className="font-medium text-foreground">Offline — Isolated</span>{" "}
                      to block every outbound request from CounselPDF. The app
                      must be fully cached first so it keeps working without the
                      network.
                    </p>

                    {readyState && !readyState.ready && (
                      <div className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
                        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2.5} />
                        <span>
                          {!readyState.hasSW
                            ? "Offline cache isn't installed yet. Reload the page once while online, then try again."
                            : `Finishing offline setup (${readyState.assets} asset${readyState.assets === 1 ? "" : "s"} cached). Reconnect briefly and reload once, then you can work fully offline.`}
                        </span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={goOffline}
                      disabled={checking}
                      className={cn(
                        "mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors",
                        "bg-vault text-vault-foreground hover:bg-vault/90 disabled:opacity-60",
                      )}
                    >
                      {checking ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.5} />
                          Checking offline cache…
                        </>
                      ) : (
                        <>
                          <WifiOff className="h-3.5 w-3.5" strokeWidth={2.5} />
                          Go offline
                        </>
                      )}
                    </button>
                  </>
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
      <ShieldCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
      Offline — {blocked} blocked
    </span>
  );
}

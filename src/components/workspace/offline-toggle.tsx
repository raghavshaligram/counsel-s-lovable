import { useState, useRef, useEffect, useCallback } from "react";
import { WifiOff, X, ShieldOff, Loader2, ArrowRight, Download, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  installOfflineGuard,
  uninstallOfflineGuard,
  subscribe as subscribeOfflineGuard,
  verifyOfflineReadiness,
  type OfflineGuardState,
} from "@/lib/trust/offline-guard";
import { getAiCacheStatus, type AiCacheStatus } from "@/lib/ai/model-download-ui";
import { loadModel } from "@/lib/discovery/client";
import { prewarmNer } from "@/lib/pdf/ner";

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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OFFLINE_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function OfflineToggle({
  enabled,
  onChange,
}: {
  /** Deprecated — indicator is document-independent now. */
  hasDocument?: boolean;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [guardState, setGuardState] = useState<OfflineGuardState>({
    active: false,
    blocked: 0,
    allowed: 0,
  });
  const [aiCache, setAiCache] = useState<AiCacheStatus>({ minilmCached: false, nerCached: false });
  const [prewarming, setPrewarming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshAiCache = useCallback(() => {
    void getAiCacheStatus().then(setAiCache).catch(() => {/* ignore */});
  }, []);
  useEffect(() => { if (open) refreshAiCache(); }, [open, refreshAiCache]);

  const prewarmModels = useCallback(async () => {
    setPrewarming(true);
    try {
      await Promise.allSettled([
        loadModel(undefined, "offline-toggle:pre-download"),
        prewarmNer("offline-toggle:pre-download"),
      ]);
      refreshAiCache();
      toast.success("AI models cached", {
        description: "MiniLM and NER are stored on this device. AI features work offline now.",
      });
    } finally {
      setPrewarming(false);
    }
  }, [refreshAiCache]);

  // Keep the actual network guard in sync with the persisted pref on mount
  // and when the pref changes elsewhere.
  useEffect(() => {
    if (enabled) installOfflineGuard();
    else uninstallOfflineGuard();
  }, [enabled]);

  useEffect(() => subscribeOfflineGuard(setGuardState), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const goOffline = useCallback(async () => {
    setChecking(true);
    try {
      const result = await verifyOfflineReadiness();
      if (!result.ready) {
        toast.error("Not ready for offline isolation", {
          description: result.reason,
        });
        return;
      }
      installOfflineGuard();
      onChange(true);
      saveOfflinePref(true);
      toast.success("Offline — Isolated", {
        description: "Outbound network requests are now blocked in this tab.",
      });
    } finally {
      setChecking(false);
    }
  }, [onChange]);

  const goOnline = useCallback(() => {
    uninstallOfflineGuard();
    onChange(false);
    saveOfflinePref(false);
    toast.success("Back online", {
      description: "Outbound requests are allowed again.",
    });
  }, [onChange]);

  const isOffline = enabled;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
          isOffline
            ? "border border-vault/40 bg-vault/15 text-vault hover:bg-vault/25"
            : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
          open && isOffline && "bg-vault/25",
          open && !isOffline && "bg-emerald-500/20",
        )}
        title={
          isOffline
            ? `Offline — Isolated · ${guardState.blocked} blocked`
            : "Online — click to go offline"
        }
        aria-label={isOffline ? "Offline isolated mode enabled" : "Online — click to go offline"}
        aria-expanded={open}
      >
        {isOffline ? (
          <ShieldOff className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <span
            aria-hidden="true"
            className="relative inline-flex h-2 w-2 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
          </span>
        )}
        <span className="hidden md:inline">
          {isOffline ? "Offline — Isolated" : "Online"}
        </span>
        <span className="md:hidden">{isOffline ? "Offline" : "Online"}</span>
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
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-80 rounded-xl border border-border bg-surface-2 p-4 shadow-[var(--shadow-float)]"
            role="dialog"
            aria-label="Network isolation"
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
                  isOffline
                    ? "bg-vault/15"
                    : "bg-emerald-500/15",
                )}
              >
                {isOffline ? (
                  <ShieldOff className="h-4 w-4 text-vault" strokeWidth={2.5} />
                ) : (
                  <span className="relative inline-flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-foreground">
                  {isOffline ? "Offline — Isolated" : "Online"}
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                  {isOffline
                    ? "This tab is blocking outbound network requests. The app runs entirely from cached assets on this device."
                    : "Network is allowed. Documents still stay on your device — Offline Isolation additionally blocks all outbound requests as a hard guarantee."}
                </p>

                {isOffline && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-border bg-surface-1 px-2.5 py-1.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        Allowed
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-foreground">
                        {guardState.allowed}
                      </div>
                      <div className="text-[10px] text-text-muted">same-origin</div>
                    </div>
                    <div className="rounded-md border border-vault/30 bg-vault/10 px-2.5 py-1.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-vault">
                        Blocked
                      </div>
                      <div className="mt-0.5 text-[13px] font-semibold text-vault">
                        {guardState.blocked}
                      </div>
                      <div className="text-[10px] text-text-muted">outbound</div>
                    </div>
                  </div>
                )}

                <div className="mt-3">
                  {isOffline ? (
                    <button
                      type="button"
                      onClick={() => {
                        goOnline();
                        setOpen(false);
                      }}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-2 text-[12px] font-medium text-foreground hover:border-vault/40 hover:bg-surface-3"
                    >
                      Go back online
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void goOffline()}
                      disabled={checking}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-vault/50 bg-vault/15 px-3 py-2 text-[12px] font-medium text-foreground hover:bg-vault/25 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {checking ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking cache…
                        </>
                      ) : (
                        <>
                          <ShieldOff className="h-3.5 w-3.5" /> Go offline (isolate this tab)
                        </>
                      )}
                    </button>
                  )}
                </div>

                {!isOffline && (
                  <p className="mt-2 text-[10.5px] leading-relaxed text-text-muted">
                    We'll verify the app is fully cached before switching — so
                    isolation never leaves you stranded.
                  </p>
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
  if (!enabled) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-vault/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vault">
      <WifiOff className="h-2.5 w-2.5" strokeWidth={2.5} />
      Isolated
    </span>
  );
}

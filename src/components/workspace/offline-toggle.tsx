import { useState, useRef, useEffect } from "react";
import { WifiOff, Wifi, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

const OFFLINE_KEY = "vaultpdf:work-offline";

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
  hasDocument,
  enabled,
  onChange,
}: {
  hasDocument: boolean;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!hasDocument) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
          enabled
            ? "bg-vault/15 text-vault hover:bg-vault/25"
            : "bg-surface-2 text-text-muted hover:bg-surface-3 hover:text-foreground",
          open && enabled && "bg-vault/25",
          open && !enabled && "bg-surface-3",
        )}
        title={enabled ? "Offline mode is on — click to adjust" : "Work Offline — click to enable"}
        aria-label={enabled ? "Offline mode enabled" : "Work Offline toggle"}
        aria-expanded={open}
      >
        {enabled ? (
          <WifiOff className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Wifi className="h-3 w-3" strokeWidth={2.5} />
        )}
        <span className="hidden md:inline">
          {enabled ? "Offline" : "Work Offline"}
        </span>
        <span className="md:hidden">
          {enabled ? "Offline" : "Offline"}
        </span>
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
                  When enabled, VaultPDF confirms it is operating without any
                  network connection. Your documents remain on this device.
                </p>

                <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-1 px-3 py-2.5">
                  <span className="text-[12px] font-medium text-foreground">
                    Offline mode
                  </span>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(next) => {
                      onChange(next);
                      saveOfflinePref(next);
                    }}
                    aria-label="Toggle offline mode"
                  />
                </div>

                {enabled && (
                  <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-vault/30 bg-vault/10 px-2 py-1 text-[11px] font-medium text-vault">
                    <WifiOff className="h-3 w-3" strokeWidth={2.5} />
                    Offline mode — your documents never leave this device
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
  if (!enabled) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-vault/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-vault">
      <WifiOff className="h-2.5 w-2.5" strokeWidth={2.5} />
      Offline
    </span>
  );
}

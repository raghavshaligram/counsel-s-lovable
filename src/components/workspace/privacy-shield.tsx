import { useState, useRef, useEffect } from "react";
import { Lock, Shield, X, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function PrivacyShield({ hasDocument }: { hasDocument: boolean }) {
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
          "inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[11px] font-medium text-vault transition-colors hover:bg-vault/20",
          open && "bg-vault/20",
        )}
        title="Privacy Shield — click to learn more"
        aria-label="Privacy Shield: on your device, zero bytes uploaded"
        aria-expanded={open}
      >
        <Lock className="h-3 w-3" strokeWidth={2.5} />
        <span className="hidden md:inline">On your device · 0 bytes uploaded</span>
        <span className="md:hidden">On-device</span>
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
            aria-label="Privacy Shield explanation"
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
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft">
                <Shield className="h-4 w-4 text-vault" strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-[13px] font-medium text-foreground">
                  Privacy Shield
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                  Your documents are processed entirely in your browser. Nothing
                  is ever uploaded to any server. You can disconnect the internet
                  and keep working.
                </p>
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-vault/30 bg-accent-soft px-2 py-1 text-[11px] font-medium text-vault">
                  <Lock className="h-3 w-3" strokeWidth={2.5} />
                  0 bytes uploaded since opening
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <Link
                    to="/verify-privacy"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-vault hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    Verify our privacy <ArrowRight className="h-3 w-3" />
                  </Link>
                  <Link
                    to="/security-architecture"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-vault hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    Security & architecture <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

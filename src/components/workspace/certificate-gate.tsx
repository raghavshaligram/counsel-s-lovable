/**
 * Compliance certificate value gate.
 *
 * After a verified action (redaction, sanitize, bates, etc.) completes,
 * tools call `requestCertificate()` with everything needed to render the
 * formal certificate PDF on this device. The card prompts a free signup;
 * once the user has a session the PDF is generated locally, saved to
 * their portfolio (`compliance_certificates` row), and downloaded.
 *
 * Sensitive document values never leave the device. Only counts, page
 * totals, hashes, and the source file's name are persisted server-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { CheckCircle2, FileBadge2, Loader2, ShieldCheck, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import { downloadPdf } from "@/lib/pdf/download";
import { saveCertificate, type ComplianceCertKind } from "@/lib/certificates.functions";
import { cn } from "@/lib/utils";

type CertRequest = {
  kind: ComplianceCertKind;
  /** Short, human label for the action that just completed. */
  actionLabel: string;
  /** Source file name (visible to the user; goes into the cert + portfolio). */
  sourceName: string;
  /** Optional matter / case label for grouping in the portfolio. */
  caseLabel?: string | null;
  /** Suggested download file name (without extension). */
  downloadBaseName: string;
  /**
   * Serializable payload persisted to the server so the certificate can be
   * regenerated on demand later. MUST contain only counts/hashes/etc — never
   * sensitive document values.
   */
  payload: Record<string, unknown>;
  /**
   * Build the certificate PDF on-device. Runs every time the user downloads
   * (initial issue + future re-downloads from the portfolio).
   */
  build: () => Promise<Uint8Array>;
};

type GateState = {
  open: boolean;
  /** True once the user has acted on (or dismissed) the current request. */
  consumed: boolean;
  request: CertRequest | null;
  show: (req: CertRequest) => void;
  dismiss: () => void;
  markConsumed: () => void;
};

export const useCertGate = create<GateState>((set) => ({
  open: false,
  consumed: false,
  request: null,
  show: (request) => set({ open: true, consumed: false, request }),
  dismiss: () => set({ open: false }),
  markConsumed: () => set({ consumed: true, open: false }),
}));

/**
 * Convenience helper for tools — call this immediately after a successful
 * verified export. No-op safe to call from anywhere.
 */
export function requestCertificate(req: CertRequest) {
  useCertGate.getState().show(req);
}

export function CertificateGate() {
  const { open, request, dismiss, markConsumed, consumed } = useCertGate();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const openLogin = useLoginModal((s) => s.openLogin);
  const save = useServerFn(saveCertificate);

  // Track session so the card knows which CTA to show.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setAuthed(!!session);
      if (event === "SIGNED_OUT") setAuthed(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const issue = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    try {
      const bytes = await request.build();
      await save({
        data: {
          kind: request.kind,
          sourceName: request.sourceName,
          caseLabel: request.caseLabel ?? null,
          payload: request.payload as never,
        },
      });
      await downloadPdf(bytes, `${request.downloadBaseName}.pdf`);
      toast.success(`${request.actionLabel} Certificate saved to your portfolio`);
      markConsumed();
    } catch (err) {
      console.error("[cert-gate] issue failed", err);
      toast.error("Couldn't issue certificate", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [request, save, markConsumed]);

  // Auto-issue once the user signs in while the card is still up.
  useEffect(() => {
    if (open && authed && request && !busy && !consumed) {
      void issue();
    }
  }, [authed, open, request, busy, consumed, issue]);

  const title = useMemo(() => {
    if (!request) return "";
    return `${request.actionLabel} complete — verified.`;
  }, [request]);

  if (!open || !request) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Compliance certificate available"
      className={cn(
        "fixed bottom-4 right-4 z-[60] w-[min(380px,calc(100vw-2rem))] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3",
      )}
    >
      <div className="rounded-lg border border-vault/30 bg-surface-1/95 shadow-2xl backdrop-blur">
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-vault/15 text-vault">
            <FileBadge2 className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-vault">
              <CheckCircle2 className="h-3 w-3" /> Verified
            </div>
            <h3 className="mt-1 text-[13.5px] font-semibold leading-snug text-foreground">
              {title}
            </h3>
            <p className="mt-1.5 text-[12px] leading-snug text-text-2">
              Download the official <span className="text-foreground">{request.actionLabel} Certificate</span>{" "}
              for your records — malpractice file, client compliance, discovery audit trail.
            </p>
            {!authed && (
              <p className="mt-1.5 text-[11.5px] leading-snug text-text-2">
                Create a free account to save and re-download compliance certificates.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="grid h-6 w-6 place-items-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-4 py-3">
          <div className="inline-flex items-center gap-1 text-[10.5px] text-text-muted">
            <ShieldCheck className="h-3 w-3 text-vault" /> Generated on-device
          </div>
          <div className="flex items-center gap-1.5">
            {authed ? (
              <>
                <Link
                  to="/account/certificates"
                  className="rounded-md px-2.5 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  Portfolio
                </Link>
                <button
                  type="button"
                  onClick={() => void issue()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileBadge2 className="h-3 w-3" />}
                  {busy ? "Issuing…" : "Download certificate"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-md px-2.5 py-1.5 text-[12px] text-text-2 transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={openLogin}
                  className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground transition-opacity hover:opacity-90"
                >
                  <FileBadge2 className="h-3 w-3" /> Create free account
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

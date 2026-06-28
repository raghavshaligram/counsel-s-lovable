/**
 * Welcome modal — calm 4-step intro shown once on first /workspace visit.
 * Dismissible at every step; closing or finishing marks the IDB-backed
 * "seen" flag so it never reappears. A "How it works" link in the account
 * menu can re-open it later via resetWelcomeSeen().
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Lock, ShieldCheck, WifiOff, Scale, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasSeenWelcome, markWelcomeSeen } from "@/lib/workspace/welcome-store";

type Props = {
  /** When set, forces the modal open (e.g. "How it works" link). */
  forceOpen?: boolean;
  /** Called after the modal closes for any reason. */
  onClosed?: () => void;
};

type Step = {
  key: string;
  title: string;
  body: React.ReactNode;
  icon: React.ReactNode;
};

export function WelcomeModal({ forceOpen, onClosed }: Props) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (forceOpen) {
      setI(0);
      setOpen(true);
      return;
    }
    let cancelled = false;
    void hasSeenWelcome().then((seen) => {
      if (cancelled) return;
      if (!seen) setOpen(true);
    });
    return () => { cancelled = true; };
  }, [forceOpen]);

  const close = async () => {
    setOpen(false);
    await markWelcomeSeen();
    onClosed?.();
  };

  const steps: Step[] = [
    {
      key: "welcome",
      icon: <Lock className="h-4 w-4" strokeWidth={2.5} />,
      title: "Welcome to VaultPDF",
      body: (
        <p>
          The private PDF workspace built for legal work. Here&apos;s what makes it different.
        </p>
      ),
    },
    {
      key: "device",
      icon: <ShieldCheck className="h-4 w-4" strokeWidth={2.5} />,
      title: "Nothing leaves your device",
      body: (
        <>
          <p>
            Your documents are processed entirely in your browser. Nothing is ever uploaded — not to us, not to anyone. You sign in only to verify your subscription; your files never leave your computer.
          </p>
          <Link to="/verify-privacy" onClick={close} className="mt-2 inline-flex items-center gap-1 text-vault hover:underline">
            Verify it yourself <ArrowRight className="h-3 w-3" />
          </Link>
        </>
      ),
    },
    {
      key: "offline",
      icon: <WifiOff className="h-4 w-4" strokeWidth={2.5} />,
      title: "Works offline",
      body: (
        <p>
          Once loaded, VaultPDF works with no internet at all. Redact, Bates-stamp, OCR and sanitize on a plane or in a courthouse — disconnect anytime and keep working.
        </p>
      ),
    },
    {
      key: "built",
      icon: <Scale className="h-4 w-4" strokeWidth={2.5} />,
      title: "Built for your work",
      body: (
        <>
          <p>
            Redact for production, Bates-stamp discovery sets, review for privilege, sanitize before filing — all on-device. For IT and compliance details, see our Security page.
          </p>
          <Link to="/security-architecture" onClick={close} className="mt-2 inline-flex items-center gap-1 text-vault hover:underline">
            Security architecture <ArrowRight className="h-3 w-3" />
          </Link>
        </>
      ),
    },
  ];

  const step = steps[i]!;
  const isLast = i === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) void close(); }}>
      <DialogContent className="max-w-md bg-surface-1 border-border transform-gpu antialiased">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-vault text-vault-foreground">
            {step.icon}
          </span>
          <div>
            <DialogTitle className="font-display text-[17px] leading-tight antialiased tracking-normal">{step.title}</DialogTitle>
            <DialogDescription className="text-[11px] text-text-2">Step {i + 1} of {steps.length}</DialogDescription>
          </div>
        </div>

        <div className="mt-3 text-[13px] leading-relaxed text-foreground/90">
          {step.body}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {steps.map((s, idx) => (
              <span key={s.key} className={cn(
                "h-1.5 w-5 rounded-full transition-colors",
                idx === i ? "bg-vault" : idx < i ? "bg-vault/40" : "bg-border",
              )} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={close} className="text-[12.5px] text-text-2 hover:text-foreground">
              Skip
            </button>
            {isLast ? (
              <button type="button" onClick={close} className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90">
                Get started <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button type="button" onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))} className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground hover:opacity-90">
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

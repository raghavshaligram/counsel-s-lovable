import { useCallback } from "react";
import { Lock } from "lucide-react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { useLicenseActivation } from "@/lib/use-license-activation";
import { cn } from "@/lib/utils";

/**
 * Whole tools that require a paid subscription. Free tools NEVER prompt
 * sign-in. Granular paid capabilities living inside free tools use
 * `useRequirePro()` directly and render a `<LockBadge />` on the trigger.
 */
export const PAID_TOOL_IDS = new Set<string>([
  "privilege-scan", // Privilege review (AI)
  "chat",           // Private AI assist / search inside PDF
]);

/**
 * Granular paid capabilities — keyed by stable id, so each call site can
 * report its own feature name for the sign-in CTA. UI-only registry; the
 * actual entitlement check is just `useIsPro()` on the same boolean.
 */
export const PAID_FEATURES = {
  "ai-detect-sensitive": "AI detect sensitive info",
  "pattern-bulk-redact": "Pattern / bulk redaction",
  "multi-file-bates": "Multi-file Bates",
  "batch-processing": "Batch processing",
  "workflows": "Workflows & automation",
  "privilege-review": "Privilege review (AI)",
  "private-ai-assist": "Private AI assist",
} as const;
export type PaidFeatureId = keyof typeof PAID_FEATURES;

/** True if the active license is a paid, currently-entitled plan. */
export function useIsPro(): boolean {
  const license = useLicenseActivation();
  if (!license) return false;
  if (license.plan === "free") return false;
  return license.status === "active" || license.status === "trialing";
}

/**
 * Returns a guard fn. Call with the feature name being requested; if the
 * user isn't a paid subscriber it shows a toast and routes to /auth with
 * a `redirect` back to the current path so they return to the same tool.
 * Returns `true` when the call should proceed (already Pro), `false` when
 * it was intercepted.
 */
export function useRequirePro() {
  const isPro = useIsPro();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  return useCallback(
    (featureName?: string): boolean => {
      if (isPro) return true;
      const dest = href;
      toast.message("Sign in to unlock VaultPDF Pro", {
        description: featureName
          ? `${featureName} requires a Pro subscription.`
          : "This feature requires a Pro subscription.",
      });
      void navigate({ to: "/auth", search: { redirect: dest } as never });
      return false;
    },
    [isPro, navigate, href],
  );
}

/** Small lock chip rendered next to gated controls. */
export function LockBadge({
  className,
  title = "Pro feature — sign in to unlock",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      role="img"
      aria-label="Pro feature"
      title={title}
      className={cn(
        "inline-grid h-4 w-4 shrink-0 place-items-center rounded-sm border border-vault/30 bg-vault/10 text-vault",
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
    </span>
  );
}

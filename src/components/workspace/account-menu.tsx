import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { User, LogOut, Settings as SettingsIcon, CreditCard, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLicenseActivation } from "@/lib/use-license-activation";
import { clearLicense } from "@/lib/license-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type SessionUser = { id: string; email: string | null } | null;

function planLabel(plan: "free" | "solo" | "firm" | undefined) {
  if (plan === "solo") return "Founder's plan";
  if (plan === "firm") return "Firm plan";
  return "Free";
}

function statusLabel(status: string | undefined) {
  if (!status) return "";
  if (status === "active") return "Active";
  if (status === "trialing") return "Trialing";
  if (status === "past_due") return "Past due";
  if (status === "canceled") return "Canceled";
  return status;
}

export function AccountMenu() {
  const license = useLicenseActivation();
  const navigate = useNavigate();
  const [user, setUser] = useState<SessionUser>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") setUser(null);
      else if (session?.user) setUser({ id: session.user.id, email: session.user.email ?? null });
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!user) {
    return (
      <Link
        to="/auth"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-surface-2"
        title="Sign in to manage your subscription"
      >
        <LogIn className="h-3.5 w-3.5" strokeWidth={2.5} />
        Sign in
      </Link>
    );
  }

  const email = user.email ?? "Signed in";
  const initial = (email[0] ?? "?").toUpperCase();

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
      await clearLicense();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={email}
          aria-label="Account menu"
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full border border-border bg-surface-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-accent-soft hover:text-vault focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="pb-1.5">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-vault">
              <User className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-foreground">{email}</div>
              <div className="text-[11px] font-normal text-text-2">
                {planLabel(license?.plan)} · {statusLabel(license?.status) || "—"}
              </div>
            </div>
          </div>
        </DropdownMenuLabel>
        <div className="px-2 pb-1.5 text-[11px] leading-snug text-text-2">
          For subscription &amp; identity only. Your documents stay on this device.
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate({ to: "/pricing" })}>
          <CreditCard className="h-3.5 w-3.5" strokeWidth={2} />
          Manage subscription
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigate({ to: "/pricing" })}>
          <SettingsIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onSelect={(e) => { e.preventDefault(); void onSignOut(); }}>
          <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

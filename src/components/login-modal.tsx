/**
 * Login modal — overlay sign-in so workspace users never leave their
 * document. Three modes: magic link, password, and (optionally) Google.
 *
 * Opens via the zustand store `useLoginModal`. Any call site (account
 * menu, upgrade modal, paid-feature gate) can show it without prop
 * drilling. On a successful sign-in the modal closes; the user remains
 * on the same route with the same tool active, and the workspace
 * picks up the new session via Supabase's `onAuthStateChange`.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Mail, ArrowRight, ShieldCheck } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type LoginModalState = {
  open: boolean;
  openLogin: () => void;
  close: () => void;
};

export const useLoginModal = create<LoginModalState>((set) => ({
  open: false,
  openLogin: () => set({ open: true }),
  close: () => set({ open: false }),
}));

type Mode = "magic" | "password" | "signup";

const emailSchema = z.string().trim().email("Enter a valid email").max(255);
const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(128, "Too long");

export function LoginModal() {
  const { open, close } = useLoginModal();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  // Close automatically if a session arrives while the modal is open
  // (covers magic-link returns from another tab, or OAuth popup completion).
  useEffect(() => {
    if (!open) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "USER_UPDATED") && session) {
        close();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [open, close]);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setMagicSent(false);
      setPassword("");
      setLoading(false);
    }
  }, [open]);

  const handleMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return toast.error(parsed.error.issues[0]!.message);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? window.location.href : undefined,
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setMagicSent(true);
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = emailSchema.safeParse(email);
    if (!em.success) return toast.error(em.error.issues[0]!.message);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: em.data,
      password,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    close();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = emailSchema.safeParse(email);
    if (!em.success) return toast.error(em.error.issues[0]!.message);
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) return toast.error(pw.error.issues[0]!.message);
    setLoading(true);
    const { error, data } = await supabase.auth.signUp({
      email: em.data,
      password: pw.data,
      options: {
        emailRedirectTo:
          typeof window !== "undefined" ? window.location.href : undefined,
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      toast.success("Account created");
      close();
    } else {
      toast.success("Check your inbox to confirm your email.");
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri:
        typeof window !== "undefined" ? window.location.href : undefined,
    });
    if (result.error) {
      setLoading(false);
      toast.error("Google sign-in failed. Try again.");
      return;
    }
    if (result.redirected) return;
    setLoading(false);
    toast.success("Signed in");
    close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 transform-gpu antialiased">
        <DialogHeader className="border-b border-border bg-surface-1 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-vault/15 text-vault">
              <ShieldCheck className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="font-display text-[17px] leading-tight tracking-normal">
                Sign in to PDFMacro
              </DialogTitle>
              <DialogDescription className="mt-1 text-[12.5px] text-text-2">
                Your documents stay on this device. Sign-in only verifies your
                subscription.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-5">
          <div className="mb-4 flex gap-1 rounded-md border border-border bg-surface-2/40 p-1 text-[12px]">
            <TabBtn active={mode === "magic"} onClick={() => { setMode("magic"); setMagicSent(false); }}>
              Magic link
            </TabBtn>
            <TabBtn active={mode === "password"} onClick={() => setMode("password")}>
              Password
            </TabBtn>
            <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>
              Sign up
            </TabBtn>
          </div>

          {mode === "magic" && (
            <form onSubmit={handleMagic} className="space-y-3">
              {magicSent ? (
                <div className="rounded-md border border-vault/30 bg-vault/5 p-4 text-[13px] text-foreground">
                  <Mail className="mb-2 h-4 w-4 text-vault" />
                  Link sent to <span className="font-medium">{email}</span>.
                  Open it on this device to finish signing in — this window
                  will close automatically.
                </div>
              ) : (
                <>
                  <EmailInput value={email} onChange={setEmail} />
                  <SubmitBtn loading={loading}>Email me a link</SubmitBtn>
                </>
              )}
            </form>
          )}

          {mode === "password" && (
            <form onSubmit={handlePassword} className="space-y-3">
              <EmailInput value={email} onChange={setEmail} />
              <PasswordInput value={password} onChange={setPassword} />
              <SubmitBtn loading={loading}>Sign in</SubmitBtn>
            </form>
          )}

          {mode === "signup" && (
            <form onSubmit={handleSignup} className="space-y-3">
              <EmailInput value={email} onChange={setEmail} />
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="At least 8 characters"
              />
              <SubmitBtn loading={loading}>Create account</SubmitBtn>
            </form>
          )}

          <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wider text-text-2">
            <span className="h-px flex-1 bg-border" /> or
            <span className="h-px flex-1 bg-border" />
          </div>
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-surface-1 px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          <p className="mt-4 text-[11px] leading-relaxed text-text-2">
            By continuing you agree to our terms. We use your account only to
            verify your plan across devices.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabBtn({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-sm px-3 py-1.5 transition-colors",
        active
          ? "bg-vault text-vault-foreground"
          : "text-text-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmailInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-text-2">Email</span>
      <input
        type="email"
        autoComplete="email"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@firm.com"
        className="mt-1 w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-vault/40"
      />
    </label>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-text-2">Password</span>
      <input
        type="password"
        autoComplete="current-password"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-surface-1 px-3 py-2.5 text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-vault/40"
      />
    </label>
  );
}

function SubmitBtn({
  loading,
  children,
}: {
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-vault px-4 py-2.5 text-[13px] font-semibold text-vault-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
      {!loading ? <ArrowRight className="h-4 w-4" /> : null}
    </button>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.27c0-.74-.07-1.45-.2-2.13H12v4.04h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.54c2.07-1.91 3.25-4.72 3.25-7.97Z" />
      <path fill="#34A853" d="M12 23c2.94 0 5.4-.97 7.2-2.63l-3.53-2.75c-.98.66-2.23 1.05-3.67 1.05-2.82 0-5.21-1.9-6.06-4.46H2.27v2.81A10.99 10.99 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.94 14.21A6.6 6.6 0 0 1 5.6 12c0-.77.13-1.52.34-2.21V6.98H2.27A11 11 0 0 0 1 12c0 1.78.43 3.46 1.27 5.02l3.67-2.81Z" />
      <path fill="#EA4335" d="M12 5.38c1.6 0 3.03.55 4.16 1.62l3.12-3.12C17.4 2.09 14.94 1 12 1A10.99 10.99 0 0 0 2.27 6.98l3.67 2.81C6.79 7.28 9.18 5.38 12 5.38Z" />
    </svg>
  );
}

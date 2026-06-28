import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Lock, Mail, ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — VaultPDF" },
      {
        name: "description",
        content:
          "Sign in to manage your VaultPDF subscription. Your documents never leave your device.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type Mode = "magic" | "password" | "signup" | "forgot";

const emailSchema = z.string().trim().email("Enter a valid email").max(255);
const passwordSchema = z
  .string()
  .min(8, "At least 8 characters")
  .max(128, "Too long");

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  // If already signed in, send to workspace.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      if (data.user) navigate({ to: "/workspace" });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleMagic = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return toast.error(parsed.error.issues[0]!.message);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: { emailRedirectTo: window.location.origin + "/workspace" },
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
    navigate({ to: "/workspace" });
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
      options: { emailRedirectTo: window.location.origin + "/workspace" },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      navigate({ to: "/workspace" });
    } else {
      toast.success("Check your inbox to confirm your email.");
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const em = emailSchema.safeParse(email);
    if (!em.success) return toast.error(em.error.issues[0]!.message);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(em.data, {
      redirectTo: window.location.origin + "/reset-password",
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Reset link sent. Check your inbox.");
    setMode("password");
  };

  const handleGoogle = async () => {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setLoading(false);
      toast.error("Google sign-in failed. Try again.");
      return;
    }
    if (result.redirected) return; // browser redirects out
    setLoading(false);
    navigate({ to: "/workspace" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 h-14 flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-2 font-display tracking-tight">
            <Lock className="h-4 w-4 text-vault" strokeWidth={2.25} />
            <span className="text-base">VaultPDF</span>
          </Link>
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← Back to site
          </Link>
        </div>
      </header>

      <div className="flex-1 grid lg:grid-cols-[1fr_1.1fr]">
        {/* Left — reassurance */}
        <aside className="hidden lg:flex flex-col justify-between border-r border-border bg-card/30 p-12">
          <div>
            <div className="font-mono text-[11px] text-muted-foreground mb-6 inline-flex items-center gap-2">
              <ShieldCheck className="h-3 w-3 text-vault" />
              Account scope: subscription only
            </div>
            <h1 className="font-display leading-[1.02] tracking-tight text-4xl">
              You sign in only to manage
              <br />
              <span className="italic text-vault">your subscription.</span>
            </h1>
            <p className="mt-6 text-sm text-muted-foreground leading-relaxed max-w-md">
              Your documents never leave your device. We use your account to verify your plan
              across devices — that's the only thing that touches our servers.
            </p>
          </div>
          <ul className="space-y-3 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-vault">·</span> No files uploaded, ever
            </li>
            <li className="flex gap-2">
              <span className="text-vault">·</span> One license, every device — no key to carry
            </li>
            <li className="flex gap-2">
              <span className="text-vault">·</span> Works offline once activated
            </li>
          </ul>
        </aside>

        {/* Right — form */}
        <main className="flex items-center justify-center p-6 md:p-12">
          <div className="w-full max-w-sm">
            <div className="flex gap-1 p-1 mb-7 rounded-md border border-border bg-card/40 text-xs">
              <TabBtn active={mode === "magic"} onClick={() => { setMode("magic"); setMagicSent(false); }}>
                Magic link
              </TabBtn>
              <TabBtn active={mode === "password" || mode === "forgot"} onClick={() => setMode("password")}>
                Password
              </TabBtn>
              <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>
                Sign up
              </TabBtn>
            </div>

            {mode === "magic" && (
              <form onSubmit={handleMagic} className="space-y-4">
                <Heading title="Sign in with a magic link" sub="No password. We email you a one-click link." />
                {magicSent ? (
                  <div className="rounded-md border border-vault/30 bg-vault/5 p-4 text-sm text-foreground">
                    <Mail className="h-4 w-4 text-vault mb-2" />
                    Link sent to <span className="font-medium">{email}</span>. Open it on this device
                    to finish signing in.
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
              <form onSubmit={handlePassword} className="space-y-4">
                <Heading title="Sign in" sub="Use your email and password." />
                <EmailInput value={email} onChange={setEmail} />
                <PasswordInput value={password} onChange={setPassword} />
                <SubmitBtn loading={loading}>Sign in</SubmitBtn>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </button>
              </form>
            )}

            {mode === "forgot" && (
              <form onSubmit={handleForgot} className="space-y-4">
                <Heading title="Reset password" sub="We'll email you a reset link." />
                <EmailInput value={email} onChange={setEmail} />
                <SubmitBtn loading={loading}>Send reset link</SubmitBtn>
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  ← Back to sign in
                </button>
              </form>
            )}

            {mode === "signup" && (
              <form onSubmit={handleSignup} className="space-y-4">
                <Heading
                  title="Create an account"
                  sub="Free tools forever. Pro features unlock with a subscription."
                />
                <EmailInput value={email} onChange={setEmail} />
                <PasswordInput value={password} onChange={setPassword} placeholder="At least 8 characters" />
                <SubmitBtn loading={loading}>Create account</SubmitBtn>
              </form>
            )}

            {/* Divider + Google */}
            <div className="my-6 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2.5 text-sm font-medium hover:bg-card transition disabled:opacity-50"
            >
              <GoogleGlyph />
              Continue with Google
            </button>

            <p className="mt-8 text-[11px] text-muted-foreground leading-relaxed">
              By continuing you agree to our terms. Your documents never leave your device — your
              account is used only to verify your subscription.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function TabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 rounded-sm transition ${
        active ? "bg-vault text-vault-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-2">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function EmailInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">Email</span>
      <input
        type="email"
        autoComplete="email"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="you@firm.com"
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
      />
    </label>
  );
}

function PasswordInput({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">Password</span>
      <input
        type="password"
        autoComplete="current-password"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
      />
    </label>
  );
}

function SubmitBtn({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-vault text-vault-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
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
      <path fill="#4285F4" d="M22.5 12.27c0-.74-.07-1.45-.2-2.13H12v4.04h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.54c2.07-1.91 3.25-4.72 3.25-7.97Z"/>
      <path fill="#34A853" d="M12 23c2.94 0 5.4-.97 7.2-2.63l-3.53-2.75c-.98.66-2.23 1.05-3.67 1.05-2.82 0-5.21-1.9-6.06-4.46H2.27v2.81A10.99 10.99 0 0 0 12 23Z"/>
      <path fill="#FBBC05" d="M5.94 14.21A6.6 6.6 0 0 1 5.6 12c0-.77.13-1.52.34-2.21V6.98H2.27A11 11 0 0 0 1 12c0 1.78.43 3.46 1.27 5.02l3.67-2.81Z"/>
      <path fill="#EA4335" d="M12 5.38c1.6 0 3.03.55 4.16 1.62l3.12-3.12C17.4 2.09 14.94 1 12 1A10.99 10.99 0 0 0 2.27 6.98l3.67 2.81C6.79 7.28 9.18 5.38 12 5.38Z"/>
    </svg>
  );
}

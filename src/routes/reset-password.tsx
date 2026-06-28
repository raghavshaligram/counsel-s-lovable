import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Lock, Loader2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — VaultPDF" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

const schema = z.string().min(8, "At least 8 characters").max(128);

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Supabase delivers a recovery session via the URL hash. Wait for it.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    const pw = schema.safeParse(password);
    if (!pw.success) return toast.error(pw.error.issues[0]!.message);
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pw.data });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated.");
    navigate({ to: "/workspace" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 md:px-8 h-14 flex items-center">
          <Link to="/" className="inline-flex items-center gap-2 font-display tracking-tight">
            <Lock className="h-4 w-4 text-vault" strokeWidth={2.25} />
            <span className="text-base">VaultPDF</span>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <form onSubmit={handle} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Set a new password</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {ready
                ? "Choose a password to finish signing in."
                : "Waiting for your reset link to verify…"}
            </p>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              disabled={!ready}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40 disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={!ready || loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-vault text-vault-foreground px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </button>
          <Link to="/auth" className="block text-xs text-muted-foreground hover:text-foreground">
            ← Back to sign in
          </Link>
        </form>
      </main>
    </div>
  );
}

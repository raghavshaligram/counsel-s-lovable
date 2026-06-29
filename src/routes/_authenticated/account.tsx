import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, Mail, User as UserIcon, ShieldAlert, LogOut, KeyRound, Loader2, ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { clearLicense } from "@/lib/license-store";
import {
  getMyProfile,
  updateMyProfile,
  requestMyEmailChange,
  setMyPassword,
  deleteMyAccount,
} from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Account settings — CounselPDF" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

const nameSchema = z.string().trim().max(120);
const emailSchema = z.string().trim().toLowerCase().email().max(255);
const pwSchema = z.string().min(8).max(128);

function AccountPage() {
  const fetchProfile = useServerFn(getMyProfile);
  const qc = useQueryClient();
  const { data: profile, isPending } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <div className="mx-auto max-w-2xl px-5 py-10 md:py-14">
        <h1 className="font-display text-2xl tracking-tight">Account settings</h1>
        <p className="mt-1 text-[13px] text-text-2">
          Profile, sign-in, and security. Your documents are never stored here — only your account and subscription.
        </p>

        {isPending || !profile ? (
          <div className="mt-10 flex items-center gap-2 text-text-2 text-[13px]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading account…
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-5">
            <ProfileCard profile={profile} onSaved={() => qc.invalidateQueries({ queryKey: ["my-profile"] })} />
            <EmailCard profile={profile} onSaved={() => qc.invalidateQueries({ queryKey: ["my-profile"] })} />
            <PasswordCard profile={profile} />
            <SessionsCard />
            <DangerZone />
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-surface-1/60 backdrop-blur">
      <div className="mx-auto max-w-2xl px-5 h-12 flex items-center justify-between">
        <Link to="/workspace" className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
        </Link>
        <Link to="/billing" className="text-[12.5px] text-text-2 hover:text-foreground">
          Subscription &amp; billing →
        </Link>
      </div>
    </header>
  );
}

function Card({ title, icon, description, children }: { title: string; icon: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface-1 p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-vault">{icon}</span>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] text-text-2">{description}</p>}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ProfileCard({ profile, onSaved }: { profile: { fullName: string }; onSaved: () => void }) {
  const [name, setName] = useState(profile.fullName);
  const save = useServerFn(updateMyProfile);
  const m = useMutation({
    mutationFn: async (fullName: string) => save({ data: { fullName } }),
    onSuccess: () => { toast.success("Profile updated"); onSaved(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const dirty = name.trim() !== profile.fullName.trim();
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return toast.error("Name is too long");
    m.mutate(parsed.data);
  };
  return (
    <Card title="Profile" icon={<UserIcon className="h-3.5 w-3.5" />} description="How CounselPDF addresses you.">
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Full name</label>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe"
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] focus:border-vault/40 focus:outline-none"
        />
        <div className="mt-1 flex justify-end">
          <PrimaryButton type="submit" disabled={!dirty || m.isPending}>{m.isPending ? "Saving…" : "Save"}</PrimaryButton>
        </div>
      </form>
    </Card>
  );
}

function EmailCard({ profile, onSaved }: { profile: { email: string | null }; onSaved: () => void }) {
  const [newEmail, setNewEmail] = useState("");
  const req = useServerFn(requestMyEmailChange);
  const m = useMutation({
    mutationFn: async (e: string) => req({ data: { newEmail: e } }),
    onSuccess: (res) => { toast.success(res.message); setNewEmail(""); onSaved(); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card title="Email" icon={<Mail className="h-3.5 w-3.5" />} description="Changing your email sends a confirmation to both addresses. The change takes effect after you confirm.">
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] text-text-2">
        Current: <span className="text-foreground">{profile.email ?? "—"}</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); const p = emailSchema.safeParse(newEmail); if (!p.success) return toast.error("Enter a valid email"); m.mutate(p.data); }} className="flex flex-col gap-2">
        <label className="text-[11px] uppercase tracking-[0.12em] text-text-muted">New email</label>
        <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@firm.com" className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] focus:border-vault/40 focus:outline-none" />
        <div className="mt-1 flex justify-end">
          <PrimaryButton type="submit" disabled={!newEmail || m.isPending}>{m.isPending ? "Sending…" : "Request change"}</PrimaryButton>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard({ profile }: { profile: { hasPassword: boolean } }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const set = useServerFn(setMyPassword);
  const m = useMutation({
    mutationFn: async (newPassword: string) => set({ data: { newPassword } }),
    onSuccess: () => { toast.success(profile.hasPassword ? "Password updated" : "Password set — you can now sign in with email + password"); setPw(""); setPw2(""); },
    onError: (e) => toast.error((e as Error).message),
  });
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = pwSchema.safeParse(pw);
    if (!p.success) return toast.error(p.error.issues[0]!.message);
    if (pw !== pw2) return toast.error("Passwords do not match");
    m.mutate(p.data);
  };
  return (
    <Card title="Password" icon={<KeyRound className="h-3.5 w-3.5" />} description={profile.hasPassword ? "Change your password." : "You signed up via magic link or Google — set a password to enable email + password sign-in."}>
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={profile.hasPassword ? "New password" : "Set a password"} autoComplete="new-password" className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] focus:border-vault/40 focus:outline-none" />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" autoComplete="new-password" className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] focus:border-vault/40 focus:outline-none" />
        <div className="mt-1 flex justify-end">
          <PrimaryButton type="submit" disabled={!pw || !pw2 || m.isPending}>{m.isPending ? "Saving…" : profile.hasPassword ? "Change password" : "Set password"}</PrimaryButton>
        </div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const onSignOutEverywhere = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut({ scope: "global" });
      await clearLicense();
      toast.success("Signed out everywhere");
      navigate({ to: "/" });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSigningOut(false);
    }
  };
  return (
    <Card title="Signed-in devices" icon={<LogOut className="h-3.5 w-3.5" />} description="Supabase doesn't expose per-device session details here. You can revoke every active session from any device.">
      <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-2">
        This browser is currently signed in. Use the button below to sign out of every device — including this one.
      </div>
      <div className="flex justify-end">
        <button
          type="button" disabled={signingOut} onClick={onSignOutEverywhere}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          <LogOut className="h-3.5 w-3.5" /> {signingOut ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
    </Card>
  );
}

function DangerZone() {
  const [confirmText, setConfirmText] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const del = useServerFn(deleteMyAccount);
  const m = useMutation({
    mutationFn: async () => del(),
    onSuccess: async () => {
      await supabase.auth.signOut();
      await clearLicense();
      toast.success("Account deleted");
      navigate({ to: "/" });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <section className="rounded-md border border-destructive/40 bg-destructive/[0.04] p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-destructive/15 text-destructive">
          <ShieldAlert className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[15px] tracking-tight">Danger zone</h2>
          <p className="mt-0.5 text-[12px] text-text-2">Deleting your account cancels your subscription and removes your identity from CounselPDF. Documents you exported stay on your device.</p>
        </div>
      </div>
      {!open ? (
        <div className="mt-4 flex justify-end">
          <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-transparent px-3 py-1.5 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/10">
            Delete account
          </button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-[12px] text-text-2">Type <span className="font-mono text-foreground">DELETE</span> to confirm.</p>
          <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px] font-mono focus:border-destructive/50 focus:outline-none" placeholder="DELETE" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setOpen(false); setConfirmText(""); }} className="rounded-md px-3 py-1.5 text-[12.5px] text-text-2 hover:text-foreground">Cancel</button>
            <button disabled={confirmText !== "DELETE" || m.isPending} onClick={() => m.mutate()} className={cn("rounded-md bg-destructive px-3 py-1.5 text-[12.5px] font-medium text-destructive-foreground transition-opacity hover:opacity-90", (confirmText !== "DELETE" || m.isPending) && "opacity-50 cursor-not-allowed")}>
              {m.isPending ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={cn("inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed", rest.className)}>
      {children}
    </button>
  );
}

// Silence unused-import warnings.
void Lock; void useEffect;

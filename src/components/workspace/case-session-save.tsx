/**
 * Case Session Save — captures a manifest of the current workspace
 * session (active file metadata + Bates settings) so the user can
 * restore their setup after a browser cache wipe.
 *
 * Free core action: nothing about session save changes how the app works
 * locally. The SAVE itself is gated behind a free signup — accurate
 * messaging: it preserves/restores the session, not the file bytes.
 *
 * File bytes NEVER leave the device. On restore, the user re-attaches the
 * same file from disk and the saved settings re-apply.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import { saveCaseSession } from "@/lib/case-sessions.functions";
import { getBatesSettings, docKey } from "@/lib/workspace/bates-store";
import { cn } from "@/lib/utils";

type Props = {
  file: File | null;
  className?: string;
};

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function useCaseSessionSave(file: File | null) {
  const openLogin = useLoginModal((s) => s.openLogin);
  const [busy, setBusy] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);

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

  const save = useCallback(async () => {
    if (!file) {
      toast.error("Open a PDF first");
      return;
    }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast("Save your case session so your work isn't lost if your browser clears its cache.", {
        action: { label: "Sign in", onClick: () => openLogin() },
      });
      openLogin();
      return;
    }
    setBusy(true);
    try {
      const name = window.prompt(
        "Name this case session",
        file.name.replace(/\.pdf$/i, ""),
      );
      if (!name?.trim()) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      const key = docKey({ name: file.name, size: file.size });
      const bates = getBatesSettings(key);
      const manifest = {
        version: 1 as const,
        savedAt: new Date().toISOString(),
        file: { name: file.name, size: file.size, sha256: hash },
        bates,
      };
      await saveCaseSession({
        data: {
          name: name.trim(),
          manifest,
          sourceName: file.name,
        },
      });
      toast.success("Case session saved", {
        description: "Restore it from Account → Saved cases.",
      });
    } catch (err) {
      console.error("[case-session] save failed", err);
      toast.error("Couldn't save case session", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [file, openLogin]);

  return { save, busy, authed };
}

export function CaseSessionSaveButton({ file, className }: Props) {
  const { save, busy, authed } = useCaseSessionSave(file);


  return (
    <button
      type="button"
      onClick={save}
      disabled={busy || !file}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12px] text-foreground transition-colors hover:bg-surface-2",
        (busy || !file) && "cursor-not-allowed opacity-60",
        className,
      )}
      title={
        authed
          ? "Save current case session"
          : "Save your case session — free account preserves it across browser wipes"
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      {authed ? "Save case session" : "Save case session — free account"}
    </button>
  );
}

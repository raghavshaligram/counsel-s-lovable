/**
 * Support chips shown above the workspace command bar. Each opens the
 * SupportModal in the matching mode. Self-contained state so
 * workspace-shell only needs a single import + a single placement.
 *
 * Keyboard: pressing "?" (Shift+/) anywhere outside an input/textarea
 * opens the Help modal.
 */
import { useCallback, useEffect, useState } from "react";
import { LifeBuoy, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SupportModal, type SupportMode } from "./support-modal";

export function SupportChips() {
  const [open, setOpen] = useState<SupportMode | null>(null);
  const [defaults, setDefaults] = useState<{ name: string; email: string; signedIn: boolean }>({
    name: "",
    email: "",
    signedIn: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const u = data.user;
      if (!u) return;
      let name =
        (u.user_metadata?.full_name as string | undefined) ??
        (u.user_metadata?.name as string | undefined) ??
        "";
      if (!name) {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("user_id", u.id)
            .maybeSingle();
          if (cancelled) return;
          name = (prof?.full_name as string | undefined) ?? "";
        } catch {
          /* ignore */
        }
      }
      setDefaults({ name, email: u.email ?? "", signedIn: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // "?" shortcut opens Help. Ignore when the user is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      setOpen("help");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openHelp = useCallback(() => setOpen("help"), []);
  const openFeature = useCallback(() => setOpen("feature"), []);
  const close = useCallback(() => setOpen(null), []);

  return (
    <>
      <div className="flex items-center justify-center gap-2 px-3 pt-1.5">
        <button
          type="button"
          onClick={openHelp}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 text-[11px] text-text-2 transition-colors hover:border-vault/50 hover:bg-vault/5 hover:text-foreground"
          title="Need help? (?)"
        >
          <LifeBuoy className="h-3 w-3 text-vault" />
          Need help?
        </button>
        <button
          type="button"
          onClick={openFeature}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-1 px-2.5 py-1 text-[11px] text-text-2 transition-colors hover:border-vault/50 hover:bg-vault/5 hover:text-foreground"
          title="Request a feature"
        >
          <Lightbulb className="h-3 w-3 text-vault" />
          Request a feature
        </button>
      </div>

      <SupportModal
        open={open !== null}
        mode={open ?? "help"}
        defaultName={defaults.name}
        defaultEmail={defaults.email}
        signedIn={defaults.signedIn}
        onClose={close}
      />
    </>
  );
}

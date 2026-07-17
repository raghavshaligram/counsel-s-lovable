/**
 * Workspace top-bar announcement banner — surfaces enabled offers and
 * notifications targeted at the current user's plan. Dismissible per-user,
 * stored both locally (instant) and server-side via dismissal tables.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLicenseActivation } from "@/lib/use-license-activation";
import { cn } from "@/lib/utils";

type OfferRow = {
  id: string;
  name: string;
  description: string | null;
  discount_type: "percent" | "amount";
  discount_value: number;
  checkout_url: string | null;
  target_plan: "all" | "free" | "solo" | "firm";
};
type NotifRow = {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  target_plan: "all" | "free" | "solo" | "firm";
};

type Item =
  | { kind: "offer"; row: OfferRow }
  | { kind: "notification"; row: NotifRow };

const DISMISS_KEY = "counselpdf:dismissed-banners:v1";

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeDismissed(set: Set<string>) {
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

function discountLabel(o: OfferRow): string {
  return o.discount_type === "percent"
    ? `${o.discount_value}% off`
    : `$${o.discount_value} off`;
}

export function AnnouncementBanner() {
  const license = useLicenseActivation();
  const plan = license?.plan ?? "free";
  const [items, setItems] = useState<Item[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [offersRes, notifsRes] = await Promise.all([
        supabase
          .from("offers")
          .select("id, name, description, discount_type, discount_value, checkout_url, target_plan")
          .order("created_at", { ascending: false }),
        supabase
          .from("notifications")
          .select("id, title, body, link_url, target_plan")
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const offers = ((offersRes.data ?? []) as OfferRow[])
        .filter((o) => o.target_plan === "all" || o.target_plan === plan)
        .map((row) => ({ kind: "offer" as const, row }));
      const notifs = ((notifsRes.data ?? []) as NotifRow[])
        .filter((n) => n.target_plan === "all" || n.target_plan === plan)
        .map((row) => ({ kind: "notification" as const, row }));
      setItems([...offers, ...notifs]);
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  const visible = items.filter((it) => !dismissed.has(`${it.kind}:${it.row.id}`));
  if (visible.length === 0) return null;
  const item = visible[0];
  const key = `${item.kind}:${item.row.id}`;

  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(key);
    writeDismissed(next);
    setDismissed(next);
    // best-effort server dismissal
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      if (item.kind === "offer") {
        await supabase.from("offer_dismissals").insert({ user_id: uid, offer_id: item.row.id });
      } else {
        await supabase.from("notification_dismissals").insert({ user_id: uid, notification_id: item.row.id });
      }
    })();
  };

  const isOffer = item.kind === "offer";
  const cta = isOffer
    ? (item.row as OfferRow).checkout_url
    : (item.row as NotifRow).link_url;
  const title = isOffer ? (item.row as OfferRow).name : (item.row as NotifRow).title;
  const subtitle = isOffer
    ? `${discountLabel(item.row as OfferRow)}${(item.row as OfferRow).description ? ` — ${(item.row as OfferRow).description}` : ""}`
    : (item.row as NotifRow).body;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-[12.5px]",
        isOffer ? "bg-vault text-vault-foreground" : "bg-accent-soft text-foreground",
      )}
      role="status"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-medium">{title}</span>
        {subtitle && (
          <span className={cn("truncate", isOffer ? "opacity-90" : "text-text-2")}>
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {cta && (
          <a
            href={cta}
            target={cta.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              isOffer
                ? "bg-vault-foreground/15 hover:bg-vault-foreground/25"
                : "bg-vault text-vault-foreground hover:opacity-90",
            )}
          >
            {isOffer ? "Claim offer" : "Learn more"}
          </a>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className={cn(
            "inline-grid h-6 w-6 place-items-center rounded-md transition-colors",
            isOffer ? "hover:bg-vault-foreground/20" : "hover:bg-surface-2",
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

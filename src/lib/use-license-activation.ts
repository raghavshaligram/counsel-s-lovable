import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLicense, type LicenseSnapshot } from "./license.functions";
import { loadLicense, saveLicense, clearLicense, persistStorage } from "./license-store";

const REVALIDATE_MS = 1000 * 60 * 60 * 6; // 6h

/**
 * Shared license state — every consumer (`useIsPro`, AccountMenu, etc.)
 * subscribes to one snapshot so a single server fetch updates the whole
 * app at once. Previously each hook call had its own React state, which
 * meant gating components could lag behind the account menu and stay
 * "free" even after the server returned "solo".
 */
let current: LicenseSnapshot | null = null;
const listeners = new Set<() => void>();
function setCurrent(next: LicenseSnapshot | null) {
  current = next;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => current;
const getServerSnapshot = () => null;

let bootstrapped = false;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let cleanupAuth: (() => void) | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

async function activate(reason: string) {
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const snap = await getLicense();
    await saveLicense(snap);
    await persistStorage();
    setCurrent(snap);
    // Always log — paid gating depends on this, so a stale value is the
    // first thing to inspect when a user reports locked features.
    // eslint-disable-next-line no-console
    console.info(
      `[license] (${reason}) plan=${snap.plan} status=${snap.status} entitled=${snap.entitled}`,
    );
    subscribeRealtime(snap.userId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[license] activation failed", err);
  }
}

async function seedFromStoredLicense() {
  const [{ data }, stored] = await Promise.all([supabase.auth.getSession(), loadLicense()]);
  if (!stored) return;
  if (!data.session || stored.userId !== data.session.user.id) {
    await clearLicense();
    if (current?.userId === stored.userId) setCurrent(null);
    return;
  }
  // Discard stored snapshots older than 15 min — an admin plan grant made
  // while this tab was closed would otherwise be masked by the pre-grant
  // "free" seed until the network fetch resolves (or forever if it fails).
  const STALE_MS = 15 * 60_000;
  const seededAt = stored.validatedAt ? Date.parse(stored.validatedAt) : 0;
  if (!seededAt || Date.now() - seededAt > STALE_MS) {
    await clearLicense();
    return;
  }
  if (!current) setCurrent(stored);
}

function subscribeRealtime(userId: string) {
  // One channel per session; tear down + recreate if user changes.
  if (realtimeChannel) {
    if ((realtimeChannel as unknown as { _counselpdfUserId?: string })._counselpdfUserId === userId) {
      return;
    }
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  const ch = supabase
    .channel(`license:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "subscriptions",
        filter: `user_id=eq.${userId}`,
      },
      () => void activate("realtime"),
    )
    .subscribe();
  (ch as unknown as { _counselpdfUserId?: string })._counselpdfUserId = userId;
  realtimeChannel = ch;
}

function bootstrap() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;

  // Seed from IDB only for the current signed-in user, then immediately
  // re-fetch the live backend row on launch/auth events below.
  void seedFromStoredLicense();

  void activate("launch");

  const { data: sub } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") void activate("signed_in");
    if (event === "USER_UPDATED") void activate("user_updated");
    if (event === "TOKEN_REFRESHED") void activate("token_refreshed");
    if (event === "SIGNED_OUT") {
      void clearLicense();
      setCurrent(null);
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    }
  });
  cleanupAuth = () => sub.subscription.unsubscribe();

  interval = setInterval(() => void activate("periodic"), REVALIDATE_MS);

  const onOnline = () => void activate("online");
  const onFocus = () => void activate("focus");
  const onVisible = () => {
    if (document.visibilityState === "visible") void activate("visible");
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);

  // No teardown in practice — bootstrap runs once for the app session.
  void cleanupAuth;
  void interval;
}

/**
 * Subscribe to the shared license snapshot. Bootstraps the activation
 * loop on first use (auth listener, realtime sub on the user's
 * `subscriptions` row, periodic + focus/visibility revalidation).
 */
export function useLicenseActivation(): LicenseSnapshot | null {
  useEffect(() => {
    bootstrap();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Manual revalidate — call after actions that should refresh entitlement. */
export function refreshLicense(): Promise<void> {
  return activate("manual");
}

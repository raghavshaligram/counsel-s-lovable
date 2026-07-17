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
type LicenseStoreState = {
  license: LicenseSnapshot | null;
  checking: boolean;
};

let state: LicenseStoreState = { license: null, checking: true };
const listeners = new Set<() => void>();
function setState(patch: Partial<LicenseStoreState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getLicenseSnapshot = () => state.license;
const getStateSnapshot = () => state;
const getServerLicenseSnapshot = () => null;
const getServerStateSnapshot = () => ({ license: null, checking: true });

let bootstrapped = false;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let cleanupAuth: (() => void) | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

function normalizeLicense(
  session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>,
  row: { plan: string; status: string; current_period_end: string | null } | null,
): LicenseSnapshot {
  const plan = (row?.plan ?? "free") as LicenseSnapshot["plan"];
  const status = (row?.status ?? "active") as LicenseSnapshot["status"];
  const currentPeriodEnd = row?.current_period_end ?? null;
  const periodOk = !currentPeriodEnd || new Date(currentPeriodEnd).getTime() > Date.now();

  return {
    userId: session.user.id,
    email: session.user.email ?? null,
    plan,
    status,
    currentPeriodEnd,
    entitled: (plan === "solo" || plan === "firm") && status === "active" && periodOk,
    validatedAt: new Date().toISOString(),
  };
}

async function readLiveLicenseFromDatabase(
  session: NonNullable<Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]>,
) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) throw error;

  // eslint-disable-next-line no-console
  console.info(
    `[license] browser live read user=${session.user.id} subscriptions.plan=${data?.plan ?? "<missing>"} subscriptions.status=${data?.status ?? "<missing>"}`,
  );

  return normalizeLicense(session, data);
}

async function activate(reason: string) {
  setState({ checking: true });
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) {
      setState({ license: null, checking: false });
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState({ checking: false });
      return;
    }
    let snap: LicenseSnapshot;
    try {
      // Primary source for UI gating: the live subscriptions row read by the
      // signed-in browser session. This keeps Account menu + Pro gates aligned
      // with Billing and avoids stale server-function/browser-cache paths.
      snap = await readLiveLicenseFromDatabase(session);
    } catch (liveReadError) {
      // Server function fallback preserves entitlement checks if the direct
      // RLS-scoped read is temporarily unavailable.
      // eslint-disable-next-line no-console
      console.warn("[license] browser live read failed; falling back to server validation", liveReadError);
      snap = await getLicense();
    }
    await saveLicense(snap);
    await persistStorage();
    setState({ license: snap, checking: false });
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
    setState({ checking: false });
  }
}

async function seedFromStoredLicense() {
  const [{ data }, stored] = await Promise.all([supabase.auth.getSession(), loadLicense()]);
  if (!stored) return;
  if (!data.session || stored.userId !== data.session.user.id) {
    await clearLicense();
    if (state.license?.userId === stored.userId) setState({ license: null });
    return;
  }
  // Never seed a cached Free plan. A pre-grant Free snapshot is worse than
  // no snapshot because it visibly locks paid users before the live read lands.
  if (stored.plan === "free") {
    await clearLicense();
    return;
  }
  // Discard stored snapshots older than 60s — an admin plan grant made
  // while this tab was closed would otherwise be masked by the pre-grant
  // "free" seed until the network fetch resolves (or forever if it fails).
  const STALE_MS = 60_000;
  const seededAt = stored.validatedAt ? Date.parse(stored.validatedAt) : 0;
  if (!seededAt || Date.now() - seededAt > STALE_MS) {
    await clearLicense();
    return;
  }

  if (!state.license) setState({ license: stored });
}

function subscribeRealtime(userId: string) {
  // One channel per session; tear down + recreate if user changes.
  if (realtimeChannel) {
    if ((realtimeChannel as unknown as { _pdfmacroUserId?: string })._pdfmacroUserId === userId) {
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
  (ch as unknown as { _pdfmacroUserId?: string })._pdfmacroUserId = userId;
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
    // INITIAL_SESSION fires on every mount when a session was restored from
    // storage (hard reload with a signed-in user). Without it, the launch
    // activate() can race the session restore, return early with no session,
    // and leave the stale IDB seed on screen until the next focus/interval.
    if (event === "INITIAL_SESSION") void activate("initial_session");
    if (event === "SIGNED_IN") void activate("signed_in");
    if (event === "USER_UPDATED") void activate("user_updated");
    if (event === "TOKEN_REFRESHED") void activate("token_refreshed");
    if (event === "SIGNED_OUT") {
      void clearLicense();
      setState({ license: null, checking: false });
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
    // Re-fetch on every mount so a plan grant made while the tab was closed
    // (or missed by realtime) surfaces the moment the user navigates back
    // into any gated surface, instead of waiting for focus/6h.
    void activate("mount");
  }, []);
  return useSyncExternalStore(subscribe, getLicenseSnapshot, getServerLicenseSnapshot);
}

export function useLicenseStatus(): LicenseStoreState {
  useEffect(() => {
    bootstrap();
    void activate("mount");
  }, []);
  return useSyncExternalStore(subscribe, getStateSnapshot, getServerStateSnapshot);
}


/** Manual revalidate — call after actions that should refresh entitlement. */
export function refreshLicense(): Promise<void> {
  return activate("manual");
}

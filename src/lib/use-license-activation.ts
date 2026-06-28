import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getLicense, type LicenseSnapshot } from "./license.functions";
import { loadLicense, saveLicense, clearLicense, persistStorage } from "./license-store";

const REVALIDATE_MS = 1000 * 60 * 60 * 6; // 6h

/**
 * On sign-in: fetch license from server, save to IDB, persist storage.
 * On sign-out: clear local license.
 * On launch: if logged in, re-activate silently from the server when online.
 * While online and logged in: re-validate every 6h.
 */
export function useLicenseActivation() {
  const [license, setLicense] = useState<LicenseSnapshot | null>(null);

  // initial load from IDB so offline starts know the plan immediately
  useEffect(() => {
    void loadLicense().then((l) => l && setLicense(l));
  }, []);

  // activate / re-activate when there's a session
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const activate = async (reason: string) => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        if (typeof navigator !== "undefined" && navigator.onLine === false) return;
        const snap = await getLicense();
        if (cancelled) return;
        await saveLicense(snap);
        await persistStorage();
        setLicense(snap);
        if (import.meta.env.DEV) console.debug("[license]", reason, snap);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[license] activation failed", err);
      }
    };

    void activate("launch");

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") void activate("signed_in");
      if (event === "USER_UPDATED") void activate("user_updated");
      if (event === "TOKEN_REFRESHED") void activate("token_refreshed");
      if (event === "SIGNED_OUT") {
        void clearLicense();
        setLicense(null);
      }
    });

    interval = setInterval(() => void activate("periodic"), REVALIDATE_MS);

    const onOnline = () => void activate("online");
    if (typeof window !== "undefined") window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      if (interval) clearInterval(interval);
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    };
  }, []);

  return license;
}

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { requestPersistentStorage } from "../lib/storage-persist";
import { isChunkLoadError, reloadForFreshChunks } from "../lib/chunk-import";
import { useLicenseActivation } from "../lib/use-license-activation";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/upgrade-modal";
import { LoginModal } from "@/components/login-modal";
import { CertificateGate } from "@/components/workspace/certificate-gate";
import { ConfirmDialogHost } from "@/components/confirm-dialog";
import { UnsupportedBrowserGate } from "@/components/unsupported-browser";
import { initNetworkIsolation } from "@/lib/network-isolation";
import { installRuntimePressureListener } from "@/lib/runtime-pressure";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CounselPDF — PDFs that never leave your browser" },
      {
        name: "description",
        content:
          "Privacy-architected PDF toolkit. Redact, sign, mail-merge, and extract tables 100% in your browser. No uploads, no limits.",
      },
      { name: "theme-color", content: "#0E1116" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "CounselPDF" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "CounselPDF",
          description:
            "Privacy-architected PDF toolkit that runs entirely in your browser.",
          publisher: {
            "@type": "Organization",
            name: "CounselPDF",
          },
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Inline ES5 script — runs during HTML parse so it executes even on engines
// (IE10/11, Edge Legacy / EdgeHTML) that cannot parse the modern module
// bundle. Renders a compliance-styled block screen if a legacy engine is
// detected. ES5 only: no const/let, no arrows, no template literals.
const LEGACY_ENGINE_BLOCK_SCRIPT = `(function(){try{var ua=navigator.userAgent||"";var isIE=/MSIE |Trident\\//.test(ua);var isEdgeLegacy=/Edge\\/[0-9]+/.test(ua);if(!isIE&&!isEdgeLegacy)return;document.documentElement.style.overflow="hidden";var overlay=document.createElement("div");overlay.setAttribute("role","alertdialog");overlay.setAttribute("aria-modal","true");overlay.style.cssText="position:fixed;inset:0;top:0;left:0;right:0;bottom:0;width:100%;height:100%;z-index:2147483647;background:rgba(14,17,22,0.72);display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";var card=document.createElement("div");card.style.cssText="max-width:560px;width:100%;background:#FFFFFF;border:1px solid #E5E7EB;border-top:4px solid #B91C1C;border-radius:12px;padding:32px;box-shadow:0 20px 50px rgba(0,0,0,0.35);text-align:left;";var eyebrow=document.createElement("div");eyebrow.style.cssText="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#B91C1C;font-weight:600;margin-bottom:12px;";eyebrow.appendChild(document.createTextNode("\\u26A0 Compliance Alert \\u00B7 Insecure Engine Detected"));var h1=document.createElement("h1");h1.style.cssText="font-size:20px;font-weight:600;color:#0E1116;margin:0 0 12px 0;line-height:1.3;";h1.appendChild(document.createTextNode("This secure legal workspace cannot run on this browser engine."));var body=document.createElement("p");body.style.cssText="font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px 0;";body.appendChild(document.createTextNode("You are trying to access this secure legal workspace using an unsupported or legacy browser framework. Legacy engines do not support modern client-side sandboxing. Running privileged client documents on obsolete engines risks data leakage and violates standard legal data compliance rules."));var label=document.createElement("div");label.style.cssText="font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;margin-bottom:10px;";label.appendChild(document.createTextNode("Please reopen this workspace in"));var row=document.createElement("div");row.style.cssText="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;";var browsers=[["Microsoft Edge","https://www.microsoft.com/edge"],["Google Chrome","https://www.google.com/chrome/"],["Mozilla Firefox","https://www.mozilla.org/firefox/new/"]];for(var i=0;i<browsers.length;i++){var a=document.createElement("a");a.href=browsers[i][1];a.target="_blank";a.rel="noopener noreferrer";a.style.cssText="display:inline-block;padding:8px 14px;border:1px solid #D1D5DB;border-radius:999px;font-size:13px;font-weight:500;color:#0E1116;text-decoration:none;background:#F9FAFB;";a.appendChild(document.createTextNode(browsers[i][0]));row.appendChild(a);}var foot=document.createElement("div");foot.style.cssText="font-size:12px;color:#6B7280;border-top:1px solid #E5E7EB;padding-top:14px;line-height:1.5;";foot.appendChild(document.createTextNode("Your documents are processed on-device. We can only guarantee that on a modern browser."));card.appendChild(eyebrow);card.appendChild(h1);card.appendChild(body);card.appendChild(label);card.appendChild(row);card.appendChild(foot);overlay.appendChild(card);function attach(){if(document.body){document.body.appendChild(overlay);}else{setTimeout(attach,30);}}attach();}catch(e){}})();`;

const LEGACY_ENGINE_NOSCRIPT = `<div style="position:fixed;inset:0;z-index:2147483647;background:#FFFFFF;color:#0E1116;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;text-align:center;"><div style="max-width:480px;"><div style="color:#B91C1C;font-weight:600;text-transform:uppercase;letter-spacing:.15em;font-size:11px;margin-bottom:12px;">Compliance Alert</div><h1 style="font-size:18px;margin:0 0 12px;">JavaScript is required for this secure legal workspace.</h1><p style="font-size:14px;color:#374151;">Please enable JavaScript or open this link in Microsoft Edge, Google Chrome, Mozilla Firefox, or Safari.</p></div></div>`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: LEGACY_ENGINE_BLOCK_SCRIPT }} />
        <noscript dangerouslySetInnerHTML={{ __html: LEGACY_ENGINE_NOSCRIPT }} />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useLicenseActivation();

  // Global auth-state navigation. On sign-out, return to the public home so
  // signed-out users land on the landing page (not a stale protected route).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        void router.navigate({ to: "/" });
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void router.invalidate();
        void queryClient.invalidateQueries();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);



  useEffect(() => {
    const onPreloadError = (event: Event) => {
      const error = (event as Event & { payload?: unknown }).payload;
      if (!isChunkLoadError(error)) return;
      event.preventDefault();
      reloadForFreshChunks();
    };
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error ?? event.message)) {
        event.preventDefault();
        reloadForFreshChunks();
      }
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        event.preventDefault();
        reloadForFreshChunks();
      }
    };

    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    // Install the network-isolation shim early and apply the persisted preference.
    initNetworkIsolation();
    // Ask the browser to make our IndexedDB durable. Logs the outcome.
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV) return; // skip SW in dev to avoid stale chunks

    const READY_KEY = "counselpdf:offline-ready-notified";
    const wasControlled = Boolean(navigator.serviceWorker.controller);

    const notifyReady = () => {
      try {
        if (window.localStorage.getItem(READY_KEY) === "1") return;
        window.localStorage.setItem(READY_KEY, "1");
      } catch {
        /* ignore */
      }
      toast.success("CounselPDF is ready to work offline", {
        description: "You can disconnect anytime — everything stays on this device.",
        duration: 6000,
      });
    };

    void navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // First-load case: no controller yet. Wait for the worker to activate,
        // which means the app shell is precached and offline use is safe.
        if (!wasControlled) {
          const worker = registration.installing ?? registration.waiting ?? registration.active;
          if (!worker) return;
          if (worker.state === "activated") {
            notifyReady();
            return;
          }
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated") notifyReady();
          });
        }
      })
      .catch(() => {});
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <UpgradeModal />
      <LoginModal />
      <CertificateGate />
      <ConfirmDialogHost />
      <Toaster
        theme="dark"
        position="bottom-center"
        closeButton
        richColors={false}
        duration={4000}
        offset={24}
        visibleToasts={4}
      />
      <UnsupportedBrowserGate />
    </QueryClientProvider>
  );
}

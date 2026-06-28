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
import { Toaster, toast } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { requestPersistentStorage } from "../lib/storage-persist";
import { isChunkLoadError, reloadForFreshChunks } from "../lib/chunk-import";
import { useLicenseActivation } from "../lib/use-license-activation";
import { supabase } from "@/integrations/supabase/client";
import { UpgradeModal } from "@/components/upgrade-modal";
import { LoginModal } from "@/components/login-modal";

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
      { title: "VaultPDF — PDFs that never leave your browser" },
      {
        name: "description",
        content:
          "Privacy-architected PDF toolkit. Redact, sign, mail-merge, and extract tables 100% in your browser. No uploads, no limits.",
      },
      { name: "theme-color", content: "#0E1116" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "VaultPDF" },
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
          name: "VaultPDF",
          description:
            "Privacy-architected PDF toolkit that runs entirely in your browser.",
          publisher: {
            "@type": "Organization",
            name: "VaultPDF",
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

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
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
    // Ask the browser to make our IndexedDB durable. Logs the outcome.
    void requestPersistentStorage();
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (import.meta.env.DEV) return; // skip SW in dev to avoid stale chunks

    const READY_KEY = "vaultpdf:offline-ready-notified";
    const wasControlled = Boolean(navigator.serviceWorker.controller);

    const notifyReady = () => {
      try {
        if (window.localStorage.getItem(READY_KEY) === "1") return;
        window.localStorage.setItem(READY_KEY, "1");
      } catch {
        /* ignore */
      }
      toast.success("VaultPDF is ready to work offline", {
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
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  );
}

import { createStart, createMiddleware, type CustomFetch } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const noStoreServerFnFetch = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const noStoreFetch: CustomFetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("cache-control", "no-store");
    headers.set("pragma", "no-cache");
    return fetch(input, { ...init, cache: "no-store", headers });
  };

  return next({
    fetch: noStoreFetch,
    headers: {
      "cache-control": "no-store",
      pragma: "no-cache",
    },
  });
});

export const startInstance = createStart(() => ({
  functionMiddleware: [noStoreServerFnFetch, attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));

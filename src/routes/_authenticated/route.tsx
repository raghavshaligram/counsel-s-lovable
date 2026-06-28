/**
 * Authenticated layout — gates every child route. The integration's pattern:
 * client-only beforeLoad checks the Supabase session and bounces to /auth,
 * preserving the original href so we can return after sign-in.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({
        to: "/auth",
        search: { redirect: location.href } as never,
      });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});

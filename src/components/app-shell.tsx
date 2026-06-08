import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Sparkles, LayoutGrid, Wrench } from "lucide-react";

const NAV = [
  { to: "/", label: "Catalog", icon: LayoutGrid },
  { to: "/admin", label: "Admin", icon: Wrench },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="min-h-screen flex flex-col bg-[var(--studio-bg)] text-foreground">
      <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-background/80 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span>GridPulse</span>
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((n) => {
            const active = n.to === "/" ? pathname === "/" : pathname.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <n.icon className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

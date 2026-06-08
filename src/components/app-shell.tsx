import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Public shell — end-user facing only.
// Operator surfaces (/admin, AST editor, Co-Pilot) are intentionally NOT linked here.
// They live behind direct URLs now and will be gated by the `operator` role in Phase 3.

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--studio-bg)] text-foreground">
      <header className="h-14 flex items-center justify-between px-6 md:px-10 border-b border-border bg-background/60 backdrop-blur">
        <Link to="/" className="flex items-center gap-3">
          <span className="grid h-6 w-6 place-items-center rounded-sm bg-foreground text-background font-display text-[13px] leading-none">
            g
          </span>
          <span className="font-display text-[15px] tracking-tight">GridPulse</span>
          <span className="hidden sm:inline text-[11px] uppercase tracking-[0.22em] text-muted-foreground border-l border-border pl-3 ml-1">
            Studio
          </span>
        </Link>
        <div className="hidden sm:flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="h-1 w-1 rounded-full bg-foreground/40" />
          Layout locked · Type, swap, ship
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

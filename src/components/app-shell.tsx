import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

// Public shell — end-user facing only.
// Operator surfaces (/admin, AST editor, Co-Pilot) are intentionally NOT linked here.
// They live behind direct URLs now and will be gated by the `operator` role in Phase 3.

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--studio-bg)] text-foreground">
      <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-background/80 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span>GridPulse</span>
        </Link>
        <div className="text-xs text-muted-foreground hidden sm:block">
          Templates that always look right.
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}


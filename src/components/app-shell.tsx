import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 h-14 flex items-center justify-between px-5 md:px-8 border-b border-border bg-background/80 backdrop-blur-xl">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-vault text-vault-foreground">
            <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-[19px] leading-none">VaultPDF</span>
          <span className="hidden sm:inline text-[10px] uppercase tracking-[0.22em] text-muted-foreground border-l border-border pl-3 ml-1">
            100% in your browser
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1 text-sm">
          <Link to="/redact" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Redact</Link>
          <Link to="/merge" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Mail Merge</Link>
          <Link to="/extract" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Extract</Link>
          <span className="mx-1 h-4 w-px bg-border" />
          <Link to="/split" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Split</Link>
          <Link to="/rotate" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Rotate</Link>
          <Link to="/watermark" className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" activeProps={{ className: "text-foreground bg-accent" }}>Watermark</Link>
        </nav>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-vault" />
          <span className="hidden sm:inline">Files never leave this tab</span>
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
      <footer className="border-t border-border px-5 md:px-8 py-6 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
        <div>© {new Date().getFullYear()} VaultPDF · The PDF toolkit for documents you'd never upload.</div>
        <div className="flex gap-4">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <a href="#trust" className="hover:text-foreground">How privacy works</a>
        </div>
      </footer>
    </div>
  );
}

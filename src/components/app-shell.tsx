import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Lock, Menu, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const heroTools = [
  { to: "/redact", label: "Redact", short: "Redact", icon: ShieldCheckIcon, desc: "AI-powered PII detection & removal" },
  { to: "/sign", label: "Sign & Fill", short: "Sign", icon: PenIcon, desc: "Draw, type, or upload your signature" },
  { to: "/chat", label: "Search inside PDF", short: "Search", icon: ChatIcon, desc: "Find any passage in a PDF instantly — local BM25 search", beta: true },
  { to: "/merge", label: "Mail Merge", short: "Merge", icon: FileStackIcon, desc: "Batch fill PDFs from CSV data" },
  { to: "/extract", label: "Extract", short: "Extract", icon: Table2Icon, desc: "Pull tables & text from PDFs" },
];

const utilities = [
  { to: "/ocr", label: "Make Searchable", short: "OCR", icon: ScanTextIcon, desc: "On-device OCR for scanned PDFs" },
  { to: "/split", label: "Split", short: "Split", icon: ScissorsIcon, desc: "Separate pages into new PDFs" },
  { to: "/rotate", label: "Rotate", short: "Rotate", icon: RotateCwIcon, desc: "Fix page orientation" },
  { to: "/watermark", label: "Watermark", short: "Stamp", icon: StampIcon, desc: "Add text stamps to pages" },
];

function ScanTextIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8h8" /><path d="M7 12h10" /><path d="M7 16h6" />
    </svg>
  );
}

function ShieldCheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
      <path d="M8 12h.01" /><path d="M12 12h.01" /><path d="M16 12h.01" />
    </svg>
  );
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function FileStackIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 7h-3a2 2 0 0 1-2-2V2" /><path d="M21 6v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2z" />
      <path d="M7 13h10" /><path d="M7 17h10" />
    </svg>
  );
}

function Table2Icon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 3H5a2 2 0 0 0-2 2v4" /><path d="M9 3h10a2 2 0 0 1 2 2v4" />
      <path d="M3 9v10a2 2 0 0 0 2 2h4" /><path d="M21 9v10a2 2 0 0 1-2 2h-4" />
      <rect width="8" height="8" x="9" y="9" rx="2" />
    </svg>
  );
}

function ScissorsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="6" cy="6" r="3" /><path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" /><circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" /><path d="M20 20v.01" />
    </svg>
  );
}

function RotateCwIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
    </svg>
  );
}

function StampIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18.5 12.5V10a2.5 2.5 0 0 0-2.5-2.5h-8A2.5 2.5 0 0 0 5.5 10v2.5" />
      <path d="M5.5 12.5 2 22h20l-3.5-9.5" /><path d="M12 2v8" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentPath = useRouterState({ select: (s) => s.location.pathname });

  const isActive = (path: string) => currentPath === path;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 h-14 flex items-center justify-between px-4 md:px-8 border-b border-border bg-background/80 backdrop-blur-xl">
        {/* Brand */}
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-vault text-vault-foreground">
            <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-[19px] leading-none">VaultPDF</span>
          <span className="hidden lg:inline text-[10px] uppercase tracking-[0.22em] text-muted-foreground border-l border-border pl-3 ml-1">
            100% in your browser
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-0.5 text-[13px]">
          {heroTools.map((t) => (
            <NavLink key={t.to} to={t.to} label={t.short} icon={t.icon} beta={(t as any).beta} />
          ))}
          <span className="mx-1.5 h-4 w-px bg-border" />
          {utilities.map((t) => (
            <NavLink key={t.to} to={t.to} label={t.short} icon={t.icon} />
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Link
            to="/pricing"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-vault/40 bg-vault/10 hover:bg-vault/20 text-vault px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.14em] transition-colors"
            activeProps={{ className: "bg-vault/25" }}
          >
            Lifetime deal
          </Link>

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent transition-colors">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] sm:w-[360px] p-0 border-l border-border bg-background">
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <div className="flex flex-col h-full">
                {/* Mobile header */}
                <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
                  <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded-md bg-vault text-vault-foreground">
                      <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </span>
                    <span className="font-display text-[19px] leading-none">VaultPDF</span>
                  </Link>
                </div>

                {/* Mobile scrollable content */}
                <div className="flex-1 overflow-y-auto py-4">
                  <MobileGroup title="Hero Tools" items={heroTools} currentPath={currentPath} onNavigate={() => setMobileOpen(false)} />
                  <div className="mx-5 my-3 h-px bg-border" />
                  <MobileGroup title="Utilities" items={utilities} currentPath={currentPath} onNavigate={() => setMobileOpen(false)} />
                  <div className="mx-5 my-3 h-px bg-border" />
                  <div className="px-3">
                    <Link
                      to="/pricing"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 border border-vault/40 bg-vault/10 hover:bg-vault/20 transition-colors"
                    >
                      <div>
                        <div className="text-sm font-medium text-vault">Lifetime deal</div>
                        <div className="text-xs text-muted-foreground mt-0.5">One payment, every tool, forever.</div>
                      </div>
                      <span className="text-vault text-xs">→</span>
                    </Link>
                  </div>
                </div>

                {/* Mobile footer */}
                <div className="px-5 py-4 border-t border-border shrink-0">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-vault" />
                    <span>Files never leave this tab</span>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1 min-h-0">{children}</main>

      <footer className="border-t border-border px-5 md:px-8 py-6 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
        <div>&copy; {new Date().getFullYear()} VaultPDF &middot; The PDF toolkit for documents you&apos;d never upload.</div>
        <div className="flex gap-4">
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
          <a href="/#trust" className="hover:text-foreground">How privacy works</a>
        </div>
      </footer>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  beta,
}: {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
  beta?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors",
        "text-muted-foreground hover:text-foreground hover:bg-accent"
      )}
      activeProps={{
        className: cn(
          "text-foreground bg-accent",
          "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-vault"
        ),
      }}
    >
      <Icon className="h-3.5 w-3.5 opacity-70" />
      <span>{label}</span>
      {beta && (
        <span className="text-[9px] uppercase tracking-[0.16em] rounded-sm bg-vault/15 text-vault px-1 py-px">
          Beta
        </span>
      )}
    </Link>
  );
}

function MobileGroup({
  title,
  items,
  currentPath,
  onNavigate,
}: {
  title: string;
  items: typeof heroTools;
  currentPath: string;
  onNavigate: () => void;
}) {
  return (
    <div className="px-3">
      <div className="px-2 mb-1.5 text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-medium">
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const active = currentPath === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={cn(
                "flex items-start gap-3 rounded-lg px-3 py-3 transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              )}
            >
              <div className={cn(
                "mt-0.5 grid h-8 w-8 place-items-center rounded-md shrink-0",
                active ? "bg-vault/15 text-vault" : "bg-secondary text-muted-foreground"
              )}>
                <item.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn("text-sm font-medium", active && "text-foreground")}>{item.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</div>
              </div>
              {active && (
                <div className="mt-1.5 h-2 w-2 rounded-full bg-vault shrink-0" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

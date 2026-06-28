import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Lock, Menu, Layers, ListTree, Crop } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
  SheetHeader,
} from "@/components/ui/sheet";
import { TrayDock } from "@/components/tray/tray-dock";

type Tool = { to: string; label: string; desc: string; icon: any; beta?: boolean };
type Group = { id: string; label: string; tagline: string; items: Tool[] };

const groups: Group[] = [
  {
    id: "organize",
    label: "Organize",
    tagline: "Reshape pages without uploading them.",
    items: [
      { to: "/organize", label: "Organize Pages", icon: Layers, desc: "Cross-document page grid — drag, rotate, build" },
      { to: "/merge", label: "Mail Merge", icon: FileStackIcon, desc: "Batch fill PDFs from CSV data" },
      { to: "/split", label: "Split", icon: ScissorsIcon, desc: "Separate pages into new PDFs" },
      { to: "/rotate", label: "Rotate", icon: RotateCwIcon, desc: "Fix page orientation" },
      { to: "/extract", label: "Extract", icon: Table2Icon, desc: "Pull tables & text from PDFs" },
    ],
  },
  {
    id: "convert",
    label: "Convert",
    tagline: "Move between formats — fully on-device.",
    items: [
      { to: "/to-word", label: "PDF → Word", icon: FileTextIcon, desc: "Editable .docx from any text PDF" },
      { to: "/word-to-pdf", label: "Word → PDF", icon: WordToPdfIcon, desc: "Convert .docx to a clean PDF" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    tagline: "Mark up, sign, and shrink in the browser.",
    items: [
      { to: "/editor", label: "Editor", icon: EditIcon, desc: "Edit pages, text, images — and annotate" },
      { to: "/sign", label: "Sign & Fill", icon: PenIcon, desc: "Draw, type, or upload your signature" },
      { to: "/watermark", label: "Watermark", icon: StampIcon, desc: "Add text stamps to pages" },
      { to: "/redact", label: "Redact", icon: ShieldCheckIcon, desc: "AI-powered PII detection & removal" },
      { to: "/compress", label: "Compress", icon: CompressIcon, desc: "Shrink PDFs without uploading" },
    ],
  },
  {
    id: "secure",
    label: "Secure",
    tagline: "Lock, unlock, and verify your documents.",
    items: [
      { to: "/protect", label: "Protect", icon: Lock, desc: "Password-encrypt PDFs with AES-128" },
      { to: "/unlock", label: "Unlock", icon: UnlockIcon, desc: "Remove password from PDFs you own" },
      { to: "/compare", label: "Compare", icon: CompareIcon, desc: "Visual diff between two PDFs" },
      { to: "/ocr", label: "Make Searchable", icon: ScanTextIcon, desc: "On-device OCR for scanned PDFs" },
    ],
  },
  {
    id: "structure",
    label: "Structure",
    tagline: "Re-shape, number, and lock down documents.",
    items: [
      { to: "/outline", label: "Outline & Links", icon: ListTree, desc: "Edit bookmarks tree and link annotations" },
      { to: "/crop", label: "Crop", icon: Crop, desc: "Trim pages with rulers, presets, auto-detect" },

      { to: "/page-numbers", label: "Page Numbers", icon: HashIcon, desc: "Stamp numbers — position, format, skip first N" },
      { to: "/header-footer", label: "Header & Footer", icon: HashIcon, desc: "Custom text with tokens — {page}, {date}, {filename}" },
      { to: "/flatten", label: "Flatten", icon: Lock, desc: "Bake forms and annotations into static content" },
      { to: "/to-excel", label: "PDF → Excel", icon: Table2Icon, desc: "Lift tables into editable .xlsx" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    tagline: "Courtroom-grade tooling for paralegals and counsel.",
    items: [
      { to: "/bates", label: "Bates Numbering", icon: HashIcon, desc: "Stamp sequential discovery IDs across every page" },
      { to: "/verifiable-redaction", label: "Verifiable Redaction", icon: ShieldCheckIcon, desc: "Mandatory codes + signed Certificate + Privilege Log" },
      { to: "/privilege-scan", label: "Privilege Scan", icon: ScanSearchIcon, desc: "Catch attorney–client language before production" },
    ],
  },
  {
    id: "ai",
    label: "AI",
    tagline: "Smart features that still respect your privacy.",
    items: [
      { to: "/chat", label: "Search inside PDF", icon: ChatIcon, desc: "Find any passage instantly — local BM25 search", beta: true },
    ],
  },
];

const primaryNav: { to: string; label: string }[] = [
  { to: "/workspace", label: "Workspace" },
  { to: "/redact", label: "Redact" },
  { to: "/sign", label: "Sign & Fill" },
  { to: "/protect", label: "Protect" },
  { to: "/merge", label: "Merge" },
];


function HashIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <line x1="10" y1="3" x2="8" y2="21" />
      <line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function ScanSearchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="m16 16-2-2" />
    </svg>
  );
}


function WordToPdfIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h2l1 4 1-4 1 4 1-4h2" />
    </svg>
  );
}

function CompareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v18" />
      <path d="M5 7h4v10H5z" />
      <path d="M15 7h4v10h-4z" />
    </svg>
  );
}

function UnlockIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function ImagesPlusIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h7" />
      <circle cx="9" cy="11" r="2" />
      <path d="m21 17-3.5-3.5L9 21" />
      <path d="M18 2v6" /><path d="M15 5h6" />
    </svg>
  );
}

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" /><path d="M8 13h8" /><path d="M8 17h6" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5-9 9" />
    </svg>
  );
}

function CompressIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

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

function ToolCard({ tool, onClick, isActive }: { tool: Tool; onClick?: () => void; isActive?: boolean }) {
  return (
    <Link
      to={tool.to}
      onClick={onClick}
      className={cn(
        "group/card flex items-start gap-3 rounded-lg p-3 hover:bg-accent/60 transition-colors",
        isActive && "bg-vault/10 ring-1 ring-vault/20"
      )}
    >
      <span className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-md bg-vault/10 text-vault group-hover/card:bg-vault/20 transition-colors",
        isActive && "bg-vault/20"
      )}>
        <tool.icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-medium leading-tight", isActive && "text-vault")}>{tool.label}</span>
          {tool.beta && (
            <span className="text-[9px] uppercase tracking-[0.16em] rounded-sm bg-vault/15 text-vault px-1 py-px">Beta</span>
          )}
        </div>
        <p className={cn("text-xs text-muted-foreground mt-0.5 leading-snug", isActive && "text-vault/70")}>{tool.desc}</p>
      </div>
    </Link>
  );
}

function MegaPanel({ group, isActive }: { group: Group; isActive: (path: string) => boolean }) {
  return (
    <div className="w-[640px] p-4">
      <div className="grid grid-cols-[1fr_180px] gap-4">
        <div className="grid grid-cols-2 gap-1">
          {group.items.map((t) => (
            <ToolCard key={t.to} tool={t} isActive={isActive(t.to)} />
          ))}
        </div>
        <div className="rounded-lg border border-vault/20 bg-vault/5 p-4 flex flex-col justify-between">
          <div>
            <div className="font-display text-base text-vault">{group.label}</div>
            <p className="text-sm text-muted-foreground mt-2 leading-snug">{group.tagline}</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-4">
            <span className="h-1.5 w-1.5 rounded-full bg-vault" />
            <span>Stays in your tab</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AllToolsPanel({ isActive }: { isActive: (path: string) => boolean }) {
  return (
    <div className="w-[860px] p-3 grid grid-cols-3 gap-x-4 gap-y-3">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="font-display text-xs text-vault mb-1.5 px-1">{group.label}</div>
          <div className="flex flex-col">
            {group.items.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60 transition-colors",
                  isActive(t.to) && "bg-vault/10"
                )}
              >
                <span className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded bg-vault/10 text-vault",
                  isActive(t.to) && "bg-vault/20"
                )}>
                  <t.icon className="h-3.5 w-3.5" />
                </span>
                <span className={cn("text-sm leading-tight truncate", isActive(t.to) && "text-vault font-medium")}>
                  {t.label}
                </span>
                {t.beta && (
                  <span className="text-[9px] uppercase tracking-[0.16em] rounded-sm bg-vault/15 text-vault px-1 py-px ml-auto">Beta</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}



export function AppShell({ children }: { children: ReactNode }) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const isActive = (path: string) => currentPath === path;

  return (
    <div className="flex min-h-svh w-full flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="flex h-14 items-center justify-between px-4 md:px-6 gap-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-vault text-vault-foreground">
              <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <span className="font-display text-[19px] leading-none">VaultPDF</span>
          </Link>

          {/* Desktop nav — 5 primary tools + All tools disclosure */}
          <NavigationMenu className="hidden md:flex flex-1 justify-center">
            <NavigationMenuList className="gap-1">
              {primaryNav.map((p) => (
                <NavigationMenuItem key={p.to}>
                  <Link
                    to={p.to}
                    className={cn(
                      "inline-flex h-9 items-center rounded-md px-3 text-sm transition-colors hover:bg-accent/60",
                      isActive(p.to) && "text-vault"
                    )}
                  >
                    {p.label}
                  </Link>
                </NavigationMenuItem>
              ))}
              <NavigationMenuItem>
                <NavigationMenuTrigger
                  className={cn(
                    "h-9 bg-transparent text-sm",
                    groups.some((g) => g.items.some((t) => isActive(t.to))) &&
                      !primaryNav.some((p) => isActive(p.to)) &&
                      "text-vault"
                  )}
                >
                  All tools
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <AllToolsPanel isActive={isActive} />
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>


          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden xl:inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-text-2">
              <Lock className="h-3 w-3 text-vault" strokeWidth={2} />
              100% in your browser
            </span>
            <Link
              to="/pricing"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-vault px-3.5 py-1.5 text-sm font-medium text-vault-foreground hover:opacity-90 transition-opacity"
            >
              Lifetime deal
            </Link>



            {/* Mobile trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
                >
                  <Menu className="h-4 w-4" />
                </button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[320px] sm:w-[380px] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>All tools</SheetTitle>
                </SheetHeader>
                <div className="mt-4 space-y-6">
                  {groups.map((group) => (
                    <div key={group.id}>
                      <div className="font-display text-sm text-vault mb-2 px-1">
                        {group.label}
                      </div>

                      <div className="flex flex-col">
                        {group.items.map((t) => (
                          <ToolCard key={t.to} tool={t} onClick={() => setMobileOpen(false)} isActive={isActive(t.to)} />
                        ))}
                      </div>
                    </div>
                  ))}
                  <Link
                    to="/pricing"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-3 border border-vault/40 bg-vault/10 hover:bg-vault/20 transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium text-vault">Lifetime deal</div>
                      <div className="text-xs text-muted-foreground mt-0.5">One payment, every tool, forever.</div>
                    </div>
                    <span className="text-vault text-xs">→</span>
                  </Link>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 pb-28">{children}</main>

      <footer className="border-t border-border px-5 md:px-8 py-6 pb-28 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>&copy; {new Date().getFullYear()} VaultPDF &middot; The PDF toolkit for documents you&apos;d never upload.</div>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/verify-privacy" className="text-vault hover:underline underline-offset-4 font-medium">Verify our privacy</Link>
          <Link to="/security-architecture" className="text-vault hover:underline underline-offset-4 font-medium">Security</Link>
          <span className="text-border">·</span>
          <Link to="/" className="hover:text-foreground">Home</Link>
          <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
        </div>
      </footer>

      <TrayDock />
    </div>
  );
}

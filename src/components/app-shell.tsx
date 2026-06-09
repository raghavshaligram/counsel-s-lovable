import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

const secureTools = [
  { to: "/redact", label: "Redact", icon: ShieldCheckIcon },
  { to: "/protect", label: "Protect", icon: Lock },
  { to: "/unlock", label: "Unlock", icon: UnlockIcon },
  { to: "/sign", label: "Sign & Fill", icon: PenIcon },
];

const editTools = [
  { to: "/editor", label: "Editor", icon: EditIcon },
  { to: "/split", label: "Split", icon: ScissorsIcon },
  { to: "/rotate", label: "Rotate", icon: RotateCwIcon },
  { to: "/watermark", label: "Watermark", icon: StampIcon },
  { to: "/compress", label: "Compress", icon: CompressIcon },
  { to: "/ocr", label: "Make Searchable", icon: ScanTextIcon },
];

type NavItem = { to: string; label: string; icon: (p: { className?: string }) => ReactNode; beta?: boolean };

const convertGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "From PDF",
    items: [
      { to: "/to-word", label: "PDF → Word", icon: FileTextIcon },
      { to: "/to-images", label: "PDF → Images", icon: ImageIcon },
      { to: "/extract", label: "Extract", icon: Table2Icon },
      { to: "/chat", label: "Search inside PDF", icon: ChatIcon, beta: true },
    ],
  },
  {
    label: "To PDF",
    items: [
      { to: "/images-to-pdf", label: "Images → PDF", icon: ImagesPlusIcon },
      { to: "/merge", label: "Mail Merge", icon: FileStackIcon },
    ],
  },
];

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

function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const mark = size === "sm" ? "h-7 w-7" : "h-7 w-7";
  const text = size === "sm" ? "text-[17px]" : "text-[19px]";
  return (
    <Link to="/" className="flex items-center gap-2.5 min-w-0">
      <span className={cn("grid place-items-center rounded-md bg-vault text-vault-foreground shrink-0", mark)}>
        <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <span className={cn("font-display leading-none truncate", text)}>VaultPDF</span>
    </Link>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { state, isMobile } = useSidebar();
  const currentPath = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (path: string) => currentPath === path;
  const collapsed = state === "collapsed" || isMobile;

  return (
    <>
      {/* Full-width top bar */}
      <header className="sticky top-0 z-40 h-14 flex items-center justify-between border-b border-slate-800/70 bg-background/85 backdrop-blur-xl pl-4 pr-4 md:pl-6 md:pr-6">
        <div className="flex items-center gap-3 min-w-0">
          <BrandMark />
          <span className="hidden md:inline text-xs uppercase tracking-[0.22em] text-muted-foreground truncate ml-2">
            100% in your browser
          </span>
        </div>

        <Link
          to="/pricing"
          className="inline-flex items-center gap-1.5 rounded-md border border-vault/40 bg-vault/10 hover:bg-vault/20 text-vault px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.14em] transition-colors"
          activeProps={{ className: "bg-vault/25" }}
        >
          Lifetime deal
        </Link>
      </header>


      <div className="flex flex-1 min-h-0">
        <Sidebar collapsible="icon" variant="sidebar" className="border-r border-slate-800/70 top-14 h-[calc(100svh-3.5rem)]">
          <SidebarHeader>
            <div className="h-1" />
          </SidebarHeader>



          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Secure</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {secureTools.map((t) => (
                    <SidebarMenuItem key={t.to}>
                      <SidebarMenuButton asChild isActive={isActive(t.to)} tooltip={t.label}>
                        <Link to={t.to} className="flex items-center gap-2">
                          <t.icon className="h-4 w-4 opacity-80" />
                          <span>{t.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator />

            <SidebarGroup>
              <SidebarGroupLabel>Edit</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {editTools.map((t) => (
                    <SidebarMenuItem key={t.to}>
                      <SidebarMenuButton asChild isActive={isActive(t.to)} tooltip={t.label}>
                        <Link to={t.to} className="flex items-center gap-2">
                          <t.icon className="h-4 w-4 opacity-80" />
                          <span>{t.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarSeparator />

            <SidebarGroup>
              <SidebarGroupLabel>Convert & Extract</SidebarGroupLabel>
              <SidebarGroupContent>
                {convertGroups.map((sg, i) => (
                  <div key={sg.label} className={cn(i > 0 && "mt-2")}>
                    <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 group-data-[collapsible=icon]:hidden">
                      {sg.label}
                    </div>
                    <SidebarMenu>
                      {sg.items.map((t) => (
                        <SidebarMenuItem key={t.to}>
                          <SidebarMenuButton asChild isActive={isActive(t.to)} tooltip={t.label}>
                            <Link to={t.to} className="flex items-center gap-2">
                              <t.icon className="h-4 w-4 opacity-80" />
                              <span>{t.label}</span>
                              {t.beta && (
                                <span className="ml-auto text-[9px] uppercase tracking-[0.16em] rounded-sm bg-vault/15 text-vault px-1 py-px">
                                  Beta
                                </span>
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </div>
                ))}
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <div className="px-2 py-2 group-data-[collapsible=icon]:hidden">
              <Link
                to="/pricing"
                className="flex items-center gap-3 rounded-lg px-3 py-3 border border-vault/40 bg-vault/10 hover:bg-vault/20 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-vault">Lifetime deal</div>
                  <div className="text-xs text-muted-foreground mt-0.5">One payment, every tool, forever.</div>
                </div>
                <span className="text-vault text-xs">→</span>
              </Link>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground group-data-[collapsible=icon]:hidden">
              <span className="h-1.5 w-1.5 rounded-full bg-vault" />
              <span>Files never leave this tab</span>
            </div>
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <main className="flex-1 min-h-0">{children}</main>

          <footer className="border-t border-slate-800/70 px-5 md:px-8 py-6 text-xs text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
            <div>&copy; {new Date().getFullYear()} VaultPDF &middot; The PDF toolkit for documents you&apos;d never upload.</div>
            <div className="flex gap-4">
              <Link to="/" className="hover:text-foreground">Home</Link>
              <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
              <a href="/#trust" className="hover:text-foreground">How privacy works</a>
            </div>
          </footer>
        </SidebarInset>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider defaultOpen={false} className="flex-col">
      <ShellInner>{children}</ShellInner>
    </SidebarProvider>
  );
}

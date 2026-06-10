import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ShieldCheck, PenLine, GitCompare, Table2, ScanText, Hash, MessageSquare } from "lucide-react";
import { WorkspaceShell, ToolRail, ThumbStrip, Inspector, SectionHeader, Pill, EmptyState } from "@/components/workspace/primitives";
import { DocumentCanvas, type PageBox } from "@/components/workspace/document-canvas";
import { CommandPalette } from "@/components/workspace/command-palette";
import { TokenMeter } from "@/components/workspace/token-meter";

export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace — VaultPDF" },
      { name: "description", content: "Unified document workspace: redact, sign, compare, OCR, extract — all in one canvas." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    tool: typeof s.tool === "string" ? s.tool : "redact",
  }),
  component: WorkspacePage,
});

const TOOLS = [
  { id: "redact", label: "Redact", icon: <ShieldCheck /> },
  { id: "sign", label: "Sign", icon: <PenLine /> },
  { id: "compare", label: "Compare", icon: <GitCompare /> },
  { id: "extract", label: "Extract", icon: <Table2 /> },
  { id: "ocr", label: "OCR", icon: <ScanText /> },
  { id: "bates", label: "Bates", icon: <Hash /> },
  { id: "chat", label: "Chat", icon: <MessageSquare /> },
] as const;

function WorkspacePage() {
  const { tool } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [page, setPage] = useState(0);
  const [chatOpen, setChatOpen] = useState(true);

  // Phase 1: stand-in document. Real WorkspaceDoc lands in Phase 2.
  const totalPages = 24;
  const boxesByPage = useMemo<Record<number, PageBox[]>>(() => ({
    2: [{ x: 80, y: 120, w: 220, h: 18, kind: "pending" }],
    3: [{ x: 60, y: 200, w: 280, h: 22, kind: "pending" }, { x: 60, y: 240, w: 160, h: 18, kind: "committed" }],
  }), []);

  return (
    <>
      <CommandPalette />
      <WorkspaceShell
        fileLabel={
          <>
            <span className="text-ink/90">untitled.pdf</span>
            <span className="text-ink/40">·</span>
            <span>{totalPages} pgs</span>
            <span className="text-ink/30">(indexing…)</span>
          </>
        }
        status={<span>Vault: locked · BYOK</span>}
        rail={
          <ToolRail
            items={[...TOOLS]}
            activeId={tool}
            onSelect={(id) => navigate({ search: { tool: id } })}
          />
        }
        thumbs={<ThumbStrip pages={totalPages} current={page} onSelect={setPage} />}
        canvas={
          <DocumentCanvas
            pages={totalPages}
            current={page}
            onPageInView={setPage}
            boxesForPage={(i) => boxesByPage[i] ?? []}
          />
        }
        inspector={
          <Inspector
            tool={<ToolPanel tool={tool} />}
            chat={chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : undefined}
          />
        }
      />
    </>
  );
}

function ToolPanel({ tool }: { tool: string }) {
  switch (tool) {
    case "redact":
      return (
        <div>
          <SectionHeader>Pending Redactions</SectionHeader>
          <div className="flex flex-wrap gap-2 px-4">
            <Pill count={3} label="PII" tone="evidence" />
            <Pill count={1} label="Keyword" tone="vault" />
            <Pill count={1} label="Committed" tone="ink" />
          </div>
          <SectionHeader>Exemption Code</SectionHeader>
          <div className="px-4">
            <input
              type="text"
              placeholder="FOIA b(6), HIPAA, …"
              className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm"
            />
          </div>
          <div className="p-4">
            <button className="w-full rounded-md bg-vault px-4 py-2 text-sm font-medium text-vault-foreground">
              Commit redactions
            </button>
          </div>
        </div>
      );
    case "sign":
      return (
        <div>
          <SectionHeader>Signature Field</SectionHeader>
          <div className="px-4 text-sm text-ink/70">Draw, type, or upload — applied to the selected page.</div>
        </div>
      );
    case "chat":
      return <EmptyState title="AI Chat" body="Chat lives in the panel below. Connect a provider in /vault to start." />;
    default:
      return <EmptyState title={tool} body="Inspector contents land as this tool's Phase ships." />;
  }
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-whisper px-3 py-2 text-[11px]">
        <span className="uppercase tracking-[0.18em] text-ink/50">Chat</span>
        <div className="flex items-center gap-2">
          <TokenMeter cost={0.042} tokens={2100} state="settled" />
          <button onClick={onClose} className="text-ink/40 hover:text-ink">×</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm text-ink/70">
        <p className="opacity-60">Add a provider in /vault to begin a conversation.</p>
      </div>
      <div className="border-t border-whisper p-2">
        <input
          placeholder="Ask the document…"
          className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

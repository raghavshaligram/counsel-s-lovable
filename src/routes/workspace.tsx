import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, PenLine, GitCompare, Table2, ScanText, Hash, MessageSquare, Upload } from "lucide-react";
import { WorkspaceShell, ToolRail, ThumbStrip, Inspector, SectionHeader, Pill, EmptyState } from "@/components/workspace/primitives";
import { DocumentCanvas, type PageBox } from "@/components/workspace/document-canvas";
import { CommandPalette } from "@/components/workspace/command-palette";
import { TokenMeter } from "@/components/workspace/token-meter";
import { useWorkspace } from "@/lib/workspace/doc";

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
  const [chatOpen, setChatOpen] = useState(true);

  const doc = useWorkspace();
  const pdfDocRef = useRef<unknown>(null);

  // Load pdfjs once we have bytes
  useEffect(() => {
    if (!doc.bytes) return;
    let cancelled = false;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const loaded = await pdfjs.getDocument({ data: doc.bytes!.slice(0) }).promise;
      if (!cancelled) pdfDocRef.current = loaded;
    })();
    return () => { cancelled = true; };
  }, [doc.bytes]);

  async function renderPage(i: number, target: HTMLCanvasElement) {
    const pdf = pdfDocRef.current as { getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas?: HTMLCanvasElement }): { promise: Promise<void> } }> } | null;
    if (!pdf) return;
    const page = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: 1.5 });
    target.width = viewport.width;
    target.height = viewport.height;
    const ctx = target.getContext("2d");
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport, canvas: target }).promise;
  }

  const pendingCount = doc.boxes.filter(b => b.kind === "pending").length;
  const committedCount = doc.boxes.filter(b => b.kind === "committed").length;

  return (
    <>
      <CommandPalette />
      <WorkspaceShell
        fileLabel={
          doc.fileName ? (
            <>
              <span className="text-ink/90">{doc.fileName}</span>
              <span className="text-ink/40">·</span>
              <span>{doc.pageCount} pgs</span>
              {doc.workStatus && <span className="text-ink/30">({doc.workStatus})</span>}
            </>
          ) : (
            <span className="text-ink/40">no document</span>
          )
        }
        status={<span>Vault: locked · BYOK</span>}
        rail={
          <ToolRail
            items={[...TOOLS]}
            activeId={tool}
            onSelect={(id) => navigate({ search: { tool: id } })}
          />
        }
        thumbs={
          doc.pageCount > 0 ? (
            <ThumbStrip pages={doc.pageCount} current={doc.currentPage} onSelect={doc.setCurrentPage} />
          ) : null
        }
        canvas={
          doc.bytes ? (
            <DocumentCanvas
              pages={doc.pageCount}
              current={doc.currentPage}
              onPageInView={doc.setCurrentPage}
              renderPage={renderPage}
              boxesForPage={(i) => doc.boxes.filter(b => b.page === i) as unknown as PageBox[]}
            />
          ) : (
            <Dropzone />
          )
        }
        inspector={
          <Inspector
            tool={<ToolPanel tool={tool} pending={pendingCount} committed={committedCount} />}
            chat={chatOpen ? <ChatPanel onClose={() => setChatOpen(false)} /> : undefined}
          />
        }
      />
    </>
  );
}

function Dropzone() {
  const open = useWorkspace((s) => s.open);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) await open(file);
      }}
      className="grid h-full place-items-center"
    >
      <label className={`flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed px-12 py-10 transition-colors ${dragging ? "border-vault bg-vault/10" : "border-whisper hover:border-vault/40"}`}>
        <Upload className="h-5 w-5 text-ink/50" />
        <div className="font-display text-lg text-ink">Drop a PDF to begin</div>
        <div className="text-[12px] text-ink/50">or click to choose · stays on this device</div>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await open(f);
          }}
        />
      </label>
    </div>
  );
}

function ToolPanel({ tool, pending, committed }: { tool: string; pending: number; committed: number }) {
  const commit = useWorkspace((s) => s.commitPending);
  switch (tool) {
    case "redact":
      return (
        <div>
          <SectionHeader>Redactions</SectionHeader>
          <div className="flex flex-wrap gap-2 px-4">
            <Pill count={pending} label="Pending" tone="evidence" />
            <Pill count={committed} label="Committed" tone="ink" />
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
            <button
              onClick={commit}
              disabled={pending === 0}
              className="w-full rounded-md bg-vault px-4 py-2 text-sm font-medium text-vault-foreground disabled:opacity-40"
            >
              Commit {pending} redaction{pending === 1 ? "" : "s"}
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
          <TokenMeter cost={0} tokens={0} state="queued" />
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

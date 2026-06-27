/**
 * Quick Actions — top-bar dropdown for run-and-done operations.
 *
 * One compact button next to Export. Each item runs immediately on the
 * active document with sensible defaults, shows a progress/result toast,
 * and downloads the resulting file (or, for OCR, delegates to the existing
 * in-place make-searchable flow so tokens land in the sidecar).
 *
 * No tool inspector is opened. These tools also remain in the all-tools
 * modal for discoverability — this is just a faster path.
 */
import { useRef, useState } from "react";
import {
  Zap,
  Wrench,
  Archive,
  ShieldOff,
  ScanText,
  Layers,
  RotateCw,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { downloadBytes } from "@/lib/batch/runner";

type Props = {
  file: File | null;
  onMakeSearchable: () => void;
  ocrRunning: boolean;
  /**
   * Open a File in the workspace (new tab if a doc is already open).
   * Used after Repair so the repaired PDF lands in the viewer.
   */
  onOpenFile: (file: File) => void;
};

function baseName(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

export function QuickActionsMenu({ file, onMakeSearchable, ocrRunning, onOpenFile }: Props) {
  const [busy, setBusy] = useState(false);
  const repairInputRef = useRef<HTMLInputElement | null>(null);
  const standaloneInputRef = useRef<HTMLInputElement | null>(null);
  const pendingActionRef = useRef<((f: File) => void | Promise<void>) | null>(null);
  // Group B (OCR, Rotate) still requires an open document.
  const noFile = !file;

  const triggerDisabled = busy;

  function pickFileThen(action: (f: File) => void | Promise<void>) {
    pendingActionRef.current = action;
    standaloneInputRef.current?.click();
  }

  async function processWithFile(
    target: File,
    label: string,
    suffix: string,
    op: (bytes: Uint8Array) => Promise<Uint8Array>,
  ) {
    setBusy(true);
    const toastId = `qa-${suffix}`;
    toast.loading(`${label}…`, { id: toastId });
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      const out = await op(bytes);
      downloadBytes(
        out,
        `${baseName(target.name)}-${suffix}.pdf`,
        "application/pdf",
      );
      toast.success(`${label} — saved`, { id: toastId });
    } catch (err) {
      console.error(`[quick-actions] ${label} failed`, err);
      toast.error(`${label} failed`, {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  async function repairFile(target: File) {
    setBusy(true);
    const toastId = "qa-repair";
    toast.loading("Repairing…", { id: toastId });
    try {
      const { repairPdfFile } = await import("@/lib/pdf/repair");
      const res = await repairPdfFile(target);
      downloadBytes(res.bytes, res.filename, "application/pdf");
      if (res.outcome === "full") {
        toast.success(
          `Fully repaired — ${res.pagesRecovered}/${res.pagesExpected} pages`,
          { id: toastId },
        );
      } else {
        const missing = res.pagesWithMissingContent.length;
        toast.warning(
          `Partially repaired — ${res.pagesRecovered}/${res.pagesExpected} pages` +
            (missing > 0 ? `, ${missing} with missing content` : "") +
            (res.pagesDropped > 0 ? `, ${res.pagesDropped} dropped` : ""),
          { id: toastId },
        );
      }
      try {
        const repairedFile = new File([res.bytes as BlobPart], res.filename, {
          type: "application/pdf",
        });
        onOpenFile(repairedFile);
      } catch (e) {
        console.error("[quick-actions] could not open repaired file", e);
      }
    } catch (err) {
      const { friendlyRepairReason } = await import("@/lib/pdf/repair");
      toast.error("Unable to repair this file", {
        id: toastId,
        description: friendlyRepairReason(err, { fileSize: target.size }),
      });
    } finally {
      setBusy(false);
    }
  }

  function runRepair() {
    if (file) {
      void repairFile(file);
    } else {
      repairInputRef.current?.click();
    }
  }

  async function compressOnFile(target: File, level: "light" | "medium" | "strong") {
    setBusy(true);
    const toastId = "qa-compress";
    const label =
      level === "light" ? "Light" : level === "strong" ? "Strong" : "Medium";
    toast.loading(`Compressing (${label})…`, { id: toastId });
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      const { compressSmart } = await import("@/lib/batch/ops/compress");
      const preset = level === "light" ? "low" : level === "strong" ? "high" : "medium";
      const res = await compressSmart(bytes, { preset, grayscale: false });
      const fmt = (n: number) =>
        n >= 1_000_000
          ? `${(n / 1_000_000).toFixed(1)} MB`
          : n >= 1_000
            ? `${(n / 1_000).toFixed(0)} KB`
            : `${n} B`;
      if (res.keptOriginal) {
        toast.message("Already optimized", {
          id: toastId,
          description: `No further compression possible at this level (${fmt(res.originalSize)}). The original was kept — no larger file was returned.`,
        });
        return;
      }
      const pct = Math.round((1 - res.outputSize / res.originalSize) * 100);
      downloadBytes(
        res.bytes,
        `${baseName(target.name)}-compressed.pdf`,
        "application/pdf",
      );
      toast.success(
        `Compressed — ${fmt(res.originalSize)} → ${fmt(res.outputSize)} (${pct}% smaller)`,
        { id: toastId },
      );
    } catch (err) {
      console.error("[quick-actions] Compress failed", err);
      toast.error("Compress failed", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function runCompress(level: "light" | "medium" | "strong" = "medium") {
    if (file) void compressOnFile(file, level);
    else pickFileThen((f) => compressOnFile(f, level));
  }

  function runSanitize() {
    const op = (target: File) =>
      processWithFile(target, "Sanitize", "sanitized", async (bytes) => {
        const { sanitizePdfBytes } = await import("@/lib/pdf/sanitize");
        return sanitizePdfBytes(bytes);
      });
    if (file) void op(file);
    else pickFileThen(op);
  }

  function runFlatten() {
    const op = (target: File) =>
      processWithFile(target, "Flatten", "flattened", async (bytes) => {
        const { flatten } = await import("@/lib/batch/ops/flatten");
        return flatten(bytes, { forms: true, annotations: false });
      });
    if (file) void op(file);
    else pickFileThen(op);
  }

  async function runRotate(angle: 90 | 180 | 270) {
    if (!file) return;
    setBusy(true);
    const toastId = "qa-rotate";
    toast.loading(`Rotating ${angle}°…`, { id: toastId });
    try {
      const { rotatePdf } = await import("@/lib/pdf/rotate");
      const res = await rotatePdf(file, { angle, scope: "all" });
      const buf = new Uint8Array(await res.blob.arrayBuffer());
      downloadBytes(buf, res.filename, "application/pdf");
      toast.success(`Rotated ${angle}° — ${res.rotatedCount} pages`, { id: toastId });
    } catch (err) {
      toast.error("Rotate failed", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function runMakeSearchable() {
    if (!file) return;
    // Delegates to the workspace's in-place OCR (sidecar-aware).
    onMakeSearchable();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={triggerDisabled}
          title="Quick Actions — one-click tools"
          aria-label="Quick Actions"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-surface-2",
            triggerDisabled && "opacity-40 cursor-not-allowed hover:bg-surface-1",
          )}
        >
          <Zap className="h-3.5 w-3.5 text-vault" strokeWidth={2.5} />
          Quick
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-text-2 font-mono">
          Run on this document
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={runRepair} disabled={busy}>
          <Wrench className="h-4 w-4" />
          <span className="flex-1">Repair PDF</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={busy}>
            <Archive className="h-4 w-4" />
            <span className="flex-1">Compress</span>
            <ChevronRight className="h-3.5 w-3.5 text-text-2" />
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuItem onSelect={() => runCompress("light")} disabled={busy}>
                <span className="flex-1">Light</span>
                <span className="text-[10px] text-text-2">best quality</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runCompress("medium")} disabled={busy}>
                <span className="flex-1">Medium</span>
                <span className="text-[10px] text-text-2">balanced</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runCompress("strong")} disabled={busy}>
                <span className="flex-1">Strong</span>
                <span className="text-[10px] text-text-2">smallest</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuItem onSelect={runSanitize} disabled={busy}>
          <ShieldOff className="h-4 w-4" />
          <span className="flex-1">Sanitize before filing</span>
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={runFlatten} disabled={busy}>
          <Layers className="h-4 w-4" />
          <span className="flex-1">Flatten</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-text-2 font-mono">
          Requires open document
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={runMakeSearchable}
          disabled={busy || ocrRunning || noFile}
        >
          <ScanText className="h-4 w-4" />
          <span className="flex-1">Make Searchable (OCR)</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={busy || noFile}>
            <RotateCw className="h-4 w-4" />
            <span className="flex-1">Rotate (whole document)</span>
            <ChevronRight className="h-3.5 w-3.5 text-text-2" />
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-36">
              <DropdownMenuItem onSelect={() => runRotate(90)} disabled={busy}>
                90° clockwise
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runRotate(180)} disabled={busy}>
                180°
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => runRotate(270)} disabled={busy}>
                90° counter-clockwise
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuContent>
      <input
        ref={repairInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void repairFile(f);
        }}
      />
      <input
        ref={standaloneInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          if (f && action) void action(f);
        }}
      />
    </DropdownMenu>
  );
}

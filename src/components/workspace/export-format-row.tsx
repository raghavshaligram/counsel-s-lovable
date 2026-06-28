/**
 * ExportFormatRow — small inline control that sits next to a tool's
 * download button. Lets the user flip between PDF and PDF/A-2b for every
 * subsequent export. The selection is persisted globally so other panels,
 * dialogs and the main Export button all reflect the same default.
 */
import { FileCheck2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useExportFormat,
  type ExportFormat,
  PDFA_NOTE,
} from "@/lib/workspace/export-format-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ExportFormatRow({ className }: { className?: string }) {
  const [format, setFormat] = useExportFormat();
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-border bg-surface-2/40 px-2.5 py-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-3.5 w-3.5 text-text-2" strokeWidth={2} />
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Output format
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {(["pdf", "pdf-a"] as const).map((v) => (
          <FormatPill
            key={v}
            value={v}
            current={format}
            onSelect={setFormat}
          />
        ))}
      </div>
      {format === "pdf-a" && (
        <p className="text-[10.5px] leading-snug text-text-muted">{PDFA_NOTE}</p>
      )}
    </div>
  );
}

function FormatPill({
  value, current, onSelect,
}: {
  value: ExportFormat;
  current: ExportFormat;
  onSelect: (v: ExportFormat) => void;
}) {
  const on = current === value;
  const label = value === "pdf" ? "PDF" : "PDF/A-2b";
  const sub = value === "pdf" ? "Standard" : "Archival";
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={on}
      className={cn(
        "flex flex-col items-start rounded-md border px-2 py-1.5 text-left transition-colors",
        on
          ? "border-vault/50 bg-accent-soft text-vault"
          : "border-border bg-surface-1 text-text-2 hover:border-vault/30 hover:text-foreground",
      )}
    >
      <span className="text-[12px] font-medium leading-none">{label}</span>
      <span className={cn("mt-0.5 text-[10px]", on ? "text-vault/80" : "text-text-muted")}>
        {sub}
      </span>
    </button>
  );
}

/**
 * Compact dropdown variant — for tight surfaces like the workspace top bar.
 * Reads / writes the same global preference as ExportFormatRow.
 */
export function ExportFormatChip({ className }: { className?: string }) {
  const [format, setFormat] = useExportFormat();
  const label = format === "pdf-a" ? "PDF/A" : "PDF";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Output format for downloads"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-2 py-1 text-[11.5px] font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-foreground",
            format === "pdf-a" && "border-vault/40 bg-accent-soft text-vault",
            className,
          )}
        >
          <FileCheck2 className="h-3.5 w-3.5" strokeWidth={2} />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Output format
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setFormat("pdf")} className="items-start">
          <div className="flex w-full items-start gap-2">
            <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", format === "pdf" ? "text-vault" : "opacity-0")} strokeWidth={2.5} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-foreground">PDF</div>
              <div className="text-[10.5px] text-text-muted">Standard PDF · maximum compatibility</div>
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFormat("pdf-a")} className="items-start">
          <div className="flex w-full items-start gap-2">
            <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", format === "pdf-a" ? "text-vault" : "opacity-0")} strokeWidth={2.5} />
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium text-foreground">PDF/A-2b</div>
              <div className="text-[10.5px] text-text-muted">{PDFA_NOTE}</div>
            </div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10.5px] leading-snug text-text-muted">
          Applies to every PDF you export — Redact, Bates, Convert, Sanitize and more. Conversion runs on-device.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

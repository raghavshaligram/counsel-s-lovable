/**
 * ExportMenu — single top-bar dropdown that consolidates Export,
 * Export as PDF/A, Print, and Save case session. Keeps the top bar
 * uncluttered while preserving every action.
 */
import { ChevronDown, Download, FileCheck2, Printer, Save, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setExportFormat } from "@/lib/workspace/export-format-store";
import { useCaseSessionSave } from "./case-session-save";
import { cn } from "@/lib/utils";

type Props = {
  file: File | null;
  canExport: boolean;
  canPrint: boolean;
  printing: boolean;
  onExport: () => void;
  onPrint: () => void;
};

export function ExportMenu({ file, canExport, canPrint, printing, onExport, onPrint }: Props) {
  const { save, busy: saving } = useCaseSessionSave(file);

  const exportPdf = () => {
    setExportFormat("pdf");
    onExport();
  };
  const exportPdfA = () => {
    setExportFormat("pdf-a");
    onExport();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground transition-opacity hover:opacity-90",
            !canExport && "opacity-40 cursor-not-allowed hover:opacity-40",
          )}
          disabled={!canExport}
          aria-label="Export menu"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
          Export
          <ChevronDown className="h-3 w-3 opacity-80" strokeWidth={2.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={exportPdf} disabled={!canExport} className="gap-2">
          <Download className="h-3.5 w-3.5 text-text-2" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-foreground">Export</div>
            <div className="text-[10.5px] text-text-muted">Standard PDF</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportPdfA} disabled={!canExport} className="gap-2">
          <FileCheck2 className="h-3.5 w-3.5 text-text-2" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-foreground">Export as PDF/A</div>
            <div className="text-[10.5px] text-text-muted">Archival — court filing</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); onPrint(); }}
          disabled={!canPrint || printing}
          className="gap-2"
        >
          {printing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-2" />
          ) : (
            <Printer className="h-3.5 w-3.5 text-text-2" strokeWidth={2} />
          )}
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-foreground">Print</div>
            <div className="text-[10.5px] text-text-muted">⌘P</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); void save(); }}
          disabled={!file || saving}
          className="gap-2"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-text-2" />
          ) : (
            <Save className="h-3.5 w-3.5 text-text-2" strokeWidth={2} />
          )}
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-foreground">Save case session</div>
            <div className="text-[10.5px] text-text-muted">Preserve settings across browser wipes</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

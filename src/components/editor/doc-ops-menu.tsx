/**
 * DocOpsMenu — toolbar dropdown that runs document-level operations
 * (page numbers, header/footer, crop, flatten) on the current editor
 * doc and re-imports the resulting bytes.
 *
 * Each op opens a small dialog reusing the same pdf-lib helpers as the
 * standalone /page-numbers, /header-footer, /crop, /flatten routes.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PDFDocument } from "pdf-lib";
import {
  Wand2,
  Hash,
  Crop as CropIcon,
  Layers,
  PanelTop,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { addPageNumbers, type PageNumberAnchor, type PageNumberFormat } from "@/lib/batch/ops/page-numbers";
import { addHeaderFooter, type HFAlign } from "@/lib/batch/ops/header-footer";
import { flatten } from "@/lib/batch/ops/flatten";
import { applyCrop, rectFromMargins } from "@/lib/crop/apply";
import { exportEditedPdf } from "@/lib/editor/export";
import type { EditorDoc, PageOp } from "@/lib/editor/types";

type Op = "page-numbers" | "header-footer" | "crop" | "flatten";

interface Props {
  doc: EditorDoc | null;
  onReload: (doc: EditorDoc) => void;
}

export function DocOpsMenu({ doc, onReload }: Props) {
  const [active, setActive] = useState<Op | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadFromBytes = async (bytes: Uint8Array, suffix: string) => {
    try {
      const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages: PageOp[] = lib.getPages().map((p, i) => {
        const { width, height } = p.getSize();
        return { srcPage: i, rotation: 0, width, height };
      });
      onReload({
        fileName: (doc?.fileName ?? "document.pdf").replace(/\.pdf$/i, "") + ".pdf",
        srcBytes: bytes,
        pages,
        // intentionally drop annotations — they were baked into the bytes
        annotations: [],
      });
      toast.success(`${suffix} — annotations were flattened into the new document`);
    } catch (err) {
      toast.error("Could not reload edited PDF", { description: (err as Error).message });
    }
  };

  const bake = async (): Promise<Uint8Array | null> => {
    if (!doc) return null;
    // Bake any in-editor annotations first so ops see the same view as Export.
    return await exportEditedPdf(doc, {});
  };

  const runOp = async (op: Op, runner: (bytes: Uint8Array) => Promise<Uint8Array>, label: string) => {
    setBusy(true);
    try {
      const bytes = await bake();
      if (!bytes) return;
      const out = await runner(bytes);
      await reloadFromBytes(out, label);
      setActive(null);
    } catch (err) {
      console.error(err);
      toast.error(`${label} failed`, { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={!doc} title="Apply document-wide operation">
            <Wand2 className="h-4 w-4 mr-1.5" />
            Apply
            <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Document ops
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setActive("page-numbers")}>
            <Hash className="h-4 w-4 mr-2" /> Page numbers…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActive("header-footer")}>
            <PanelTop className="h-4 w-4 mr-2" /> Header &amp; footer…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActive("crop")}>
            <CropIcon className="h-4 w-4 mr-2" /> Crop…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setActive("flatten")}>
            <Layers className="h-4 w-4 mr-2" /> Flatten…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PageNumbersDialog
        open={active === "page-numbers"}
        onOpenChange={(v) => !v && setActive(null)}
        busy={busy}
        onApply={(opts) =>
          runOp(
            "page-numbers",
            (bytes) => addPageNumbers(bytes, opts),
            "Page numbers applied",
          )
        }
      />
      <HeaderFooterDialog
        open={active === "header-footer"}
        onOpenChange={(v) => !v && setActive(null)}
        busy={busy}
        filename={doc?.fileName}
        onApply={(opts) =>
          runOp(
            "header-footer",
            (bytes) => addHeaderFooter(bytes, opts),
            "Header / footer applied",
          )
        }
      />
      <CropDialog
        open={active === "crop"}
        onOpenChange={(v) => !v && setActive(null)}
        busy={busy}
        onApply={(margins, mediaBoxToo) =>
          runOp(
            "crop",
            async (bytes) => {
              const tmp = await PDFDocument.load(bytes, { ignoreEncryption: true });
              const rects = new Map();
              tmp.getPages().forEach((p, i) => {
                const { width, height } = p.getSize();
                rects.set(i, rectFromMargins(width, height, margins));
              });
              return applyCrop(bytes, { scope: { kind: "all" }, rect: rects, mediaBoxToo });
            },
            "Crop applied",
          )
        }
      />
      <FlattenDialog
        open={active === "flatten"}
        onOpenChange={(v) => !v && setActive(null)}
        busy={busy}
        onApply={(opts) =>
          runOp("flatten", (bytes) => flatten(bytes, opts), "Flatten applied")
        }
      />
    </>
  );
}

// ============================================================================
// Page numbers dialog
// ============================================================================

function PageNumbersDialog({
  open,
  onOpenChange,
  busy,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onApply: (opts: {
    anchor: PageNumberAnchor;
    format: PageNumberFormat;
    startAt: number;
    skipFirst: number;
    fontSize: number;
    margin: number;
    prefix?: string;
  }) => void;
}) {
  const [anchor, setAnchor] = useState<PageNumberAnchor>("bottom-center");
  const [format, setFormat] = useState<PageNumberFormat>("page-n");
  const [startAt, setStartAt] = useState(1);
  const [skipFirst, setSkipFirst] = useState(0);
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(24);
  const [prefix, setPrefix] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Page numbers</DialogTitle>
          <DialogDescription>Stamp a number on every page. Format and position are previewed below.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(["top-left","top-center","top-right","bottom-left","bottom-center","bottom-right"] as PageNumberAnchor[]).map((a) => (
              <button
                key={a}
                onClick={() => setAnchor(a)}
                className={
                  "rounded-md border px-2 py-2 text-xs " +
                  (anchor === a ? "border-vault bg-vault/10 text-vault" : "border-border hover:bg-accent")
                }
              >
                {a.replace("-", " ")}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Format</Label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as PageNumberFormat)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="n">1, 2, 3</option>
                <option value="page-n">Page 1, Page 2</option>
                <option value="n-of-m">1 of N</option>
                <option value="roman">i, ii, iii</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Prefix</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="(optional)" className="h-9" />
            </div>
            <NumField label="Start at" value={startAt} onChange={setStartAt} />
            <NumField label="Skip first" value={skipFirst} onChange={setSkipFirst} />
            <NumField label="Font size (pt)" value={fontSize} onChange={setFontSize} />
            <NumField label="Margin (pt)" value={margin} onChange={setMargin} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            className="bg-vault text-vault-foreground hover:opacity-90"
            onClick={() => onApply({ anchor, format, startAt, skipFirst, fontSize, margin, prefix: prefix || undefined })}
          >
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Applying…</> : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Header / footer dialog
// ============================================================================

function HeaderFooterDialog({
  open,
  onOpenChange,
  busy,
  filename,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  filename?: string;
  onApply: (opts: {
    headerText?: string;
    footerText?: string;
    align: HFAlign;
    fontSize: number;
    margin: number;
    filename?: string;
    rule: "all" | "even" | "odd" | "no-first";
  }) => void;
}) {
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("Page {page} of {pages}");
  const [align, setAlign] = useState<HFAlign>("center");
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(24);
  const [rule, setRule] = useState<"all" | "even" | "odd" | "no-first">("all");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Header &amp; footer</DialogTitle>
          <DialogDescription>
            Tokens: <code className="text-vault">{"{page}"}</code> <code className="text-vault">{"{pages}"}</code>{" "}
            <code className="text-vault">{"{date}"}</code> <code className="text-vault">{"{filename}"}</code>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Header</Label>
            <Input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="(optional)" />
          </div>
          <div className="space-y-1">
            <Label>Footer</Label>
            <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} placeholder="(optional)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Alignment</Label>
              <select
                value={align}
                onChange={(e) => setAlign(e.target.value as HFAlign)}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Apply to</Label>
              <select
                value={rule}
                onChange={(e) => setRule(e.target.value as "all" | "even" | "odd" | "no-first")}
                className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="all">All pages</option>
                <option value="no-first">All except first</option>
                <option value="odd">Odd pages</option>
                <option value="even">Even pages</option>
              </select>
            </div>
            <NumField label="Font size (pt)" value={fontSize} onChange={setFontSize} />
            <NumField label="Margin (pt)" value={margin} onChange={setMargin} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || (!headerText && !footerText)}
            className="bg-vault text-vault-foreground hover:opacity-90"
            onClick={() =>
              onApply({
                headerText: headerText || undefined,
                footerText: footerText || undefined,
                align, fontSize, margin, rule, filename,
              })
            }
          >
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Applying…</> : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Crop dialog (compact, all-pages with uniform margins)
// ============================================================================

function CropDialog({
  open,
  onOpenChange,
  busy,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onApply: (margins: [number, number, number, number], mediaBoxToo: boolean) => void;
}) {
  const [top, setTop] = useState(36);
  const [right, setRight] = useState(36);
  const [bottom, setBottom] = useState(36);
  const [left, setLeft] = useState(36);
  const [mediaBoxToo, setMediaBoxToo] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Crop all pages</DialogTitle>
          <DialogDescription>
            Margins in points (1 in = 72 pt). For per-page rulers and auto-detect, open the dedicated{" "}
            <a href="/crop" className="text-vault underline">Crop tool</a>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="Top (pt)" value={top} onChange={setTop} />
          <NumField label="Right (pt)" value={right} onChange={setRight} />
          <NumField label="Bottom (pt)" value={bottom} onChange={setBottom} />
          <NumField label="Left (pt)" value={left} onChange={setLeft} />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={mediaBoxToo}
            onChange={(e) => setMediaBoxToo(e.target.checked)}
            className="accent-vault"
          />
          <span>
            Also rewrite MediaBox
            <span className="block text-[10px] text-muted-foreground">Destructive — content outside the crop is lost in older viewers.</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            className="bg-vault text-vault-foreground hover:opacity-90"
            onClick={() => onApply([top, right, bottom, left], mediaBoxToo)}
          >
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Applying…</> : "Apply to all pages"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Flatten dialog
// ============================================================================

function FlattenDialog({
  open,
  onOpenChange,
  busy,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onApply: (opts: { forms: boolean; annotations: boolean }) => void;
}) {
  const [forms, setForms] = useState(true);
  const [annotations, setAnnotations] = useState(true);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Flatten</DialogTitle>
          <DialogDescription>
            Bakes form fields and annotations into the page content stream — recipients see the
            same thing you see, and can no longer edit fields.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={forms} onChange={(e) => setForms(e.target.checked)} className="accent-vault" />
            Flatten form fields (AcroForm)
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={annotations} onChange={(e) => setAnnotations(e.target.checked)} className="accent-vault" />
            Strip remaining annotations
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || (!forms && !annotations)}
            className="bg-vault text-vault-foreground hover:opacity-90"
            onClick={() => onApply({ forms, annotations })}
          >
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Flattening…</> : "Flatten"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="h-9"
      />
    </div>
  );
}

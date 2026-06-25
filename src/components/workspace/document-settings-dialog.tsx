/**
 * Document Settings dialog — pure config UI.
 *
 * PERFORMANCE INVARIANT: This component does NO PDF work. It does not load
 * pdf-lib, does not parse pages, does not iterate the document. It only
 * edits two config objects. The actual stamping happens in the export
 * pipeline (src/lib/editor/export.ts), which already runs pdf-lib.
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import type {
  PageNumbersSettings,
  HeaderFooterSettings,
  PageNumberAnchor,
  PageNumberFormat,
  HFAlign,
  HFRule,
} from "@/lib/editor/types";

export const DEFAULT_PAGE_NUMBERS: PageNumbersSettings = {
  enabled: false,
  anchor: "bottom-center",
  format: "page-n",
  startAt: 1,
  skipFirst: 0,
  fontSize: 10,
  margin: 24,
  prefix: "",
};

export const DEFAULT_HEADER_FOOTER: HeaderFooterSettings = {
  enabled: false,
  headerText: "",
  footerText: "Page {page} of {pages}",
  align: "center",
  fontSize: 10,
  margin: 24,
  rule: "all",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pageNumbers: PageNumbersSettings;
  headerFooter: HeaderFooterSettings;
  onSave: (next: { pageNumbers: PageNumbersSettings; headerFooter: HeaderFooterSettings }) => void;
}

export function DocumentSettingsDialog({
  open,
  onOpenChange,
  pageNumbers,
  headerFooter,
  onSave,
}: Props) {
  const [pn, setPn] = useState<PageNumbersSettings>(pageNumbers);
  const [hf, setHf] = useState<HeaderFooterSettings>(headerFooter);

  // Reset local state when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) {
      setPn(pageNumbers);
      setHf(headerFooter);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Document Settings</DialogTitle>
          <DialogDescription>
            Applied at export only. Your document is not modified until you click Export.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="page-numbers">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="page-numbers">Page Numbers</TabsTrigger>
            <TabsTrigger value="header-footer">Header & Footer</TabsTrigger>
          </TabsList>

          <TabsContent value="page-numbers" className="space-y-4 pt-3">
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">Enable page numbers on export</span>
              <Switch checked={pn.enabled} onCheckedChange={(v) => setPn({ ...pn, enabled: v })} />
            </label>

            <div className="grid grid-cols-3 gap-2">
              {(["top-left","top-center","top-right","bottom-left","bottom-center","bottom-right"] as PageNumberAnchor[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setPn({ ...pn, anchor: a })}
                  className={
                    "rounded-md border px-2 py-2 text-xs transition-colors " +
                    (pn.anchor === a ? "border-vault bg-vault/10 text-vault" : "border-border hover:bg-accent")
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
                  value={pn.format}
                  onChange={(e) => setPn({ ...pn, format: e.target.value as PageNumberFormat })}
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
                <Input
                  value={pn.prefix ?? ""}
                  onChange={(e) => setPn({ ...pn, prefix: e.target.value })}
                  placeholder="(optional)"
                  className="h-9"
                />
              </div>
              <NumField label="Start at" value={pn.startAt} onChange={(v) => setPn({ ...pn, startAt: v })} />
              <NumField label="Skip first" value={pn.skipFirst} onChange={(v) => setPn({ ...pn, skipFirst: v })} />
              <NumField label="Font size (pt)" value={pn.fontSize} onChange={(v) => setPn({ ...pn, fontSize: v })} />
              <NumField label="Margin (pt)" value={pn.margin} onChange={(v) => setPn({ ...pn, margin: v })} />
            </div>
          </TabsContent>

          <TabsContent value="header-footer" className="space-y-3 pt-3">
            <label className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm">Enable header / footer on export</span>
              <Switch checked={hf.enabled} onCheckedChange={(v) => setHf({ ...hf, enabled: v })} />
            </label>

            <p className="text-xs text-text-2">
              Tokens: <code className="text-vault">{"{page}"}</code>{" "}
              <code className="text-vault">{"{pages}"}</code>{" "}
              <code className="text-vault">{"{date}"}</code>{" "}
              <code className="text-vault">{"{filename}"}</code>
            </p>

            <div className="space-y-1">
              <Label>Header</Label>
              <Input
                value={hf.headerText ?? ""}
                onChange={(e) => setHf({ ...hf, headerText: e.target.value })}
                placeholder="(optional)"
              />
            </div>
            <div className="space-y-1">
              <Label>Footer</Label>
              <Input
                value={hf.footerText ?? ""}
                onChange={(e) => setHf({ ...hf, footerText: e.target.value })}
                placeholder="(optional)"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Alignment</Label>
                <select
                  value={hf.align}
                  onChange={(e) => setHf({ ...hf, align: e.target.value as HFAlign })}
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
                  value={hf.rule}
                  onChange={(e) => setHf({ ...hf, rule: e.target.value as HFRule })}
                  className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="all">All pages</option>
                  <option value="no-first">All except first</option>
                  <option value="odd">Odd pages</option>
                  <option value="even">Even pages</option>
                </select>
              </div>
              <NumField label="Font size (pt)" value={hf.fontSize} onChange={(v) => setHf({ ...hf, fontSize: v })} />
              <NumField label="Margin (pt)" value={hf.margin} onChange={(v) => setHf({ ...hf, margin: v })} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-vault text-vault-foreground hover:opacity-90"
            onClick={() => {
              onSave({ pageNumbers: pn, headerFooter: hf });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="h-9"
      />
    </div>
  );
}

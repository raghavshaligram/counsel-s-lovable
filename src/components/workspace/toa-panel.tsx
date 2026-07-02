/**
 * Table of Authorities (Pro) — inspector panel.
 *
 * Reuses the Citation Hyperlinker detection PATTERNS via `buildToa` and
 * lets the user review / edit / re-section / delete entries before either
 * prepending a rendered TOA to the current PDF, downloading a standalone
 * TOA PDF, or copying formatted text to paste into a brief.
 *
 * Automated parsing is inherently imperfect on scanned or wildly formatted
 * briefs — the panel says so up front and puts a "review before insert"
 * gate between scan and any output.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  ScanSearch,
  Trash2,
  Pencil,
  Save,
  X,
  Copy,
  Download,
  FileInput,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";
import { importChunk } from "@/lib/chunk-import";
import type { ToolPanelCtx } from "./tool-panels";
import type { ToaEntry, ToaSection } from "@/lib/citations/toa";
import {
  SECTION_ORDER,
  SECTION_TITLES,
  formatPageList,
  groupToa,
} from "@/lib/citations/toa";

interface EditableEntry extends ToaEntry {
  editing: boolean;
}

const SECTION_ID_LABEL: Array<{ id: ToaSection; label: string }> =
  SECTION_ORDER.map((id) => ({ id, label: SECTION_TITLES[id] }));

export function TableOfAuthoritiesPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile, editorDispatch } = ctx;
  const isPro = useIsPro();
  const requirePro = useRequirePro();

  const [rows, setRows] = useState<EditableEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [working, setWorking] = useState<null | "insert" | "download" | "download-toa">(null);
  const [progress, setProgress] = useState("");
  const [scannedFor, setScannedFor] = useState("");
  const draftDisplay = useRef<Map<string, string>>(new Map());

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const stale = scannedFor !== "" && scannedFor !== fileKey;

  const grouped = useMemo(() => groupToa(rows) as Record<ToaSection, EditableEntry[]>, [rows]);
  const totalEntries = rows.length;

  const runScan = useCallback(async () => {
    if (!file) return;
    if (!requirePro("Table of Authorities")) return;
    setScanning(true);
    setProgress("Reading document…");
    try {
      const { buildToa } = await importChunk(
        () => import("@/lib/citations/toa"),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = await buildToa(bytes, (p) => {
        setProgress(`Scanning page ${p.page} / ${p.totalPages}`);
      });
      setRows(entries.map((e) => ({ ...e, editing: false })));
      setScannedFor(fileKey);
      draftDisplay.current.clear();
      if (entries.length === 0) {
        toast.info("No citations detected — nothing to add to the TOA.");
      } else {
        toast.success(
          `Extracted ${entries.length} authorit${entries.length === 1 ? "y" : "ies"}. Review before inserting.`,
        );
      }
    } catch (err) {
      console.error("[toa] scan failed", err);
      toast.error("TOA scan failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning(false);
      setProgress("");
    }
  }, [file, fileKey, requirePro]);

  const startEdit = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        draftDisplay.current.set(id, r.display);
        return { ...r, editing: true };
      }),
    );
  }, []);

  const cancelEdit = useCallback((id: string) => {
    draftDisplay.current.delete(id);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, editing: false } : r)),
    );
  }, []);

  const saveEdit = useCallback((id: string) => {
    const next = draftDisplay.current.get(id);
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const display = (next ?? r.display).trim() || r.display;
        return {
          ...r,
          editing: false,
          display,
          sortKey: display
            .toLowerCase()
            .replace(/^(in re\s+|ex parte\s+|matter of\s+|the\s+)/, "")
            .trim(),
        };
      }),
    );
    draftDisplay.current.delete(id);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    draftDisplay.current.delete(id);
  }, []);

  const moveSection = useCallback((id: string, section: ToaSection) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, section } : r)),
    );
  }, []);

  const jumpTo = useCallback(
    (page: number) => {
      // toa.pages are 1-based; editor SET_PAGE uses 0-based index.
      editorDispatch({ type: "SET_PAGE", n: Math.max(0, page - 1) });
    },
    [editorDispatch],
  );

  /**
   * ONE combined action: hyperlink inline body citations (external
   * Google Scholar URIs) AND prepend a Table of Authorities whose
   * entries are navigational (internal /Dest jumps only). Replaces the
   * open document with the combined output.
   */
  const insertAtFront = useCallback(async () => {
    if (!file || rows.length === 0) return;
    if (!requirePro("Table of Authorities")) return;
    setWorking("insert");
    try {
      const { buildCombinedCitationsAndToa } = await importChunk(
        () => import("@/lib/citations/toa"),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await buildCombinedCitationsAndToa(bytes, rows);
      const next = new File([new Uint8Array(out)], file.name, {
        type: "application/pdf",
      });
      replaceFile(next);
      toast.success("Body citations linked and TOA prepended.");
    } catch (err) {
      console.error("[toa] combined insert failed", err);
      toast.error("Could not build combined document", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorking(null);
    }
  }, [file, rows, replaceFile, requirePro]);

  const triggerDownload = useCallback(
    (bytes: Uint8Array, filename: string) => {
      const blob = new Blob([bytes.slice().buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    [],
  );

  /**
   * Primary download: ONE combined PDF — inline body citations become
   * external URI links, plus a TOA is prepended with internal /Dest
   * jumps. Same pipeline as the insert action, written to disk instead
   * of replacing the active tab.
   */
  const downloadCombined = useCallback(async () => {
    if (!file || rows.length === 0) return;
    if (!requirePro("Table of Authorities")) return;
    setWorking("download");
    try {
      const { buildCombinedCitationsAndToa } = await importChunk(
        () => import("@/lib/citations/toa"),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await buildCombinedCitationsAndToa(bytes, rows);
      const base = file.name.replace(/\.pdf$/i, "");
      triggerDownload(new Uint8Array(out), `${base} - with TOA.pdf`);
      toast.success("Combined PDF downloaded (body links + TOA).");
    } catch (err) {
      console.error("[toa] combined download failed", err);
      toast.error("Could not build combined PDF", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorking(null);
    }
  }, [file, rows, requirePro, triggerDownload]);

  /**
   * Secondary: TOA pages only, no brief attached. Useful when the user
   * wants to paste the TOA into a separately-formatted brief.
   */
  const downloadToaOnly = useCallback(async () => {
    if (!file || rows.length === 0) return;
    if (!requirePro("Table of Authorities")) return;
    setWorking("download-toa");
    try {
      const { buildToaPdfBytes } = await importChunk(
        () => import("@/lib/citations/toa"),
      );
      const out = await buildToaPdfBytes(rows);
      const base = file.name.replace(/\.pdf$/i, "");
      triggerDownload(new Uint8Array(out), `${base} - Table of Authorities.pdf`);
      toast.success("TOA-only PDF downloaded.");
    } catch (err) {
      console.error("[toa] toa-only download failed", err);
      toast.error("Could not download TOA", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorking(null);
    }
  }, [file, rows, requirePro, triggerDownload]);

  const copyAsText = useCallback(async () => {
    if (rows.length === 0) return;
    try {
      const { toaAsText } = await importChunk(
        () => import("@/lib/citations/toa"),
      );
      const text = toaAsText(rows);
      await navigator.clipboard.writeText(text);
      toast.success("TOA copied — paste into your brief.");
    } catch (err) {
      console.error("[toa] copy failed", err);
      toast.error("Could not copy TOA", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [rows]);

  /* ---------- render ---------- */

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a brief to generate a Table of Authorities — Cases, Statutes, Rules & Regulations, Other Authorities — with page references and dot leaders.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
            <BookMarked className="h-3.5 w-3.5 text-vault" />
            Table of Authorities
            {!isPro && <LockBadge title="Pro — Table of Authorities" />}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-text-muted">
            Hyperlinks inline body citations to Google Scholar AND prepends a Table of Authorities with internal page-jump links — one action.{" "}
            <span className="text-text-subtle">
              Automated parsing isn't perfect — review before inserting.
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          onClick={runScan}
          disabled={scanning || working !== null}
        >
          <ScanSearch className="mr-1 h-3.5 w-3.5" />
          {rows.length === 0 ? "Scan for authorities" : "Re-scan"}
        </Button>
        {scanning && (
          <span className="text-[11px] text-text-muted">{progress}</span>
        )}
        {!scanning && rows.length > 0 && (
          <span className="text-[11px] text-text-subtle">
            {totalEntries} authorit{totalEntries === 1 ? "y" : "ies"}
          </span>
        )}
      </div>

      {stale && rows.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Document changed since scan — re-scan to refresh page numbers.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="max-h-[360px] overflow-y-auto rounded-md border border-border bg-surface-2">
            {SECTION_ID_LABEL.map(({ id, label }) => {
              const arr = grouped[id];
              if (arr.length === 0) return null;
              return (
                <div key={id} className="border-b border-border last:border-b-0">
                  <div className="sticky top-0 z-[1] flex items-center justify-between bg-surface-3 px-2 py-1 text-[10.5px] font-medium uppercase tracking-wide text-text">
                    <span>{label}</span>
                    <span className="text-text-subtle">{arr.length}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {arr.map((row) => {
                      const draft =
                        draftDisplay.current.get(row.id) ?? row.display;
                      return (
                        <li key={row.id} className="px-2 py-1.5 text-[11.5px]">
                          {row.editing ? (
                            <div className="flex flex-col gap-1">
                              <Input
                                defaultValue={draft}
                                onChange={(e) =>
                                  draftDisplay.current.set(
                                    row.id,
                                    e.target.value,
                                  )
                                }
                                className="h-6 text-[11px]"
                                spellCheck={false}
                              />
                              <div className="flex items-center gap-1">
                                <select
                                  value={row.section}
                                  onChange={(e) =>
                                    moveSection(
                                      row.id,
                                      e.target.value as ToaSection,
                                    )
                                  }
                                  className="h-6 rounded border border-border bg-surface px-1 text-[10.5px] text-text"
                                >
                                  {SECTION_ID_LABEL.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="ml-auto flex items-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => saveEdit(row.id)}
                                    title="Save"
                                  >
                                    <Save className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => cancelEdit(row.id)}
                                    title="Cancel"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-text">
                                  {row.display}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10.5px] text-text-muted">
                                  <span className="text-text-subtle">
                                    p.
                                  </span>
                                  {row.pages.map((pg, i) => (
                                    <button
                                      key={`${pg}-${i}`}
                                      type="button"
                                      onClick={() => jumpTo(pg)}
                                      className="text-vault hover:underline"
                                      title={`Jump to page ${pg}`}
                                    >
                                      {pg}
                                      {i < row.pages.length - 1 ? "," : ""}
                                    </button>
                                  ))}
                                </div>
                                <a
                                  href={row.lookupUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-0.5 block truncate text-[10.5px] text-vault hover:underline"
                                  title={row.lookupUrl}
                                >
                                  {row.lookupUrl}
                                </a>
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => startEdit(row.id)}
                                  className="rounded p-1 text-text-subtle hover:bg-surface hover:text-text"
                                  title="Edit / re-section"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeRow(row.id)}
                                  className="rounded p-1 text-text-subtle hover:bg-surface hover:text-danger"
                                  title="Remove entry"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              className="h-7"
              onClick={insertAtFront}
              disabled={working !== null || scanning}
              title="Link inline body citations externally AND prepend a Table of Authorities with internal page-jumps — in one action"
            >
              <FileInput className="mr-1 h-3.5 w-3.5" />
              {working === "insert" ? "Building…" : "Link citations + insert TOA"}
            </Button>
            <Button
              size="sm"
              className="h-7"
              onClick={downloadCombined}
              disabled={working !== null || scanning}
              title="Download one combined PDF: body citations linked externally + TOA prepended with internal page-jumps"
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {working === "download" ? "Building…" : "Download combined PDF"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={copyAsText}
              disabled={scanning}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Copy as text
            </Button>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              onClick={downloadToaOnly}
              disabled={working !== null || scanning}
              className="text-[10.5px] text-text-subtle underline-offset-2 hover:text-text hover:underline disabled:opacity-50"
            >
              {working === "download-toa"
                ? "Preparing TOA-only PDF…"
                : "Download TOA pages only (secondary)"}
            </button>
          </div>
          <p className="text-[10.5px] leading-snug text-text-subtle">
            One action produces the combined PDF: inline body citations become external
            Google Scholar lookup links; a Table of Authorities is prepended where
            page numbers jump to each occurrence — all internal. Idempotent:
            re-running strips any prior TOA page so you never stack duplicates.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Local echo of the grouping order so we can render a stable header
 * sequence without importing during render. Not exported.
 */
void formatPageList;

/**
 * Citation Hyperlinker (Pro) — inspector panel.
 *
 * Scans the active document for US legal citations, lets the user review /
 * edit / toggle each hit, then writes URI /Link annotations to the file via
 * pdf-lib. Text extraction reuses pdf.js (its own worker); the regex pass
 * is negligible so no dedicated automation worker is needed.
 *
 * Honest UX: the panel labels every target as a public LOOKUP (search), not
 * a guaranteed case page. See `src/lib/citations/detect.ts::buildLookupUrl`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Link as LinkIcon,
  ScanSearch,
  CheckSquare,
  Square,
  ExternalLink,
  Pencil,
  Save,
  X,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsPro, useRequirePro, LockBadge } from "@/lib/pro-gate";
import { importChunk } from "@/lib/chunk-import";
import type { ToolPanelCtx } from "./tool-panels";
import type { CitationHit } from "@/lib/citations/detect";
import { CITATION_KIND_LABEL } from "@/lib/citations/detect";
import type { CitationLinkStyle } from "@/lib/citations/apply";

interface Row extends CitationHit {
  enabled: boolean;
  editing: boolean;
}

export function CitationHyperlinkerPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile, editorDispatch } = ctx;
  const isPro = useIsPro();
  const requirePro = useRequirePro();

  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [scannedFor, setScannedFor] = useState<string>("");
  const [linkStyle, setLinkStyle] = useState<CitationLinkStyle>("underline");
  const draftUrls = useRef<Map<string, string>>(new Map());

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const stale = scannedFor !== "" && scannedFor !== fileKey;

  const enabledCount = useMemo(
    () => rows.filter((r) => r.enabled).length,
    [rows],
  );

  const runScan = useCallback(async () => {
    if (!file) return;
    if (!requirePro("Citation Hyperlinker")) return;
    setScanning(true);
    setProgress("Reading text layer…");
    try {
      const { detectCitations } = await importChunk(
        () => import("@/lib/citations/detect"),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hits = await detectCitations(bytes, (p) => {
        setProgress(`Scanning page ${p.page} / ${p.totalPages}`);
      });
      setRows(
        hits.map((h) => ({ ...h, enabled: true, editing: false })),
      );
      setScannedFor(fileKey);
      draftUrls.current.clear();
      if (hits.length === 0) {
        toast.info("No citations detected on this document.");
      } else {
        toast.success(
          `Found ${hits.length} citation${hits.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (err) {
      console.error("[citations] scan failed", err);
      toast.error("Citation scan failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning(false);
      setProgress("");
    }
  }, [file, fileKey, requirePro]);

  const toggleAll = useCallback((next: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, enabled: next })));
  }, []);

  const toggleOne = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }, []);

  const startEdit = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        draftUrls.current.set(id, r.lookupUrl);
        return { ...r, editing: true };
      }),
    );
  }, []);

  const cancelEdit = useCallback((id: string) => {
    draftUrls.current.delete(id);
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, editing: false } : r)),
    );
  }, []);

  const saveEdit = useCallback((id: string) => {
    const next = draftUrls.current.get(id);
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, editing: false, lookupUrl: (next ?? r.lookupUrl).trim() }
          : r,
      ),
    );
    draftUrls.current.delete(id);
  }, []);

  const jumpTo = useCallback(
    (row: Row) => {
      editorDispatch({ type: "SET_PAGE", n: row.page });
    },
    [editorDispatch],
  );

  const applyLinks = useCallback(async () => {
    if (!file) return;
    if (!requirePro("Citation Hyperlinker")) return;
    const selected = rows.filter((r) => r.enabled && r.lookupUrl.trim());
    if (selected.length === 0) {
      toast.info("Enable at least one citation to link.");
      return;
    }
    setApplying(true);
    try {
      const { applyCitationLinks, verifyCitationsLegible } = await importChunk(
        () => import("@/lib/citations/apply"),
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const inputs = selected.map((r) => ({
        page: r.page,
        rect: r.rect,
        url: r.lookupUrl.trim(),
        text: r.text,
      }));
      const out = await applyCitationLinks(bytes, inputs, linkStyle);
      // Inverse of the redaction gate: assert citation text is STILL VISIBLE
      // after linking (guards the "opaque box over citation" bug class).
      const failures = await verifyCitationsLegible(out, inputs);
      if (failures.length > 0) {
        console.error("[citations] legibility check failed", failures);
        toast.error(
          `Blocked: ${failures.length} citation region${failures.length === 1 ? "" : "s"} would be obscured — link not applied.`,
          {
            description:
              failures[0].reason +
              (failures[0].text ? ` (e.g. “${failures[0].text}”)` : ""),
          },
        );
        return;
      }
      const blobPart = new Uint8Array(out);
      const next = new File([blobPart], file.name, { type: "application/pdf" });
      replaceFile(next);
      toast.success(
        `Linked ${selected.length} citation${selected.length === 1 ? "" : "s"} — export to include them.`,
      );
    } catch (err) {
      console.error("[citations] apply failed", err);
      toast.error("Could not apply citation links", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  }, [file, rows, replaceFile, requirePro, linkStyle]);

  /* ---------- render ---------- */

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a PDF to detect Bluebook-style US citations (U.S. Reports, F., F. Supp., U.S.C., regional reporters) and add clickable links to a public case-text lookup.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
            <LinkIcon className="h-3.5 w-3.5 text-vault" />
            Citation Hyperlinker
            {!isPro && <LockBadge title="Pro — Citation Hyperlinker" />}
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-text-muted">
            Detects US legal citations and inserts clickable links.{" "}
            <span className="text-text-subtle">
              Targets point to a Google Scholar search for each citation — not a guaranteed case page.
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7"
          onClick={runScan}
          disabled={scanning || applying}
        >
          <ScanSearch className="mr-1 h-3.5 w-3.5" />
          {rows.length === 0 ? "Scan for citations" : "Re-scan"}
        </Button>
        {rows.length > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => toggleAll(true)}
              disabled={scanning || applying}
            >
              All
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => toggleAll(false)}
              disabled={scanning || applying}
            >
              None
            </Button>
          </>
        )}
        {scanning && (
          <span className="text-[11px] text-text-muted">{progress}</span>
        )}
      </div>

      {stale && rows.length > 0 && (
        <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          Document changed since scan — re-scan to refresh rects.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="max-h-[320px] overflow-y-auto rounded-md border border-border bg-surface-2">
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const draft = draftUrls.current.get(row.id) ?? row.lookupUrl;
                return (
                  <li
                    key={row.id}
                    className={cn(
                      "px-2 py-2 text-[11.5px]",
                      !row.enabled && "opacity-55",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleOne(row.id)}
                        className="mt-0.5 text-text-muted hover:text-text"
                        aria-label={row.enabled ? "Disable" : "Enable"}
                      >
                        {row.enabled ? (
                          <CheckSquare className="h-3.5 w-3.5 text-vault" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <button
                            type="button"
                            onClick={() => jumpTo(row)}
                            className="truncate font-medium text-text hover:underline"
                            title="Jump to page"
                          >
                            {row.text}
                          </button>
                          <span className="text-[10.5px] text-text-subtle">
                            p. {row.page + 1} · {CITATION_KIND_LABEL[row.kind]}
                            {row.ocrOnly && " · OCR"}
                          </span>
                        </div>
                        {row.editing ? (
                          <div className="mt-1 flex items-center gap-1">
                            <Input
                              defaultValue={draft}
                              onChange={(e) =>
                                draftUrls.current.set(row.id, e.target.value)
                              }
                              className="h-6 text-[11px]"
                              spellCheck={false}
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => saveEdit(row.id)}
                              title="Save URL"
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
                        ) : (
                          <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-text-muted">
                            <a
                              href={row.lookupUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-w-0 items-center gap-0.5 truncate text-vault hover:underline"
                              title={row.lookupUrl}
                            >
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{row.lookupUrl}</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => startEdit(row.id)}
                              className="ml-auto text-text-subtle hover:text-text"
                              title="Edit target URL"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1.5">
            <div className="text-[10.5px] font-medium uppercase tracking-wide text-text-subtle">
              Link appearance
            </div>
            <div className="flex gap-1">
              {(
                [
                  { id: "underline", label: "Underline" },
                  { id: "underline-blue-text", label: "Underline + blue text" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLinkStyle(opt.id)}
                  className={cn(
                    "flex-1 rounded border px-2 py-1 text-[11px] transition-colors",
                    linkStyle === opt.id
                      ? "border-vault bg-vault/10 text-text"
                      : "border-border bg-surface text-text-muted hover:text-text",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] leading-snug text-text-subtle">
              Legal-brief blue underline is baked into the exported PDF so citations read as links in any viewer.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7"
              onClick={applyLinks}
              disabled={applying || scanning || enabledCount === 0}
            >
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              {applying
                ? "Applying…"
                : `Apply ${enabledCount} link${enabledCount === 1 ? "" : "s"}`}
            </Button>
            <span className="text-[10.5px] text-text-subtle">
              Then export to include the links in the saved PDF.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

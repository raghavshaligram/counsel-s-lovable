/**
 * Document Hash — SHA-256 fingerprint for evidence integrity.
 *
 * Free (no account):
 *   - Compute + copy SHA-256 for the open document
 *   - Verify mode: check the document against a previously-recorded hash
 *
 * Free-signup:
 *   - Download hash receipt (JSON certificate)
 *
 * Pro:
 *   - Batch hash multiple files → production-set manifest
 *
 * Everything runs on-device via the Web Crypto API (crypto.subtle.digest).
 * No bytes leave the browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileCheck2,
  Copy,
  Check,
  Download,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Files as FilesIcon,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLoginModal } from "@/components/login-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LockBadge, useIsPro, useRequirePro } from "@/lib/pro-gate";
import type { ToolPanelCtx } from "./tool-panels";

type SingleHash = {
  name: string;
  size: number;
  sha256: string;
  computedAt: string;
};

type VerifyResult =
  | { state: "idle" }
  | { state: "match"; sha256: string }
  | { state: "mismatch"; expected: string; actual: string };

const CHUNK = 4 * 1024 * 1024;

function toHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

async function hashFile(
  file: File | Blob,
  onProgress?: (frac: number) => void,
): Promise<string> {
  // Small files: hash in one shot to keep it snappy.
  if (file.size <= CHUNK) {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    onProgress?.(1);
    return toHex(digest);
  }
  // Large files: stream through crypto.subtle in chunks so we don't hold
  // the whole thing in memory at once. Web Crypto has no streaming API, so
  // we still concatenate the digest input — but we do it via reading the
  // stream chunk-by-chunk to keep the UI responsive.
  const stream = (file as File).stream?.();
  if (stream && "getReader" in stream) {
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let read = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        read += value.byteLength;
        onProgress?.(Math.min(1, read / file.size));
      }
    }
    const total = new Uint8Array(read);
    let offset = 0;
    for (const p of parts) {
      total.set(p, offset);
      offset += p.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", total);
    onProgress?.(1);
    return toHex(digest);
  }
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  onProgress?.(1);
  return toHex(digest);
}

function normalizeHash(input: string): string {
  return input.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DocumentHashPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const isPro = useIsPro();
  const requirePro = useRequirePro();
  const openLogin = useLoginModal((s) => s.openLogin);

  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"hash" | "verify" | "batch">("hash");

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setAuthed(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setAuthed(!!session);
      if (event === "SIGNED_OUT") setAuthed(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-text">
          <FileCheck2 className="h-3.5 w-3.5 text-vault" />
          Document Hash
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-text-muted">
          SHA-256 fingerprint for chain-of-custody. Prove a document hasn't
          changed since a given date. Computed on-device — nothing uploads.
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5 text-[11.5px]">
        <TabBtn active={tab === "hash"} onClick={() => setTab("hash")}>Hash</TabBtn>
        <TabBtn active={tab === "verify"} onClick={() => setTab("verify")}>Verify</TabBtn>
        <TabBtn active={tab === "batch"} onClick={() => setTab("batch")}>
          <span className="inline-flex items-center gap-1">
            Batch {!isPro && <LockBadge title="Pro — batch manifest" />}
          </span>
        </TabBtn>
      </div>

      {tab === "hash" && (
        <HashTab
          file={file}
          authed={authed}
          openLogin={openLogin}
        />
      )}
      {tab === "verify" && <VerifyTab file={file} />}
      {tab === "batch" && (
        <BatchTab isPro={isPro} requirePro={requirePro} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 transition-colors",
        active
          ? "bg-surface text-text"
          : "text-text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------ Hash tab ------------------------------ */

function HashTab({
  file,
  authed,
  openLogin,
}: {
  file: File | null;
  authed: boolean | null;
  openLogin: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<SingleHash | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState(false);

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const stale = result !== null && file && result.name === file.name && result.size !== file.size;

  // Reset when the active file changes.
  useEffect(() => {
    setResult(null);
    setProgress(0);
  }, [fileKey]);

  const compute = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const sha = await hashFile(file, (f) => setProgress(f));
      setResult({
        name: file.name,
        size: file.size,
        sha256: sha,
        computedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[document-hash] compute failed", err);
      toast.error("Couldn't hash document", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [file]);

  const copy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.sha256);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy hash");
    }
  }, [result]);

  const downloadReceipt = useCallback(async () => {
    if (!result) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      toast("Free account needed to download the receipt", {
        description: "Computing and copying the hash stays free.",
        action: { label: "Sign in", onClick: () => openLogin() },
      });
      setPendingReceipt(true);
      openLogin();
      return;
    }
    const receipt = {
      kind: "pdfmacro.document-hash.receipt",
      version: 1,
      algorithm: "SHA-256",
      file: { name: result.name, size: result.size },
      sha256: result.sha256,
      computedAt: result.computedAt,
      note: "Computed on-device via Web Crypto (crypto.subtle.digest). No bytes were uploaded.",
    };
    const blob = new Blob([JSON.stringify(receipt, null, 2)], {
      type: "application/json",
    });
    const base = result.name.replace(/\.pdf$/i, "");
    triggerDownload(blob, `${base}.sha256-receipt.json`);
    setPendingReceipt(false);
    toast.success("Receipt downloaded");
  }, [result, openLogin]);

  // If the user signed in while a receipt was pending, complete it.
  useEffect(() => {
    if (pendingReceipt && authed) void downloadReceipt();
  }, [pendingReceipt, authed, downloadReceipt]);

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a PDF to compute its SHA-256 fingerprint.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7" onClick={compute} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileCheck2 className="mr-1 h-3.5 w-3.5" />
          )}
          {busy
            ? `Hashing… ${Math.round(progress * 100)}%`
            : result
              ? "Re-compute"
              : "Compute SHA-256"}
        </Button>
        {stale && (
          <span className="text-[11px] text-warning">File changed — re-compute.</span>
        )}
      </div>

      {result && (
        <div className="rounded-md border border-border bg-surface-2 p-2.5">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <span className="text-text-subtle">File</span>
            <span className="truncate text-text">{result.name}</span>
            <span className="text-text-subtle">Size</span>
            <span className="text-text">{fmtBytes(result.size)}</span>
            <span className="text-text-subtle">Computed</span>
            <span className="text-text">{new Date(result.computedAt).toLocaleString()}</span>
            <span className="text-text-subtle">Alg</span>
            <span className="text-text">SHA-256</span>
          </div>
          <div className="mt-2">
            <div className="text-[10.5px] uppercase tracking-wide text-text-subtle">
              Fingerprint
            </div>
            <code className="mt-0.5 block break-all rounded bg-surface px-2 py-1.5 text-[10.5px] font-mono text-text">
              {result.sha256}
            </code>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={copy}
            >
              {copied ? (
                <Check className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1 h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy hash"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={downloadReceipt}
              title={
                authed
                  ? "Download hash receipt (JSON)"
                  : "Free account — download hash receipt"
              }
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              {authed ? "Download receipt" : "Download receipt — free account"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Verify tab ----------------------------- */

function VerifyTab({ file }: { file: File | null }) {
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<VerifyResult>({ state: "idle" });

  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  useEffect(() => {
    setResult({ state: "idle" });
    setProgress(0);
  }, [fileKey]);

  const normalized = useMemo(() => normalizeHash(expected), [expected]);
  const validHex = normalized.length === 64;

  const verify = useCallback(async () => {
    if (!file || !validHex) return;
    setBusy(true);
    setProgress(0);
    try {
      const actual = await hashFile(file, (f) => setProgress(f));
      if (actual === normalized) {
        setResult({ state: "match", sha256: actual });
      } else {
        setResult({ state: "mismatch", expected: normalized, actual });
      }
    } catch (err) {
      console.error("[document-hash] verify failed", err);
      toast.error("Verify failed", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [file, normalized, validHex]);

  if (!file) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface-2 px-2.5 py-3 text-[11.5px] leading-snug text-text-muted">
        Open a PDF to verify it against a previously-recorded SHA-256 hash.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wide text-text-subtle">
          Recorded SHA-256
        </label>
        <Input
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          placeholder="paste 64-char hex hash"
          className="h-7 font-mono text-[11px]"
          spellCheck={false}
        />
        {expected && !validHex && (
          <div className="mt-1 text-[10.5px] text-warning">
            Needs 64 hex characters ({normalized.length}/64).
          </div>
        )}
      </div>

      <div>
        <Button
          size="sm"
          className="h-7"
          onClick={verify}
          disabled={busy || !validHex}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1 h-3.5 w-3.5" />
          )}
          {busy ? `Hashing… ${Math.round(progress * 100)}%` : "Verify document"}
        </Button>
      </div>

      {result.state === "match" && (
        <div className="rounded-md border border-vault/40 bg-vault/10 p-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-vault">
            <ShieldCheck className="h-3.5 w-3.5" />
            MATCH — document is unchanged
          </div>
          <code className="mt-1 block break-all text-[10.5px] font-mono text-text-muted">
            {result.sha256}
          </code>
        </div>
      )}
      {result.state === "mismatch" && (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
            <ShieldAlert className="h-3.5 w-3.5" />
            MISMATCH — document has been modified
          </div>
          <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
            <span className="text-text-subtle">Expected</span>
            <code className="break-all font-mono text-text-muted">{result.expected}</code>
            <span className="text-text-subtle">Actual</span>
            <code className="break-all font-mono text-text">{result.actual}</code>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Batch tab ------------------------------ */

type BatchRow = {
  name: string;
  size: number;
  sha256: string;
};

function BatchTab({
  isPro,
  requirePro,
}: {
  isPro: boolean;
  requirePro: (feature?: string) => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [progress, setProgress] = useState("");

  const pick = useCallback(() => {
    if (!requirePro("Batch document hashing")) return;
    inputRef.current?.click();
  }, [requirePro]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!requirePro("Batch document hashing")) return;
      const list = Array.from(files);
      setBusy(true);
      setRows([]);
      try {
        const out: BatchRow[] = [];
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          setProgress(`Hashing ${i + 1} / ${list.length} — ${f.name}`);
          const sha = await hashFile(f);
          out.push({ name: f.name, size: f.size, sha256: sha });
        }
        setRows(out);
        toast.success(`Hashed ${out.length} file${out.length === 1 ? "" : "s"}`);
      } catch (err) {
        console.error("[document-hash] batch failed", err);
        toast.error("Batch hashing failed", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
        setProgress("");
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [requirePro],
  );

  const downloadManifest = useCallback(
    (kind: "json" | "csv") => {
      if (!requirePro("Batch document hashing")) return;
      if (rows.length === 0) return;
      const stamp = new Date().toISOString();
      if (kind === "json") {
        const manifest = {
          kind: "pdfmacro.production-set.manifest",
          version: 1,
          algorithm: "SHA-256",
          generatedAt: stamp,
          count: rows.length,
          files: rows,
        };
        triggerDownload(
          new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
          `production-set-manifest.json`,
        );
      } else {
        const header = "filename,size_bytes,sha256\n";
        const body = rows
          .map(
            (r) =>
              `"${r.name.replace(/"/g, '""')}",${r.size},${r.sha256}`,
          )
          .join("\n");
        triggerDownload(
          new Blob([header + body + "\n"], { type: "text/csv" }),
          `production-set-manifest.csv`,
        );
      }
      toast.success("Manifest downloaded");
    },
    [rows, requirePro],
  );

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11.5px] leading-snug text-text-muted">
        Hash multiple files at once and export a production-set manifest
        (filename + SHA-256) for chain-of-custody.
        {!isPro && (
          <span className="ml-1 inline-flex items-center gap-1 text-text-subtle">
            <LockBadge title="Pro — batch manifest" />
            Pro feature.
          </span>
        )}
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="h-7" onClick={pick} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FilesIcon className="mr-1 h-3.5 w-3.5" />
          )}
          {busy ? "Hashing…" : "Choose files"}
        </Button>
        {busy && progress && (
          <span className="text-[11px] text-text-muted">{progress}</span>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <div className="max-h-[280px] overflow-y-auto rounded-md border border-border bg-surface-2">
            <ul className="divide-y divide-border">
              {rows.map((r, i) => (
                <li key={i} className="px-2 py-1.5 text-[11px]">
                  <div className="truncate font-medium text-text">{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-text-subtle">
                    <span>{fmtBytes(r.size)}</span>
                  </div>
                  <code className="mt-0.5 block break-all font-mono text-[10.5px] text-text-muted">
                    {r.sha256}
                  </code>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={() => downloadManifest("json")}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Manifest (JSON)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="h-7"
              onClick={() => downloadManifest("csv")}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              Manifest (CSV)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

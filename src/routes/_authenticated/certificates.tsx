/**
 * Compliance Portfolio — signed-in users' saved certificates.
 *
 * Lists every certificate the user has issued (redaction, sanitize, bates,
 * sovereignty), grouped by source file. Each row regenerates the certificate
 * PDF on-device from the stored payload and downloads it.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileBadge2, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";

import {
  deleteCertificate,
  getCertificate,
  listMyCertificates,
  saveCertificate,
  type ComplianceCertKind,
  type ComplianceCertSummary,
} from "@/lib/certificates.functions";
import { downloadPdf } from "@/lib/pdf/download";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/certificates")({
  head: () => ({
    meta: [
      { title: "Compliance Portfolio — CounselPDF" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CertificatesPage,
});

const KIND_LABEL: Record<ComplianceCertKind, string> = {
  redaction: "Redaction Certificate",
  sanitize: "Metadata Sanitization Report",
  bates: "Discovery Production Audit Log",
  sovereignty: "On-Device Sovereignty Certificate",
};

function CertificatesPage() {
  const listFn = useServerFn(listMyCertificates);
  const { data, isPending } = useQuery({
    queryKey: ["my-certificates"],
    queryFn: () => listFn(),
  });

  const groups = useMemo(() => groupBySource(data ?? []), [data]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface-1/60 backdrop-blur">
        <div className="mx-auto max-w-3xl px-5 h-12 flex items-center justify-between">
          <Link to="/workspace" className="inline-flex items-center gap-1.5 text-[12.5px] text-text-2 hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
          </Link>
          <Link to="/account" className="text-[12.5px] text-text-2 hover:text-foreground">Account →</Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-vault">
            <FileBadge2 className="h-4 w-4" />
          </span>
          <div>
            <h1 className="font-display text-2xl tracking-tight">Compliance Portfolio</h1>
            <p className="mt-1 text-[13px] text-text-2">
              Every compliance certificate you've issued. Regenerated on-device from your stored counts and hashes — the sensitive document content was never uploaded.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-md border border-vault/25 bg-vault/[0.04] px-4 py-3 text-[12.5px] text-text-2">
          <div className="inline-flex items-center gap-1.5 text-vault">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="font-medium">On-device guarantee</span>
          </div>
          <p className="mt-1">
            CounselPDF stores certificate metadata only (file name, page count, redaction counts, hashes). Your documents themselves stay on your machine.
          </p>
        </div>

        <SovereigntyIssuer />

        {isPending ? (
          <div className="mt-10 flex items-center gap-2 text-text-2 text-[13px]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your portfolio…
          </div>
        ) : groups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            {groups.map((g) => (
              <FileGroup key={g.sourceName} sourceName={g.sourceName} certificates={g.certificates} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function groupBySource(list: ComplianceCertSummary[]): Array<{ sourceName: string; certificates: ComplianceCertSummary[] }> {
  const map = new Map<string, ComplianceCertSummary[]>();
  for (const c of list) {
    const arr = map.get(c.sourceName) ?? [];
    arr.push(c);
    map.set(c.sourceName, arr);
  }
  return Array.from(map.entries()).map(([sourceName, certificates]) => ({ sourceName, certificates }));
}

function FileGroup({ sourceName, certificates }: { sourceName: string; certificates: ComplianceCertSummary[] }) {
  return (
    <section className="rounded-md border border-border bg-surface-1">
      <header className="border-b border-border px-4 py-2.5 text-[12.5px]">
        <div className="font-mono text-foreground truncate" title={sourceName}>{sourceName}</div>
        <div className="text-[11px] text-text-muted mt-0.5">{certificates.length} certificate{certificates.length === 1 ? "" : "s"}</div>
      </header>
      <ul>
        {certificates.map((c) => (
          <li key={c.id}>
            <CertRow cert={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CertRow({ cert }: { cert: ComplianceCertSummary }) {
  const get = useServerFn(getCertificate);
  const del = useServerFn(deleteCertificate);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const rec = await get({ data: { id: cert.id } });
      const bytes = await renderCertificate(rec.kind, rec.payload as Record<string, unknown>);
      await downloadPdf(bytes, fileNameFor(cert));
    } catch (e) {
      toast.error("Couldn't download certificate", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const delM = useMutation({
    mutationFn: async () => del({ data: { id: cert.id } }),
    onSuccess: () => {
      toast.success("Certificate deleted");
      qc.invalidateQueries({ queryKey: ["my-certificates"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{KIND_LABEL[cert.kind]}</div>
        <div className="text-[11px] text-text-muted">Issued {new Date(cert.createdAt).toLocaleString()}</div>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDownload}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-vault-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileBadge2 className="h-3 w-3" />}
          {busy ? "Building…" : "Download"}
        </button>
        <button
          type="button"
          onClick={() => delM.mutate()}
          disabled={delM.isPending}
          className="grid h-7 w-7 place-items-center rounded text-text-muted transition-colors hover:bg-surface-2 hover:text-destructive"
          aria-label="Delete certificate"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function fileNameFor(cert: ComplianceCertSummary): string {
  const base = cert.sourceName.replace(/\.pdf$/i, "");
  const suffix: Record<ComplianceCertKind, string> = {
    redaction: "certificate-of-redaction",
    sanitize: "sanitization-report",
    bates: "bates-audit-log",
    sovereignty: "sovereignty-certificate",
  };
  return `${base}-${suffix[cert.kind]}.pdf`;
}

async function renderCertificate(kind: ComplianceCertKind, payload: Record<string, unknown>): Promise<Uint8Array> {
  if (kind === "redaction") {
    const { buildRedactionCertificate } = await import("@/lib/pdf/redaction-certificate");
    return buildRedactionCertificate(payload as never);
  }
  const { buildSanitizeCertificate, buildBatesCertificate, buildSovereigntyCertificate } = await import("@/lib/pdf/certificates");
  if (kind === "sanitize") return buildSanitizeCertificate(payload as never);
  if (kind === "bates") return buildBatesCertificate(payload as never);
  return buildSovereigntyCertificate(payload as never);
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-md border border-dashed border-border bg-surface-1/40 px-6 py-10 text-center">
      <FileBadge2 className="mx-auto h-6 w-6 text-text-muted" />
      <p className="mt-3 text-[13px] text-text-2">
        No certificates yet. Run a verified redaction, sanitize, or Bates job in the workspace and a value-gate card will let you save the official certificate here.
      </p>
      <Link
        to="/workspace"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12.5px] font-medium text-vault-foreground transition-opacity hover:opacity-90"
      >
        Open workspace
      </Link>
    </div>
  );
}

function SovereigntyIssuer() {
  const save = useServerFn(saveCertificate);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File) => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { sha256Hex, buildSovereigntyCertificate } = await import("@/lib/pdf/certificates");
      const hash = await sha256Hex(bytes);
      const payload = {
        sourceName: file.name,
        sourceBytes: file.size,
        action: "On-Device Sovereignty attestation",
        bytesTransmitted: 0 as const,
        outputHashSHA256: hash,
      };
      const cert = await buildSovereigntyCertificate(payload);
      await save({
        data: {
          kind: "sovereignty",
          sourceName: file.name,
          caseLabel: null,
          payload: payload as never,
        },
      });
      await downloadPdf(cert, `${file.name.replace(/\.pdf$/i, "")}-sovereignty-certificate.pdf`);
      toast.success("Sovereignty certificate issued");
      qc.invalidateQueries({ queryKey: ["my-certificates"] });
    } catch (e) {
      toast.error("Couldn't issue sovereignty certificate", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2/40 px-4 py-3">
      <div className="text-[12.5px] text-text-2">
        <span className="text-foreground font-medium">On-Device Sovereignty Certificate</span> — attest that a given file
        was processed entirely on this device, with zero bytes transmitted.
      </div>
      <label className={cn("inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-2 cursor-pointer", busy && "opacity-60 cursor-wait")}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
        {busy ? "Issuing…" : "Issue for file…"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onPick(f);
          }}
        />
      </label>
    </div>
  );
}

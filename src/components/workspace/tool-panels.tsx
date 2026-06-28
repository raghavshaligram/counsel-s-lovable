

/* ============================ Sanitize ============================ */

function SanitizePanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file } = ctx;
  const [busy, setBusy] = useState(false);

  if (!file) {
    return (
      <InspectorEmpty>
        Open a PDF to strip hidden metadata, embedded files, scripts, and form data.
      </InspectorEmpty>
    );
  }

  const run = async () => {
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { sanitizePdfBytes } = await importChunk(() => import("@/lib/pdf/sanitize"));
      const clean = await sanitizePdfBytes(bytes);
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBytes(clean, `${base}-sanitized.pdf`, "application/pdf");
      toast.success("Sanitized — hidden data removed");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't sanitize this PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-snug text-text-muted">
        Removes metadata, embedded files, JavaScript, form values, and XMP data.
        Visible page content is preserved.
      </p>
      <Button
        onClick={run}
        disabled={busy}
        className="w-full bg-vault text-vault-foreground hover:opacity-90"
      >
        {busy ? "Sanitizing…" : "Sanitize & download"}
      </Button>
      <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing is uploaded
      </div>
    </div>
  );
}

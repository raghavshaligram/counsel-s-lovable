/**
 * Tool panels — per-tool inspector bodies. Exactly ONE renders inside the
 * single Inspector container at any time. No outer card/wrapper here: the
 * Inspector already provides the header, border, and scroll area.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Search,
  Tag,
  ShieldCheck,
  Wand2,
  PenLine,
  FileText,
  Download,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SignatureCreator } from "./signature-creators";
import type { Action as EditorAction } from "@/lib/editor/state";
import {
  detectFormFields,
  applyFormFill,
  type FormFieldInfo,
} from "@/lib/pdf/sign-fill";

export type ToolPanelCtx = {
  /** The active tab's PDF file (or null when none open). */
  file: File | null;
  /** Replace the active tab's file in place (used by Fill → apply). */
  replaceFile: (f: File) => void;
  /** Dispatch into the active tab's editor state. */
  editorDispatch: (a: EditorAction) => void;
};

type PanelProps = { toolId: string; ctx: ToolPanelCtx };

export function ToolPanel({ toolId, ctx }: PanelProps) {
  switch (toolId) {
    case "redact":
      return <RedactPanel />;
    case "sign":
      return <SignFillPanel ctx={ctx} />;
    default:
      return <ComingSoonPanel label={toolId} />;
  }
}

/* ============================ Sign & Fill ============================ */

type SavedSig = { id: string; pngDataUrl: string; aspect: number };

function SignFillPanel({ ctx }: { ctx: ToolPanelCtx }) {
  const { file, replaceFile, editorDispatch } = ctx;
  const [saved, setSaved] = useState<SavedSig[]>([]);
  const [armedSigId, setArmedSigId] = useState<string | null>(null);

  /* ---- Form fields ---- */
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [flatten, setFlatten] = useState(true);

  /* Re-scan whenever the active file changes (file is swapped after Fill). */
  const fileKey = file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  const rescan = useCallback(async () => {
    if (!file) {
      setFields(null);
      setValues({});
      return;
    }
    setScanning(true);
    try {
      const f = await detectFormFields(file);
      setFields(f);
      setValues(Object.fromEntries(f.map((x) => [x.name, x.value])));
    } catch (err) {
      console.error("[sign-fill] detect failed", err);
      setFields([]);
      toast.error("Couldn't read form fields", { description: (err as Error).message });
    } finally {
      setScanning(false);
    }
  }, [file]);

  useEffect(() => {
    void rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey]);

  /* ---- Signature: arm a saved sig as the pending image so the editor
         canvas drops it on the next click (reuses the image-place tool). */
  const armSignature = useCallback(
    (s: SavedSig) => {
      const img = new Image();
      img.onload = () => {
        editorDispatch({
          type: "SET_PENDING_IMAGE",
          img: { dataUrl: s.pngDataUrl, mime: "image/png", w: img.naturalWidth, h: img.naturalHeight },
        });
        editorDispatch({ type: "SET_TOOL", t: "image" });
        setArmedSigId(s.id);
        toast.success("Click a page to place the signature");
      };
      img.src = s.pngDataUrl;
    },
    [editorDispatch],
  );

  const onSavedFromCreator = useCallback(
    ({ pngDataUrl, aspect }: { pngDataUrl: string; aspect: number }) => {
      const id = Math.random().toString(36).slice(2, 10);
      const sig: SavedSig = { id, pngDataUrl, aspect };
      setSaved((p) => [sig, ...p].slice(0, 6));
      armSignature(sig);
    },
    [armSignature],
  );

  /* ---- Apply form fill ---- */
  const applyFill = useCallback(async () => {
    if (!file || !fields || fields.length === 0) return;
    setApplying(true);
    try {
      const out = await applyFormFill({ file, values, flatten });
      replaceFile(out);
      toast.success(flatten ? "Form filled and flattened" : "Form filled");
    } catch (err) {
      console.error("[sign-fill] apply failed", err);
      toast.error("Couldn't apply form values", { description: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }, [file, fields, values, flatten, replaceFile]);

  if (!file) {
    return (
      <p className="text-[11.5px] leading-snug text-text-2">
        Open a document to start signing or filling form fields.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ───────────────── Signature ───────────────── */}
      <Section title="Signature" icon={<PenLine className="h-3 w-3" />}>
        <SignatureCreator onSave={onSavedFromCreator} />

        {saved.length > 0 && (
          <div className="mt-2.5">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
              Saved
            </div>
            <ul className="flex flex-col gap-1">
              {saved.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border bg-surface-2 px-1.5 py-1",
                    armedSigId === s.id ? "border-vault/60" : "border-border",
                  )}
                >
                  <img
                    src={s.pngDataUrl}
                    alt=""
                    className="h-7 w-12 shrink-0 rounded bg-white object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => armSignature(s)}
                    className="flex-1 truncate text-left text-[11.5px] text-foreground hover:text-vault"
                  >
                    {armedSigId === s.id ? "Click a page to place…" : "Use this signature"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSaved((p) => p.filter((x) => x.id !== s.id));
                      if (armedSigId === s.id) {
                        setArmedSigId(null);
                        editorDispatch({ type: "SET_PENDING_IMAGE", img: null });
                        editorDispatch({ type: "SET_TOOL", t: "select" });
                      }
                    }}
                    aria-label="Remove signature"
                    className="grid h-6 w-6 place-items-center rounded text-text-muted hover:bg-surface-3 hover:text-foreground"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Signatures land as image annotations on the canvas — drag to reposition, resize from the corner, or delete with ×.
        </p>
      </Section>

      {/* ───────────────── Form fields ───────────────── */}
      <Section
        title="Form fields"
        icon={<FileText className="h-3 w-3" />}
        right={
          <button
            type="button"
            onClick={rescan}
            disabled={scanning}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-text-2 hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className={cn("h-3 w-3", scanning && "animate-spin")} />
            Rescan
          </button>
        }
      >
        {fields === null || scanning ? (
          <p className="text-[11.5px] text-text-muted">Scanning document…</p>
        ) : fields.length === 0 ? (
          <p className="text-[11.5px] text-text-muted">
            No fillable form fields detected in this document.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {fields.map((f) => (
                <li key={f.name} className="flex flex-col gap-1">
                  <label className="truncate text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
                    {f.name}
                  </label>
                  {f.kind === "text" && (
                    f.multiline ? (
                      <textarea
                        value={values[f.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                      />
                    ) : (
                      <input
                        value={values[f.name] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
                      />
                    )
                  )}
                  {f.kind === "checkbox" && (
                    <label className="inline-flex items-center gap-2 text-[12px] text-foreground">
                      <input
                        type="checkbox"
                        checked={(values[f.name] ?? "false") === "true"}
                        onChange={(e) =>
                          setValues((v) => ({ ...v, [f.name]: e.target.checked ? "true" : "false" }))
                        }
                        className="h-3.5 w-3.5 accent-[var(--vault)]"
                      />
                      Checked
                    </label>
                  )}
                  {(f.kind === "dropdown" || f.kind === "optionlist" || f.kind === "radio") && (
                    <select
                      value={values[f.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-vault/50"
                    >
                      <option value="">— none —</option>
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  )}
                  {f.kind === "other" && (
                    <p className="text-[10.5px] text-text-muted">Unsupported field type.</p>
                  )}
                </li>
              ))}
            </ul>

            <label className="mt-3 flex items-center gap-2 text-[11px] text-text-2">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
                className="h-3 w-3 accent-[var(--vault)]"
              />
              Flatten after apply (fields baked, no longer editable)
            </label>

            <button
              type="button"
              onClick={applyFill}
              disabled={applying}
              className={cn(
                "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90",
                applying && "opacity-60 cursor-wait",
              )}
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.5} />
              {applying ? "Applying…" : "Apply to document"}
            </button>
          </>
        )}
      </Section>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ------------------------------ Redact ------------------------------ */

function RedactPanel() {
  const [query, setQuery] = useState("");
  const [exemption, setExemption] = useState("");

  return (
    <div className="flex flex-col gap-4">
      <Section title="Get started">
        <p className="text-[11.5px] leading-snug text-text-2">
          Drag a box over the page to redact, or use the tools below. Redactions
          are baked in on export — never reversible.
        </p>
      </Section>

      <Section title="Auto-detect PII" icon={<Wand2 className="h-3 w-3" />}>
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-vault px-2.5 py-1.5 text-[12px] font-medium text-vault-foreground hover:opacity-90"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
          Scan this document
        </button>
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Finds names, emails, phone numbers, SSNs, addresses.
        </p>
      </Section>

      <Section title="Find &amp; redact" icon={<Search className="h-3 w-3" />}>
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Text or /regex/"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
          />
          <button
            type="button"
            disabled={!query.trim()}
            className={cn(
              "rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-surface-3",
              !query.trim() && "opacity-40 cursor-not-allowed",
            )}
          >
            Find
          </button>
        </div>
      </Section>

      <Section title="Exemption label" icon={<Tag className="h-3 w-3" />}>
        <input
          value={exemption}
          onChange={(e) => setExemption(e.target.value)}
          placeholder="e.g. FOIA (b)(6)"
          className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
        />
        <p className="mt-1.5 text-[10.5px] text-text-muted">
          Stamped on each redaction mark.
        </p>
      </Section>

      <div className="mt-auto flex items-center gap-1.5 rounded-md bg-accent-soft px-2.5 py-2 text-[10.5px] text-vault">
        <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
        On-device · nothing leaves your browser
      </div>
    </div>
  );
}

/* ----------------------------- Generic ------------------------------ */

function ComingSoonPanel({ label }: { label: string }) {
  return (
    <p className="text-[11.5px] leading-snug text-text-2">
      The native <span className="text-foreground">{label}</span> panel is being
      mounted here. The full controls land in the next pass — same single
      inspector, no second column.
    </p>
  );
}

/* ----------------------------- Section ------------------------------ */

function Section({
  title,
  icon,
  right,
  children,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-text-muted">
        <div className="flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

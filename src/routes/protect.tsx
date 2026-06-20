import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { FileDropzone } from "@/components/file-dropzone";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, ShieldCheck, KeyRound } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import { FileBar, ToolHeader, downloadBlob } from "@/routes/split";
import { useHotkey } from "@/lib/use-hotkey";
import {
  protectPdf,
  scorePasswordStrength,
  DEFAULT_PROTECT_PERMS,
  type ProtectPermissions,
} from "@/lib/pdf/protect";

export const Route = createFileRoute("/protect")({
  head: () => ({
    meta: [
      { title: "Password Protect PDF — VaultPDF" },
      {
        name: "description",
        content:
          "Encrypt PDFs with a password and lock printing, copying, or editing — 128-bit AES, processed entirely in your browser.",
      },
      { property: "og:title", content: "Password Protect PDF — VaultPDF" },
      {
        property: "og:description",
        content:
          "Add AES-128 encryption and permission locks to any PDF. No upload, ever.",
      },
      { property: "og:url", content: "/protect" },
    ],
    links: [{ rel: "canonical", href: "/protect" }],
  }),
  component: ProtectPage,
});

type Permissions = {
  printing: boolean;
  modifying: boolean;
  copying: boolean;
  annotating: boolean;
  fillingForms: boolean;
  contentAccessibility: boolean;
  documentAssembly: boolean;
};

const DEFAULT_PERMS: Permissions = {
  printing: true,
  modifying: false,
  copying: false,
  annotating: true,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: false,
};

const PERM_ROWS: { key: keyof Permissions; label: string; desc: string }[] = [
  { key: "printing", label: "Allow printing", desc: "Print high-resolution copies" },
  { key: "copying", label: "Allow copying text & images", desc: "Selection and clipboard access" },
  { key: "modifying", label: "Allow editing content", desc: "Change pages, text, or structure" },
  { key: "annotating", label: "Allow comments & markup", desc: "Sticky notes, highlights" },
  { key: "fillingForms", label: "Allow filling forms", desc: "Type into interactive fields" },
  { key: "documentAssembly", label: "Allow page assembly", desc: "Insert, delete, rotate pages" },
  { key: "contentAccessibility", label: "Allow accessibility tools", desc: "Screen readers can read content" },
];

function ProtectPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [userPassword, setUserPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [useOwnerPw, setUseOwnerPw] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [perms, setPerms] = useState<Permissions>(DEFAULT_PERMS);
  const [busy, setBusy] = useState(false);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    try {
      const doc = await PDFDocument.load(await f.arrayBuffer(), {
        ignoreEncryption: true,
      });
      setPageCount(doc.getPageCount());
    } catch {
      toast.error("Couldn't open that PDF. Is it already encrypted?");
      setFile(null);
    }
  }, []);

  const reset = () => {
    setFile(null);
    setPageCount(0);
    setUserPassword("");
    setConfirmPassword("");
    setOwnerPassword("");
    setUseOwnerPw(false);
    setPerms(DEFAULT_PERMS);
  };

  const togglePerm = (k: keyof Permissions) =>
    setPerms((p) => ({ ...p, [k]: !p[k] }));

  const strength = scoreStrength(userPassword);

  const run = async () => {
    if (!file) return;
    if (userPassword.length < 4) {
      toast.error("Password must be at least 4 characters.");
      return;
    }
    if (userPassword !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    if (useOwnerPw && ownerPassword.length < 4) {
      toast.error("Owner password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      const { PDFDocument: CantooPDFDocument } = await import("@cantoo/pdf-lib");
      const doc = await CantooPDFDocument.load(await file.arrayBuffer(), {
        ignoreEncryption: true,
      });
      await doc.encrypt({
        userPassword,
        ownerPassword: useOwnerPw ? ownerPassword : userPassword,
        permissions: {
          printing: perms.printing ? "highResolution" : undefined,
          modifying: perms.modifying,
          copying: perms.copying,
          annotating: perms.annotating,
          fillingForms: perms.fillingForms,
          contentAccessibility: perms.contentAccessibility,
          documentAssembly: perms.documentAssembly,
        },
      });
      const bytes = await doc.save();
      const base = file.name.replace(/\.pdf$/i, "");
      downloadBlob(
        new Blob([bytes as BlobPart], { type: "application/pdf" }),
        `${base}-protected.pdf`,
      );
      toast.success("Encrypted PDF downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Encryption failed. Try a different PDF.");
    } finally {
      setBusy(false);
    }
  };

  useHotkey("mod+Enter", () => { void run(); }, !!file && !busy);
  return (
    <AppShell>
      <ToolHeader
        tag="Protect"
        title="Lock your PDF with a password."
        sub="AES-128 encryption and granular permission controls. Done locally — your password never leaves this tab."
        collapsed={!!file}
      />
      <div className={`mx-auto px-5 md:px-8 py-10 ${file ? "max-w-5xl" : "max-w-3xl"}`}>
        {!file ? (
          <FileDropzone onFile={onFile} label="Drop a PDF to encrypt" sublabel="no upload" />
        ) : (
          <div className="space-y-6">
            <FileBar
              file={file}
              info={`${pageCount} page${pageCount === 1 ? "" : "s"}`}
              onClose={reset}
              onReplace={onFile}
            />

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                Open password
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete="new-password"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
                />
              </div>

              {userPassword && (
                <div className="space-y-1">
                  <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full transition-all ${strength.color}`}
                      style={{ width: `${strength.pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {strength.label}
                    {confirmPassword && confirmPassword !== userPassword && (
                      <span className="ml-2 text-destructive">Passwords don't match</span>
                    )}
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={useOwnerPw}
                  onChange={(e) => setUseOwnerPw(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-vault"
                />
                <div>
                  <div className="text-sm">Set separate owner password</div>
                  <div className="text-[11px] text-muted-foreground">
                    Owners can change permissions. Recipients only need the open password.
                  </div>
                </div>
              </label>

              {useOwnerPw && (
                <input
                  type={showPw ? "text" : "password"}
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="Owner password"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/40"
                />
              )}
            </div>

            <div className="rounded-lg border border-border bg-card/50 p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                Permissions
              </div>
              <div className="text-[11px] text-muted-foreground -mt-1">
                Restrict what recipients can do, even after they enter the password.
              </div>
              <div className="grid sm:grid-cols-2 gap-2 pt-1">
                {PERM_ROWS.map((row) => (
                  <label
                    key={row.key}
                    className="flex items-start gap-2.5 rounded-md border border-border bg-background/40 px-3 py-2.5 cursor-pointer hover:bg-background/70 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={perms[row.key]}
                      onChange={() => togglePerm(row.key)}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-vault"
                    />
                    <div className="min-w-0">
                      <div className="text-sm leading-tight">{row.label}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{row.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <Button
              onClick={run}
              disabled={busy || !userPassword || userPassword !== confirmPassword}
              className="bg-vault text-vault-foreground hover:opacity-90 w-full h-11"
            >
              <Lock className="h-4 w-4 mr-2" />
              {busy ? "Encrypting…" : "Encrypt & download"}
            </Button>
            <div className="text-center text-[11px] text-muted-foreground">
              🔒 Encrypted in your browser. Your password is never transmitted.
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function scoreStrength(pw: string): { pct: number; label: string; color: string } {
  if (!pw) return { pct: 0, label: "", color: "bg-muted" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { pct: 15, label: "Very weak", color: "bg-destructive" },
    { pct: 30, label: "Weak", color: "bg-destructive" },
    { pct: 50, label: "Fair", color: "bg-amber-500" },
    { pct: 70, label: "Good", color: "bg-amber-400" },
    { pct: 85, label: "Strong", color: "bg-vault" },
    { pct: 100, label: "Very strong", color: "bg-vault" },
  ];
  return map[Math.min(s, 5)];
}

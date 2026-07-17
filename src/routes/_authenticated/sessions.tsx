/**
 * Saved Cases — signed-in users' workspace session manifests.
 *
 * Lists each saved case session. Restore prompts the user to re-attach
 * the same source file from disk (bytes never leave the device); the
 * stored configs (Bates settings, etc.) re-apply automatically once the
 * file is open in the workspace because they're keyed by name + size.
 */
import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FolderOpen, Loader2, Save, Trash2, Upload } from "lucide-react";

import {
  deleteCaseSession,
  getCaseSession,
  listCaseSessions,
  type CaseSessionSummary,
} from "@/lib/case-sessions.functions";
import { setBatesSettings, docKey, BATES_DEFAULT } from "@/lib/workspace/bates-store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/sessions")({
  head: () => ({
    meta: [
      { title: "Saved Cases — PDFMacro" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SessionsPage,
});

type RestoreManifest = {
  version?: number;
  file?: { name: string; size: number; sha256?: string | null };
  bates?: typeof BATES_DEFAULT;
};

function SessionsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listFn = useServerFn(listCaseSessions);
  const getFn = useServerFn(getCaseSession);
  const delFn = useServerFn(deleteCaseSession);
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState<CaseSessionSummary | null>(null);
  const [pendingManifest, setPendingManifest] = useState<RestoreManifest | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => listFn(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-sessions"] });
      toast.success("Session deleted");
    },
    onError: (err) => toast.error("Couldn't delete", { description: (err as Error).message }),
  });

  const beginRestore = async (s: CaseSessionSummary) => {
    try {
      const full = await getFn({ data: { id: s.id } });
      setRestoring(s);
      setPendingManifest(full.manifest as RestoreManifest);
      fileInput.current?.click();
    } catch (err) {
      toast.error("Couldn't load session", { description: (err as Error).message });
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !pendingManifest) return;
    const expected = pendingManifest.file;
    if (expected && (f.name !== expected.name || f.size !== expected.size)) {
      toast.error("File doesn't match the saved session", {
        description: `Expected ${expected.name} (${expected.size} bytes).`,
      });
      return;
    }
    // Re-apply the stored Bates settings under the file's docKey so the
    // workspace picks them up the moment the file is opened.
    const key = docKey({ name: f.name, size: f.size });
    if (key && pendingManifest.bates) {
      setBatesSettings(key, { ...BATES_DEFAULT, ...pendingManifest.bates });
    }
    toast.success(`Restored: ${restoring?.name ?? "session"}`, {
      description: "Settings applied. Open the file in the workspace.",
    });
    void navigate({ to: "/workspace" });
  };

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
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="mb-6 flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-vault">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-[18px] font-semibold text-foreground">Saved cases</h1>
            <p className="mt-0.5 text-[12.5px] text-text-2">
              Settings, Bates layouts, and session manifests — saved in your account so a
              browser cache wipe doesn't lose your setup. File contents stay on your device.
            </p>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={onFilePicked}
        />

        {isPending ? (
          <div className="flex items-center gap-2 text-[12.5px] text-text-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data || data.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface-1/40 px-4 py-8 text-center text-[13px] text-text-2">
            <Save className="mx-auto mb-2 h-5 w-5 text-text-muted" />
            No saved case sessions yet. From the workspace, choose
            <span className="mx-1 font-medium text-foreground">Save case session</span>
            to preserve your setup.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.map((s) => (
              <li
                key={s.id}
                className="flex items-start gap-3 rounded-md border border-border bg-surface-1/60 px-3.5 py-3"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft text-vault">
                  <Save className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">{s.name}</div>
                  <div className="truncate text-[11.5px] text-text-2">
                    {s.sourceName ?? "—"} · saved {new Date(s.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void beginRestore(s)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-vault/40 bg-accent-soft px-2.5 py-1.5 text-[12px] font-medium text-vault hover:bg-vault/15",
                  )}
                >
                  <Upload className="h-3.5 w-3.5" /> Restore
                </button>
                <button
                  type="button"
                  onClick={() => deleteMut.mutate(s.id)}
                  disabled={deleteMut.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-[12px] text-text-2 hover:border-destructive/50 hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

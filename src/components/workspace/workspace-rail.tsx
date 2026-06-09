// Right-side workspace rail: files list (top) + activity / next-step (bottom).
// Mounted by AppShell. Stays out of the way on mobile (drawer trigger).

import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, X, Plus, Undo2, Sparkles, Lock as LockIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useActiveFile, useWorkspace } from "@/lib/workspace/store";
import { suggestionsForFile } from "@/lib/workspace/suggestions";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAge(at: number): string {
  const ms = Date.now() - at;
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function WorkspaceRail({ className }: { className?: string }) {
  const files = useWorkspace((s) => s.files);
  const activeId = useWorkspace((s) => s.activeFileId);
  const setActive = useWorkspace((s) => s.setActive);
  const removeFile = useWorkspace((s) => s.removeFile);
  const persist = useWorkspace((s) => s.persistAcrossSessions);
  const setPersist = useWorkspace((s) => s.setPersist);
  const undoLast = useWorkspace((s) => s.undoLast);
  const clearAll = useWorkspace((s) => s.clearAll);
  const addFile = useWorkspace((s) => s.addFile);
  const active = useActiveFile();
  const navigate = useNavigate();

  // Drag-and-drop "+ Add file" sub-target
  const [drag, setDrag] = useState(false);

  const onPickFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/jpeg,image/png,image/webp";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) await addFile(f);
    };
    input.click();
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) await addFile(f);
  };

  const suggestions = suggestionsForFile(active);
  const lastOp = active?.ops[active.ops.length - 1];
  const canUndo = !!lastOp?.hasSnapshot;

  return (
    <aside
      className={cn(
        "hidden xl:flex w-72 shrink-0 flex-col border-l border-border bg-card/30",
        className,
      )}
    >
      {/* Files section */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Workspace
        </div>
        {files.length > 0 && (
          <button
            onClick={async () => {
              await clearAll();
              toast.success("Workspace cleared");
            }}
            className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          "mx-3 mb-2 rounded-md border border-dashed border-border/70 p-2 transition-colors",
          drag && "border-vault bg-vault/5",
        )}
      >
        <button
          onClick={onPickFile}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add file
          <span className="ml-auto text-[10px] opacity-60">or drop</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-3">
        {files.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-muted-foreground/70">
            No files yet. Drop a PDF on any tool and it lands here.
          </div>
        ) : (
          files.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={cn(
                "group w-full flex items-start gap-2 rounded-md p-2 text-left transition-colors",
                f.id === activeId
                  ? "bg-vault/10 ring-1 ring-vault/40"
                  : "hover:bg-muted/40",
              )}
            >
              <div className="h-12 w-9 shrink-0 rounded-sm bg-background border border-border overflow-hidden grid place-items-center">
                {f.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.thumbnail} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium truncate">{f.name}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {f.pageCount ? `${f.pageCount}p · ` : ""}
                  {formatBytes(f.size)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void removeFile(f.id);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                aria-label="Remove from workspace"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </button>
          ))
        )}
      </div>

      {/* Activity section */}
      <div className="border-t border-border px-4 pt-3 pb-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Activity
        </div>
      </div>

      <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
        {!active ? (
          <div className="px-2 py-4 text-[11px] text-muted-foreground/70">
            Pick a file to see its history.
          </div>
        ) : active.ops.length === 0 ? (
          <div className="px-2 py-4 text-[11px] text-muted-foreground/70">No operations yet.</div>
        ) : (
          <>
            {active.ops
              .slice()
              .reverse()
              .map((op) => (
                <div
                  key={op.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-vault shrink-0" />
                  <span className="truncate flex-1">{op.label}</span>
                  <span className="text-[10px] opacity-60">{formatAge(op.at)}</span>
                </div>
              ))}
            {canUndo && (
              <Button
                onClick={() => void undoLast(active.id)}
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-[11px] h-8"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo last step
              </Button>
            )}
          </>
        )}
      </div>

      {/* Suggestions */}
      {active && suggestions.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Next step
          </div>
          <div className="space-y-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  if (s.pro) {
                    toast("Pro feature — coming with the Legal Suite.", {
                      description: s.reason,
                    });
                    return;
                  }
                  navigate({ to: s.to });
                }}
                className={cn(
                  "w-full text-left rounded-md px-2.5 py-2 text-[11px] transition-colors",
                  s.pro
                    ? "border border-dashed border-vault/40 bg-vault/5 hover:bg-vault/10"
                    : "hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-1.5">
                  {s.pro && <LockIcon className="h-3 w-3 text-vault" />}
                  <span className="font-medium">{s.label}</span>
                  {s.pro && (
                    <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-vault">
                      Pro
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.reason}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Persistence toggle */}
      <div className="border-t border-border px-4 py-3 flex items-center justify-between">
        <div className="text-[11px]">
          <div className="font-medium">Keep across sessions</div>
          <div className="text-[10px] text-muted-foreground">24h, in-browser only</div>
        </div>
        <Switch
          checked={persist}
          onCheckedChange={(v) => void setPersist(v)}
          aria-label="Persistence toggle"
        />
      </div>
    </aside>
  );
}

/** Hydrates the workspace once on app boot. Mount somewhere in the tree. */
export function WorkspaceHydrator() {
  const hydrate = useWorkspace((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return null;
}

/** Re-export Trash2 so the rail can be tree-shaken cleanly. */
export { Trash2 };

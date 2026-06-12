import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabState } from "@/lib/workspace/tabs";

/**
 * Single tab strip below the top bar. One row, scrolls horizontally past
 * the cap. Tabs switch the active document — they never spawn extra
 * rails or panels.
 */
export function TabStrip({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNew,
}: {
  tabs: TabState[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-[34px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-surface-1 px-2"
    >
      {tabs.map((t) => {
        const active = t.id === activeId;
        const label = t.file?.name ?? "Start";
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => onActivate(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate(t.id);
              }
            }}
            title={label}
            className={cn(
              "group flex h-[26px] min-w-[120px] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors",
              active
                ? "border-vault/40 bg-accent-soft text-vault"
                : "border-transparent text-text-2 hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <span className="truncate flex-1">{label}</span>
            {t.isDirty && (
              <span className="text-vault" aria-label="Unsaved changes" title="Unsaved changes">
                •
              </span>
            )}
            {tabs.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                className={cn(
                  "grid h-4 w-4 place-items-center rounded text-text-muted transition-opacity",
                  "hover:bg-surface-3 hover:text-foreground",
                  active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                aria-label={`Close ${label}`}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="ml-1 grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
        title="New tab"
        aria-label="New tab"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

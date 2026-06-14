import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TabState } from "@/lib/workspace/tabs";

/**
 * Document tab strip. Tabs represent OPEN documents only — the Start
 * screen is never a tab. When no document is open, the strip renders
 * nothing and the Start screen fills the canvas. The "+" button opens a
 * fresh Start tab so the user can pick another document; existing tabs
 * stay put.
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
  const docTabs = tabs.filter((t) => t.file !== null);
  if (docTabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Open documents"
      className="flex h-[32px] shrink-0 items-center gap-px overflow-x-auto border-b border-border bg-surface-1 px-2"
    >
      {docTabs.map((t) => {
        const active = t.id === activeId;
        const label = t.file?.name ?? "";
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
              "group relative flex h-[32px] min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 px-3 text-[12px] transition-colors",
              active
                ? "text-vault"
                : "text-text-2 hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <span className="truncate flex-1">{label}</span>
            {t.isDirty && (
              <span className="text-vault" aria-label="Unsaved changes" title="Unsaved changes">
                •
              </span>
            )}
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
            {active && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-vault"
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="ml-1 grid h-[24px] w-[24px] shrink-0 place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-foreground"
        title="New tab"
        aria-label="New tab"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

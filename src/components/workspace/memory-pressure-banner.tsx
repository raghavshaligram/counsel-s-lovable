/**
 * MemoryPressureBanner — soft-amber notice that appears when the global
 * runtime-pressure listener detects a memory/quota exception. Offers a
 * one-click [Refresh Browser] to purge in-RAM caches.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import {
  MEMORY_PRESSURE_CLEAR_EVENT,
  MEMORY_PRESSURE_EVENT,
} from "@/lib/runtime-pressure";

export function MemoryPressureBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onPressure = () => setOpen(true);
    const onClear = () => setOpen(false);
    window.addEventListener(MEMORY_PRESSURE_EVENT, onPressure);
    window.addEventListener(MEMORY_PRESSURE_CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener(MEMORY_PRESSURE_EVENT, onPressure);
      window.removeEventListener(MEMORY_PRESSURE_CLEAR_EVENT, onClear);
    };
  }, []);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b px-4 py-2 text-[13px]"
      style={{
        background: "#FEF3C7",
        borderColor: "#FCD34D",
        color: "#78350F",
      }}
    >
      <AlertTriangle size={16} aria-hidden className="shrink-0" />
      <div className="flex-1 leading-snug">
        <span className="font-semibold">Notice:</span>{" "}
        Document transition data limit reached. If you cannot upload or your
        new PDF fails to open, please refresh to purge local cache memory.
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[#FDE68A]"
        style={{ borderColor: "#D97706", color: "#78350F" }}
      >
        <RefreshCw size={12} aria-hidden />
        Refresh Browser
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss notice"
        className="rounded-md p-1 transition-colors hover:bg-[#FDE68A]"
        style={{ color: "#78350F" }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

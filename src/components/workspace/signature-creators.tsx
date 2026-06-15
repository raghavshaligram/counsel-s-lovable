/**
 * Signature creator widgets — draw / type / upload tabs used inside the
 * Sign & Fill inspector. Themed for the dark inspector but renders the
 * actual signature on a white background (so the resulting PNG looks
 * right when placed on a page). Returns a transparent-ish PNG dataUrl
 * via onSave(dataUrl, aspect).
 *
 * Extracted from the legacy /sign route so the inspector reuses the same
 * input flow without embedding the old page layout.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { toast } from "sonner";
import { ImagePlus, Pencil, Type as TypeIcon, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type Saved = { pngDataUrl: string; aspect: number };

export function SignatureCreator({ onSave }: { onSave: (s: Saved) => void }) {
  const [mode, setMode] = useState<"draw" | "type" | "upload">("draw");
  const [typed, setTyped] = useState("");

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-md border border-border bg-surface-2 p-0.5">
        <ModeBtn icon={<Pencil className="h-3 w-3" />} label="Draw" active={mode === "draw"} onClick={() => setMode("draw")} />
        <ModeBtn icon={<TypeIcon className="h-3 w-3" />} label="Type" active={mode === "type"} onClick={() => setMode("type")} />
        <ModeBtn icon={<Upload className="h-3 w-3" />} label="Upload" active={mode === "upload"} onClick={() => setMode("upload")} />
      </div>

      {mode === "draw" && <DrawPad onSave={onSave} />}
      {mode === "type" && <TypePad value={typed} onChange={setTyped} onSave={onSave} />}
      {mode === "upload" && <UploadPad onSave={onSave} />}
    </div>
  );
}

function ModeBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 inline-flex items-center justify-center gap-1 rounded-[5px] px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-surface-1 text-foreground shadow-[0_1px_0_rgba(0,0,0,0.4)]" : "text-text-2 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/* ---------- Draw ---------- */

function DrawPad({ onSave }: { onSave: (s: Saved) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0d1226";
      ctx.lineWidth = 2.2;
    }
  }, []);

  const pt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const update = (x: number, y: number) => {
    if (!bounds.current) { bounds.current = { minX: x, minY: y, maxX: x, maxY: y }; return; }
    bounds.current.minX = Math.min(bounds.current.minX, x);
    bounds.current.minY = Math.min(bounds.current.minY, y);
    bounds.current.maxX = Math.max(bounds.current.maxX, x);
    bounds.current.maxY = Math.max(bounds.current.maxY, y);
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pt(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(last.current.x + 0.01, last.current.y + 0.01);
    ctx.stroke();
    update(last.current.x, last.current.y);
    setHasInk(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = pt(e);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    update(p.x, p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    bounds.current = null;
    setHasInk(false);
  };

  const save = () => {
    const c = canvasRef.current;
    if (!c || !bounds.current || !hasInk) {
      toast.error("Draw something first");
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pad = 8;
    const minX = Math.max(0, bounds.current.minX - pad);
    const minY = Math.max(0, bounds.current.minY - pad);
    const maxX = Math.min(c.clientWidth, bounds.current.maxX + pad);
    const maxY = Math.min(c.clientHeight, bounds.current.maxY + pad);
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    const off = document.createElement("canvas");
    off.width = Math.round(w * dpr);
    off.height = Math.round(h * dpr);
    const octx = off.getContext("2d");
    if (!octx) return;
    octx.drawImage(c, minX * dpr, minY * dpr, w * dpr, h * dpr, 0, 0, off.width, off.height);
    onSave({ pngDataUrl: off.toDataURL("image/png"), aspect: off.width / off.height });
  };

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="block w-full h-28 rounded-md border border-dashed border-border bg-white touch-none"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={clear} className="flex-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-2 hover:bg-surface-3">
          Clear
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!hasInk}
          className={cn(
            "flex-1 rounded-md bg-vault px-2 py-1 text-[11px] font-medium text-vault-foreground hover:opacity-90",
            !hasInk && "opacity-40 cursor-not-allowed",
          )}
        >
          Use
        </button>
      </div>
    </div>
  );
}

/* ---------- Type ---------- */

function TypePad({ value, onChange, onSave }: { value: string; onChange: (v: string) => void; onSave: (s: Saved) => void }) {
  const render = () => {
    if (!value.trim()) { toast.error("Type your name first"); return; }
    const font = `48px "Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive`;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    measure.font = font;
    const m = measure.measureText(value);
    const w = Math.ceil(m.width) + 24;
    const h = 80;
    const dpr = window.devicePixelRatio || 1;
    const c = document.createElement("canvas");
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.fillStyle = "#0d1226";
    ctx.textBaseline = "middle";
    ctx.fillText(value, 12, h / 2);
    onSave({ pngDataUrl: c.toDataURL("image/png"), aspect: w / h });
  };
  return (
    <div className="space-y-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12px] text-foreground placeholder:text-text-muted focus:outline-none focus:border-vault/50"
      />
      {value && (
        <div
          className="rounded-md border border-dashed border-border bg-white px-3 py-2 text-center text-[#0d1226] truncate"
          style={{ fontFamily: `"Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive`, fontSize: 26 }}
        >
          {value}
        </div>
      )}
      <button
        type="button"
        onClick={render}
        disabled={!value.trim()}
        className={cn(
          "w-full rounded-md bg-vault px-2 py-1 text-[11px] font-medium text-vault-foreground hover:opacity-90",
          !value.trim() && "opacity-40 cursor-not-allowed",
        )}
      >
        Use
      </button>
    </div>
  );
}

/* ---------- Upload ---------- */

function UploadPad({ onSave }: { onSave: (s: Saved) => void }) {
  const handle = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        onSave({ pngDataUrl: c.toDataURL("image/png"), aspect: img.naturalWidth / img.naturalHeight });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  return (
    <label className="block rounded-md border border-dashed border-border bg-surface-2 px-2 py-4 text-center text-[11px] text-text-2 cursor-pointer hover:bg-surface-3 transition">
      <ImagePlus className="h-4 w-4 mx-auto mb-1 text-vault" />
      Choose PNG or JPG
      <input
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}

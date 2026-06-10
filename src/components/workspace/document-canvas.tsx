import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * DocumentCanvas — virtualized PDF viewer with overlay canvas for redactions/markup.
 * D2: render current ±1 page; rest are --whisper placeholder rects.
 * B6.2: pending boxes/handles draw to a single transparent <canvas> overlay,
 *       not DOM nodes (60fps with 200 boxes / 100 pages).
 *
 * This is the layout skeleton. Page rendering hooks plug in via `renderPage`.
 */

export type PageBox = { x: number; y: number; w: number; h: number; kind: "pending" | "committed" };

export function DocumentCanvas({
  pages,
  current,
  onPageInView,
  renderPage,
  boxesForPage,
}: {
  pages: number;
  current: number;
  onPageInView?: (i: number) => void;
  renderPage?: (i: number, target: HTMLCanvasElement) => void | Promise<void>;
  boxesForPage?: (i: number) => PageBox[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);

  // D3: low-res while scrolling; re-render at high after 150ms idle.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: number | undefined;
    const onScroll = () => {
      setScrolling(true);
      clearTimeout(t);
      t = window.setTimeout(() => setScrolling(false), 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      clearTimeout(t);
    };
  }, []);

  return (
    <div ref={scrollRef} className="h-full w-full overflow-auto bg-canvas">
      <ol className="mx-auto flex max-w-[820px] flex-col items-center gap-6 px-6 py-8">
        {Array.from({ length: pages }, (_, i) => (
          <PageSlot
            key={i}
            index={i}
            isNear={Math.abs(i - current) <= 1}
            scrolling={scrolling}
            onInView={onPageInView}
            renderPage={renderPage}
            boxes={boxesForPage?.(i) ?? []}
          />
        ))}
      </ol>
    </div>
  );
}

function PageSlot({
  index,
  isNear,
  scrolling,
  onInView,
  renderPage,
  boxes,
}: {
  index: number;
  isNear: boolean;
  scrolling: boolean;
  onInView?: (i: number) => void;
  renderPage?: (i: number, target: HTMLCanvasElement) => void | Promise<void>;
  boxes: PageBox[];
}) {
  const wrapRef = useRef<HTMLLIElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            onInView?.(index);
          }
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [index, onInView]);

  // Render page when near current and not scrolling
  useEffect(() => {
    if (!isNear || scrolling || !renderPage || !baseRef.current) return;
    void renderPage(index, baseRef.current);
  }, [isNear, scrolling, index, renderPage]);

  // Draw overlay boxes on a single transparent canvas
  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of boxes) {
      if (b.kind === "committed") {
        ctx.fillStyle = "rgba(20,20,28,1)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
      } else {
        // pending: pulsing amber outline (static here; pulse via CSS class on wrapper)
        ctx.strokeStyle = "rgba(245,180,40,0.9)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w, b.h);
        ctx.fillStyle = "rgba(245,180,40,0.12)";
        ctx.fillRect(b.x, b.y, b.w, b.h);
      }
    }
  }, [boxes]);

  return (
    <li
      ref={wrapRef}
      className={cn(
        "relative aspect-[3/4] w-full max-w-[720px] rounded-sm bg-paper text-canvas shadow-stamp",
        !inView && "outline outline-1 outline-whisper bg-transparent text-transparent"
      )}
      style={{
        backgroundImage: !inView
          ? "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)"
          : undefined,
        backgroundSize: !inView ? "16px 16px" : undefined,
      }}
      data-page={index + 1}
    >
      {inView && (
        <>
          <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
          <canvas ref={overlayRef} className="absolute inset-0 h-full w-full pointer-events-none" />
        </>
      )}
      <span className="absolute -bottom-5 right-0 text-[10px] font-mono text-ink/40">{index + 1}</span>
    </li>
  );
}

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Upload, FilePlus2, Clipboard, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { modKey } from "@/lib/use-hotkey";

interface FileDropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  sublabel?: ReactNode;
  className?: string;
}

export function FileDropzone({
  onFile,
  accept = "application/pdf",
  label = "Drop your PDF here",
  sublabel,
  className,
}: FileDropzoneProps) {
  const [drag, setDrag] = useState(false);
  const [pasteHint, setPasteHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLLabelElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  const open = useCallback(() => inputRef.current?.click(), []);

  // Keyboard: Enter / Space / O / Cmd+O to open the picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        open();
      } else if (!e.metaKey && !e.ctrlKey && (e.key === "o" || e.key === "O")) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Paste-from-clipboard support (e.g. file copied in Finder/Explorer)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) {
            setPasteHint(true);
            onFile(f);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile]);

  return (
    <label
      ref={rootRef}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "relative block cursor-pointer border-2 border-dashed rounded-2xl p-10 md:p-14 text-center transition-all outline-none focus-visible:ring-2 focus-visible:ring-vault/50",
        drag
          ? "border-vault bg-vault/10 scale-[1.01]"
          : "border-border hover:border-vault/60 hover:bg-accent/40",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-vault/10 text-vault relative">
        <Upload className={cn("h-6 w-6 transition-transform", drag && "translate-y-[-2px]")} />
        {drag && (
          <span className="absolute inset-0 rounded-2xl border-2 border-vault animate-ping opacity-40" />
        )}
      </div>

      <div className="text-lg font-medium text-foreground">
        {drag ? "Release to load" : label}
      </div>
      <div className="mt-1.5 text-sm text-muted-foreground">
        {sublabel ?? (
          <>
            or <span className="text-vault underline underline-offset-2">click to browse</span> ·
            no size limit
          </>
        )}
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-vault text-vault-foreground px-3 py-1.5 text-xs font-medium">
          <FilePlus2 className="h-3.5 w-3.5" /> Choose file
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          <Clipboard className="h-3 w-3" /> or paste
        </span>
      </div>

      {/* Persistent privacy primer — visible BEFORE the user commits a file,
          on every dropzone in the app. Reflects a true property of the app
          (zero network egress) and is consistent across screens. */}
      <div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-vault/25 bg-accent-soft px-3 py-1 text-[11px] font-medium text-vault">
        <Lock className="h-3 w-3" strokeWidth={2.5} />
        On your device · Nothing uploaded
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
        <Kbd>O</Kbd> open file · <Kbd>{modKey()}</Kbd> <Kbd>V</Kbd> paste
        {pasteHint && <span className="ml-2 text-vault normal-case tracking-normal">· pasted!</span>}
      </div>
    </label>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.4em] px-1 py-0.5 rounded border border-border bg-background/70 text-[10px] font-mono text-foreground/80 mx-0.5">
      {children}
    </kbd>
  );
}

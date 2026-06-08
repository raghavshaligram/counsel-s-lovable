import { useCallback, useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  return (
    <label
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
        "block cursor-pointer border-2 border-dashed rounded-xl p-12 text-center transition-colors",
        drag
          ? "border-vault bg-vault/5"
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
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-vault/10 text-vault">
        <Upload className="h-5 w-5" />
      </div>
      <div className="text-base font-medium text-foreground">{label}</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {sublabel ?? (
          <>
            or <span className="text-vault underline underline-offset-2">click to browse</span> ·
            no size limit · processed locally
          </>
        )}
      </div>
    </label>
  );
}

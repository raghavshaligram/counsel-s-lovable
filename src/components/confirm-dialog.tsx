import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Branded, in-app replacement for window.confirm(). Imperative API
 * (`confirmDialog(opts)`) avoids the browser's native dialog — which
 * leaks the deployment URL — and keeps every confirmation on-brand.
 */
export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  body?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** "danger" = destructive primary; "default" = standard primary. */
  tone?: "default" | "danger";
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

let setPendingExternal: ((p: Pending | null) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (!setPendingExternal) {
    // Host not mounted (SSR / very early). Fall back to native confirm
    // so callers never hang. Should not happen in normal app flow.
    if (typeof window !== "undefined") {
      return Promise.resolve(window.confirm(opts.title));
    }
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    setPendingExternal!({ ...opts, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    setPendingExternal = setPending;
    return () => {
      setPendingExternal = null;
    };
  }, []);

  const open = pending !== null;
  const handle = (v: boolean) => {
    pending?.resolve(v);
    setPending(null);
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handle(false);
      }}
    >
      <AlertDialogContent className="border-border/60 bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">
            {pending?.title}
          </AlertDialogTitle>
          {pending?.description ? (
            <AlertDialogDescription className="text-muted-foreground">
              {pending.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {pending?.body ? (
          <div className="text-sm text-muted-foreground">{pending.body}</div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => handle(false)}>
            {pending?.cancelText ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => handle(true)}
            className={cn(
              pending?.tone === "danger" &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {pending?.confirmText ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

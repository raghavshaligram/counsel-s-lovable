/**
 * Help / Feature-request modal. Opened from the chips above the command
 * bar. Best-effort submit: DB failure still shows the confirmation and
 * closes the modal cleanly — the user is never trapped.
 */
import { useEffect, useRef, useState } from "react";
import { X, LifeBuoy, Lightbulb, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { submitSupportRequest, type HelpCategory } from "@/lib/support.functions";

export type SupportMode = "help" | "feature";

const HELP_CATEGORY_OPTIONS: Array<{ value: HelpCategory; label: string }> = [
  { value: "billing", label: "Billing & subscription" },
  { value: "bug", label: "Something's broken" },
  { value: "account", label: "Account & sign-in" },
  { value: "how-to", label: "How do I…?" },
  { value: "performance", label: "Slow / stuck" },
  { value: "other", label: "Other" },
];

interface Props {
  open: boolean;
  mode: SupportMode;
  defaultName?: string;
  defaultEmail?: string;
  signedIn: boolean;
  onClose: () => void;
}

export function SupportModal({ open, mode, defaultName, defaultEmail, signedIn, onClose }: Props) {
  const submit = useServerFn(submitSupportRequest);
  const [name, setName] = useState(defaultName ?? "");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [category, setCategory] = useState<HelpCategory>("how-to");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const firstRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName ?? "");
    setEmail(defaultEmail ?? "");
    setTitle("");
    setMessage("");
    setBusy(false);
    setDone(false);
    setTimeout(() => firstRef.current?.focus(), 30);
  }, [open, mode, defaultName, defaultEmail]);

  if (!open) return null;

  const isHelp = mode === "help";
  const icon = isHelp ? (
    <LifeBuoy className="h-4 w-4 text-vault" />
  ) : (
    <Lightbulb className="h-4 w-4 text-vault" />
  );
  const heading = isHelp ? "Need help?" : "Request a feature";
  const subheading = isHelp
    ? "Tell us what's stuck — we'll get back to you at the email above."
    : "Describe what you'd like CounselPDF to do. Short and specific works best.";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (message.trim().length < 10) {
      toast.error("Add at least a sentence describing it");
      return;
    }
    if (!signedIn && !email.trim()) {
      toast.error("Email is required so we can reply");
      return;
    }
    setBusy(true);
    try {
      await submit({
        data: {
          type: mode,
          title: title.trim(),
          message: message.trim(),
          name: name.trim(),
          email: email.trim(),
          page: typeof window !== "undefined" ? window.location.pathname + window.location.search : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : "",
        },
      });
      setDone(true);
    } catch (err) {
      // Server always returns ok:true unless the network died. Show the
      // confirmation anyway so the modal never gets stuck.
      console.warn("[support] submit failed (showing confirmation anyway)", err);
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-vault/15">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-foreground">{heading}</div>
            <div className="text-[11.5px] text-text-muted">{subheading}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <div className="text-[13px] font-medium text-foreground">Thanks — we've got it</div>
            <div className="max-w-xs text-[11.5px] text-text-muted">
              We'll follow up{email ? ` at ${email}` : ""}. You can close this dialog.
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[12px] text-foreground hover:bg-surface-2/70"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-text-muted">
                Name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  readOnly={signedIn && !!defaultName}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12.5px] text-foreground focus:border-vault focus:outline-none"
                />
              </label>
              <label className="text-[11px] text-text-muted">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  readOnly={signedIn && !!defaultEmail}
                  required
                  className="mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12.5px] text-foreground focus:border-vault focus:outline-none"
                />
              </label>
            </div>

            {!isHelp && (
              <label className="text-[11px] text-text-muted">
                Title
                <input
                  ref={(el) => {
                    if (!isHelp) firstRef.current = el;
                  }}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="Short summary of the feature"
                  className="mt-1 h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[12.5px] text-foreground placeholder:text-text-muted/60 focus:border-vault focus:outline-none"
                />
              </label>
            )}

            <label className="text-[11px] text-text-muted">
              {isHelp ? "What's happening?" : "Describe the feature"}
              <textarea
                ref={(el) => {
                  if (isHelp) firstRef.current = el;
                }}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                minLength={10}
                maxLength={2000}
                rows={5}
                placeholder={
                  isHelp
                    ? "Steps you took, what you expected, what happened…"
                    : "What should it do, when should it appear, who is it for…"
                }
                className="mt-1 w-full resize-y rounded-md border border-border bg-surface-2 px-2 py-1.5 text-[12.5px] text-foreground placeholder:text-text-muted/60 focus:border-vault focus:outline-none"
              />
              <div className="mt-1 text-right text-[10.5px] text-text-muted">
                {message.length}/2000
              </div>
            </label>

            <div className="mt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border bg-transparent px-3 py-1.5 text-[12px] text-text-2 hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-vault px-3 py-1.5 text-[12px] font-medium text-white hover:bg-vault/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                {isHelp ? "Send" : "Send request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

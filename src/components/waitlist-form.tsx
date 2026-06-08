// Reusable waitlist / email-capture form backed by the public.waitlist table.
// Inserts via the anon Supabase client — RLS allows INSERT only, list is
// readable only via service_role from the backend.

import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email required")
    .max(255, "Too long")
    .email("Enter a valid email"),
});

export interface WaitlistFormProps {
  source: string; // e.g. "home" or "pricing"
  className?: string;
  placeholder?: string;
  ctaLabel?: string;
  description?: string;
  variant?: "stacked" | "inline";
}

export function WaitlistForm({
  source,
  className,
  placeholder = "you@company.com",
  ctaLabel = "Join the waitlist",
  description,
  variant = "inline",
}: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid email");
      return;
    }
    setLoading(true);
    try {
      const referrer =
        typeof document !== "undefined" ? document.referrer.slice(0, 512) : null;
      const userAgent =
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 512) : null;
      const { error } = await supabase.from("waitlist").insert({
        email: parsed.data.email,
        source: source.slice(0, 64),
        referrer,
        user_agent: userAgent,
      });
      if (error) {
        // Unique violation = already signed up. Treat as success.
        if (error.code === "23505") {
          setDone(true);
          toast.success("You're already on the list — thanks!");
          return;
        }
        throw error;
      }
      setDone(true);
      toast.success("You're on the list. We'll be in touch.");
    } catch (err) {
      toast.error("Couldn't sign you up", {
        description: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm",
          className,
        )}
      >
        <CheckCircle2 className="h-4 w-4 text-vault" />
        <span>You're on the list. We'll email you when there's news.</span>
      </div>
    );
  }

  if (variant === "stacked") {
    return (
      <form onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={255}
          placeholder={placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          aria-label="Email address"
          className="h-11"
        />
        <Button
          type="submit"
          disabled={loading}
          className="h-11 bg-vault text-vault-foreground hover:opacity-90"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : ctaLabel}
        </Button>
      </form>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col sm:flex-row gap-2 w-full", className)}
    >
      <Input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        maxLength={255}
        placeholder={placeholder}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
        aria-label="Email address"
        className="h-11 flex-1"
      />
      <Button
        type="submit"
        disabled={loading}
        className="h-11 bg-vault text-vault-foreground hover:opacity-90 px-5"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {ctaLabel}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </>
        )}
      </Button>
    </form>
  );
}

import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * In-app toast surface. Calm, professional, legal aesthetic.
 * Uses design tokens only — never browser-chrome notifications.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        unstyled: false,
        classNames: {
          toast:
            "group toast pointer-events-auto flex w-full items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-xl backdrop-blur-sm " +
            "group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border " +
            "font-sans",
          title: "text-foreground font-medium tracking-tight",
          description: "group-[.toast]:text-muted-foreground text-[13px] leading-relaxed",
          actionButton:
            "group-[.toast]:bg-vault group-[.toast]:text-vault-foreground group-[.toast]:rounded-sm group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-xs group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:bg-transparent group-[.toast]:text-muted-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:rounded-sm group-[.toast]:px-2.5 group-[.toast]:py-1 group-[.toast]:text-xs",
          closeButton:
            "group-[.toast]:bg-background group-[.toast]:border-border group-[.toast]:text-muted-foreground hover:group-[.toast]:text-foreground",
          success:
            "group-[.toaster]:border-vault/40 group-[.toaster]:[&_[data-icon]]:text-vault",
          error:
            "group-[.toaster]:border-destructive/50 group-[.toaster]:[&_[data-icon]]:text-destructive",
          info: "group-[.toaster]:border-border",
          warning:
            "group-[.toaster]:border-amber-500/40 group-[.toaster]:[&_[data-icon]]:text-amber-400",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

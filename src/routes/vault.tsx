import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Lock, KeyRound, ShieldCheck, Cpu, Network, Terminal } from "lucide-react";
import { detectResources } from "@/lib/workers/resources";
import { vaultStatus } from "@/lib/vault/store";
import { UnlockDialog } from "@/components/vault/unlock-dialog";
import { ProvidersDialog } from "@/components/vault/providers-dialog";
import { toast } from "sonner";
import { NetworkLogDialog } from "@/components/vault/network-log-dialog";

export const Route = createFileRoute("/vault")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Vault — VaultPDF" },
      { name: "description", content: "Manage your encryption key, AI providers, signing key, document cache, and network log." },
    ],
  }),
  component: VaultPage,
});

function VaultPage() {
  const [status, setStatus] = useState<{ unlocked: boolean; hasSigningKey: boolean } | null>(null);
  const [resources, setResources] = useState<ReturnType<typeof detectResources> | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [netLogOpen, setNetLogOpen] = useState(false);

  const refresh = () => { void vaultStatus().then(setStatus); };

  useEffect(() => {
    refresh();
    setResources(detectResources());
  }, []);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <header className="mb-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-vault">Vault</div>
          <h1 className="font-display text-4xl mt-1">Your keys. Your machine.</h1>
          <p className="mt-2 text-sm text-ink/60 max-w-prose">
            Nothing here is synced. Every key, cache entry, and pipeline below lives on this device only.
          </p>
        </header>

        <div className="space-y-3">
          <Card
            icon={<Lock className="h-4 w-4" />}
            title="Unlock"
            body={status?.unlocked ? "Vault unlocked." : "Vault is locked. Passkey-first, passphrase fallback."}
            action={status?.unlocked ? "Locked" : "Unlock"}
            onAction={() => setUnlockOpen(true)}
          />
          <Card icon={<KeyRound className="h-4 w-4" />} title="AI Providers" body="BYOK: OpenAI · Anthropic · Google · Ollama · OpenAI-compatible. Keys stored on this device." action="Manage" onAction={() => setProvidersOpen(true)} />
          <Card
            icon={<ShieldCheck className="h-4 w-4" />}
            title="Signing Key"
            body={status?.hasSigningKey ? "Ed25519 key active. Embedded in every certificate." : "Auto-generated on first unlock."}
            action="View public key"
            onAction={() => {
              if (!status?.unlocked) return toast.error("Unlock the vault first to view your signing key.");
              toast.info("Signing key viewer ships in Phase 4.");
            }}
          />
          <Card
            icon={<Cpu className="h-4 w-4" />}
            title="Document Cache"
            body={`Encrypted IndexedDB. Mode: ${resources?.tier ?? "—"} (${resources?.memory ?? "?"} GB / ${resources?.cores ?? "?"} cores).`}
            action="Clear cache"
            onAction={async () => {
              if (typeof indexedDB === "undefined") return;
              const dbs = await indexedDB.databases?.();
              await Promise.all((dbs ?? []).map(d => d.name ? new Promise<void>((res) => {
                const req = indexedDB.deleteDatabase(d.name!);
                req.onsuccess = req.onerror = req.onblocked = () => res();
              }) : Promise.resolve()));
              toast.success("Document cache cleared.");
            }}
          />
          <Card
            icon={<Network className="h-4 w-4" />}
            title="Network Log"
            body="Every outbound request to an AI provider, with hash + timestamp. Transparent by default."
            action="Open log"
            onAction={() => toast.info("Network log viewer ships in Phase 4.")}
          />
          <Card
            icon={<Terminal className="h-4 w-4" />}
            title="CSP Templates"
            body="Copy-paste CSP + reverse-proxy snippets for self-hosted Ollama or custom endpoints."
            action="Copy CSP"
            onAction={async () => {
              const csp = `default-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com http://localhost:11434; worker-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;`;
              try {
                await navigator.clipboard.writeText(csp);
                toast.success("CSP snippet copied to clipboard.");
              } catch {
                toast.error("Couldn't access clipboard.");
              }
            }}
          />
        </div>
      </main>
      <UnlockDialog open={unlockOpen} onOpenChange={setUnlockOpen} onUnlocked={refresh} />
      <ProvidersDialog open={providersOpen} onOpenChange={setProvidersOpen} />
    </AppShell>
  );
}

function Card({ icon, title, body, action, onAction }: { icon: React.ReactNode; title: string; body: string; action: string; onAction?: () => void }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-whisper bg-card/50 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-vault/15 text-vault">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="text-[13px] text-ink/60 mt-0.5 leading-snug">{body}</p>
      </div>
      <button onClick={onAction} className="rounded-md border border-whisper px-3 py-1.5 text-[12px] text-ink/80 hover:bg-whisper">
        {action}
      </button>
    </div>
  );
}

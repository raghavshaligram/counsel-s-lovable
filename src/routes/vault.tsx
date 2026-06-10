import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Lock, KeyRound, ShieldCheck, Cpu, Network, Terminal } from "lucide-react";
import { detectResources } from "@/lib/workers/resources";
import { vaultStatus } from "@/lib/vault/store";
import { UnlockDialog } from "@/components/vault/unlock-dialog";

export const Route = createFileRoute("/vault")({
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

  useEffect(() => {
    void vaultStatus().then(setStatus);
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
          <Card icon={<Lock className="h-4 w-4" />} title="Unlock" body={status?.unlocked ? "Vault unlocked." : "Vault is locked. Passkey-first, passphrase fallback."} action="Set up" />
          <Card icon={<KeyRound className="h-4 w-4" />} title="AI Providers" body="BYOK: OpenAI · Anthropic · Google · Ollama · OpenAI-compatible. Keys stored encrypted." action="Add provider" />
          <Card icon={<ShieldCheck className="h-4 w-4" />} title="Signing Key" body={status?.hasSigningKey ? "Ed25519 key active. Embedded in every certificate." : "Auto-generated on first unlock."} action="View public key" />
          <Card icon={<Cpu className="h-4 w-4" />} title="Document Cache" body={`Encrypted IndexedDB. Mode: ${resources?.tier ?? "—"} (${resources?.memory ?? "?"} GB / ${resources?.cores ?? "?"} cores).`} action="Clear cache" />
          <Card icon={<Network className="h-4 w-4" />} title="Network Log" body="Every outbound request to an AI provider, with hash + timestamp. Transparent by default." action="Open log" />
          <Card icon={<Terminal className="h-4 w-4" />} title="CSP Templates" body="Copy-paste CSP + reverse-proxy snippets for self-hosted Ollama or custom endpoints." action="Show snippets" />
        </div>
      </main>
    </AppShell>
  );
}

function Card({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action: string }) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-whisper bg-card/50 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-vault/15 text-vault">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">{title}</div>
        <p className="text-[13px] text-ink/60 mt-0.5 leading-snug">{body}</p>
      </div>
      <button className="rounded-md border border-whisper px-3 py-1.5 text-[12px] text-ink/80 hover:bg-whisper">
        {action}
      </button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { upsertProvider, loadProviders, removeProvider, setSelectedProvider, selectedProvider, type ProviderConfig } from "@/lib/ai/keys";
import type { ProviderId } from "@/lib/ai/types";
import { ADAPTERS } from "@/lib/ai/registry";
import { probeOllama } from "@/lib/ai/providers/ollama";
import { Trash2 } from "lucide-react";

const PROVIDER_OPTS: { id: ProviderId; label: string; needsKey: boolean }[] = [
  { id: "openai", label: "OpenAI", needsKey: true },
  { id: "anthropic", label: "Anthropic", needsKey: true },
  { id: "google", label: "Google (Gemini)", needsKey: true },
  { id: "ollama", label: "Ollama (local)", needsKey: false },
  { id: "openai-compatible", label: "OpenAI-compatible", needsKey: true },
];

export function ProvidersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [list, setList] = useState<ProviderConfig[]>([]);
  const [selected, setSelected] = useState<ProviderId | null>(null);
  const [draftId, setDraftId] = useState<ProviderId>("openai");
  const [draftKey, setDraftKey] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftModel, setDraftModel] = useState(ADAPTERS.openai.defaultModels[0].id);
  const [ollamaProbed, setOllamaProbed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setList(loadProviders());
    setSelected(selectedProvider());
    void probeOllama().then(setOllamaProbed);
  }, [open]);

  function refresh() {
    setList(loadProviders());
    setSelected(selectedProvider());
  }

  function add() {
    const cfg: ProviderConfig = {
      id: draftId,
      enabled: true,
      apiKey: draftKey.trim(),
      baseUrl: draftUrl.trim() || undefined,
      model: draftModel,
    };
    upsertProvider(cfg);
    if (!selected) setSelectedProvider(draftId);
    setDraftKey("");
    refresh();
  }

  const adapter = ADAPTERS[draftId];
  useEffect(() => {
    setDraftModel(ADAPTERS[draftId].defaultModels[0].id);
  }, [draftId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">AI Providers</DialogTitle>
          <DialogDescription>
            BYOK. Keys are stored on this device. Requests go browser-direct — nothing is proxied.
          </DialogDescription>
        </DialogHeader>

        {ollamaProbed && (
          <div className="rounded-md border border-vault/40 bg-vault/10 px-3 py-2 text-[12px] text-ink/80">
            Detected Ollama on localhost:11434 — add it below to use local models.
          </div>
        )}

        <div className="space-y-2">
          {list.length === 0 && (
            <p className="text-sm text-ink/50">No providers yet. Add one below.</p>
          )}
          {list.map((p) => (
            <label key={p.id} className="flex items-center gap-3 rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm">
              <input
                type="radio"
                name="active-provider"
                checked={selected === p.id}
                onChange={() => { setSelectedProvider(p.id); refresh(); }}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-ink">{ADAPTERS[p.id].label}</div>
                <div className="text-[11px] font-mono text-ink/50 truncate">{p.model} · {p.apiKey ? "key set" : "no key"}{p.baseUrl ? ` · ${p.baseUrl}` : ""}</div>
              </div>
              <button onClick={() => { removeProvider(p.id); refresh(); }} className="text-ink/40 hover:text-evidence">
                <Trash2 className="h-4 w-4" />
              </button>
            </label>
          ))}
        </div>

        <div className="space-y-2 border-t border-whisper pt-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-ink/50">Add provider</div>
          <select
            value={draftId}
            onChange={(e) => setDraftId(e.target.value as ProviderId)}
            className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm"
          >
            {PROVIDER_OPTS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm font-mono"
          >
            {adapter.defaultModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          {(draftId === "ollama" || draftId === "openai-compatible") && (
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder={draftId === "ollama" ? "http://localhost:11434" : "https://api.example.com"}
              className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm font-mono"
            />
          )}
          {draftId !== "ollama" && (
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="API key (sk-…)"
              className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm font-mono"
            />
          )}
          <button
            onClick={add}
            disabled={draftId !== "ollama" && !draftKey.trim()}
            className="w-full rounded-md bg-vault px-4 py-2 text-sm font-medium text-vault-foreground disabled:opacity-40"
          >
            Save provider
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

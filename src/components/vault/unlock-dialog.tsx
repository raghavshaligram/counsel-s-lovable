import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Fingerprint, KeyRound } from "lucide-react";
import { enrollPasskey, unlockWithPasskey } from "@/lib/vault/passkey";
import { unlockWithPasskey as unlockKeyInWorker, unlockWithPassphrase } from "@/lib/vault/store";
import { serializeUnlock } from "@/lib/vault/tabs";
import { setVaultHandle } from "@/lib/workspace/doc";

type Mode = "choose" | "passphrase" | "enroll-prf-missing";

const STORAGE_KEY = "vaultpdf.passkey";

type StoredPasskey = { credentialIdB64: string; saltB64: string };

function getStored(): StoredPasskey | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}
function setStored(v: StoredPasskey) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}
function b64(buf: ArrayBuffer | Uint8Array) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

export function UnlockDialog({ open, onOpenChange, onUnlocked }: { open: boolean; onOpenChange: (v: boolean) => void; onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stored = getStored();

  async function runPasskey() {
    setBusy(true);
    setErr(null);
    try {
      await serializeUnlock(async () => {
        if (stored) {
          const credId = fromB64(stored.credentialIdB64);
          const salt = fromB64(stored.saltB64);
          const prf = await unlockWithPasskey(credId.buffer as ArrayBuffer, salt);
          if (!prf) {
            setMode("enroll-prf-missing");
            return;
          }
          const handle = await unlockKeyInWorker(prf);
          setVaultHandle(handle);
        } else {
          const userId = crypto.getRandomValues(new Uint8Array(16));
          const res = await enrollPasskey(userId, "vaultpdf-user");
          if (res.kind === "unsupported") {
            setMode("passphrase");
            return;
          }
          if (res.kind === "no-prf") {
            setMode("enroll-prf-missing");
            return;
          }
          // Need to actually unlock with PRF too — call get with same salt
          const prf = await unlockWithPasskey(res.credentialId, res.salt);
          if (!prf) {
            setMode("enroll-prf-missing");
            return;
          }
          setStored({ credentialIdB64: b64(res.credentialId), saltB64: b64(res.salt) });
          const handle = await unlockKeyInWorker(prf);
          setVaultHandle(handle);
        }
      });
      onUnlocked();
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPassphrase() {
    if (passphrase.length < 12) {
      setErr("Use 12+ characters for the fallback passphrase.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const saltKey = "vaultpdf.passphrase.salt";
      let saltB64 = localStorage.getItem(saltKey);
      let salt: Uint8Array;
      if (saltB64) {
        salt = fromB64(saltB64);
      } else {
        salt = crypto.getRandomValues(new Uint8Array(16));
        localStorage.setItem(saltKey, b64(salt));
      }
      const handle = await unlockWithPassphrase(passphrase, salt);
      setVaultHandle(handle);
      onUnlocked();
      onOpenChange(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Unlock the vault</DialogTitle>
          <DialogDescription>
            Your keys, documents, and history are encrypted on this device. Nothing is synced.
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" && (
          <div className="space-y-2">
            <button
              disabled={busy}
              onClick={runPasskey}
              className="flex w-full items-center gap-3 rounded-md border border-vault/40 bg-vault/10 px-4 py-3 text-left hover:bg-vault/15 disabled:opacity-50"
            >
              <Fingerprint className="h-5 w-5 text-vault" />
              <div>
                <div className="text-sm font-medium text-ink">{stored ? "Unlock with passkey" : "Set up passkey"}</div>
                <div className="text-[12px] text-ink/60">Touch ID, Windows Hello, YubiKey</div>
              </div>
            </button>
            <button
              disabled={busy}
              onClick={() => setMode("passphrase")}
              className="flex w-full items-center gap-3 rounded-md border border-whisper bg-background/60 px-4 py-3 text-left hover:bg-whisper disabled:opacity-50"
            >
              <KeyRound className="h-5 w-5 text-ink/70" />
              <div>
                <div className="text-sm font-medium text-ink">Use passphrase</div>
                <div className="text-[12px] text-ink/60">Fallback if biometrics aren't available</div>
              </div>
            </button>
          </div>
        )}

        {mode === "enroll-prf-missing" && (
          <div className="space-y-3 text-sm">
            <p className="text-ink/70">
              This device's passkey doesn't support deterministic key derivation (WebAuthn PRF).
              We can't bind your vault to it. Use the passphrase fallback instead — same vault, equally secure.
            </p>
            <button onClick={() => setMode("passphrase")} className="w-full rounded-md bg-vault px-4 py-2 text-sm font-medium text-vault-foreground">
              Switch to passphrase
            </button>
          </div>
        )}

        {mode === "passphrase" && (
          <div className="space-y-3">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="12+ characters"
              className="w-full rounded-md border border-whisper bg-background/60 px-3 py-2 text-sm"
              autoFocus
            />
            <button
              disabled={busy}
              onClick={runPassphrase}
              className="w-full rounded-md bg-vault px-4 py-2 text-sm font-medium text-vault-foreground disabled:opacity-50"
            >
              {busy ? "Unlocking…" : "Unlock"}
            </button>
            <button onClick={() => setMode("choose")} className="w-full text-[12px] text-ink/50 hover:text-ink">
              Back
            </button>
          </div>
        )}

        {err && <p className="text-[12px] text-evidence">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}

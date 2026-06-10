/**
 * A0.1 PRF probe — check whether the platform/authenticator supports
 * WebAuthn PRF extension before treating passkey unlock as primary.
 *
 * Returns:
 *   - 'prf' if a credential was created and PRF output was returned.
 *   - 'no-prf' if creation succeeded but PRF was absent (must use passphrase).
 *   - 'unsupported' if WebAuthn itself isn't available.
 */

export type EnrollResult =
  | { kind: "prf"; credentialId: ArrayBuffer; salt: Uint8Array }
  | { kind: "no-prf"; credentialId: ArrayBuffer }
  | { kind: "unsupported" };

export async function enrollPasskey(userId: Uint8Array, userName: string): Promise<EnrollResult> {
  if (typeof PublicKeyCredential === "undefined") return { kind: "unsupported" };
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "VaultPDF" },
      user: { id: userId, name: userName, displayName: userName },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) return { kind: "unsupported" };
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  if (ext.prf?.results?.first) {
    return { kind: "prf", credentialId: cred.rawId, salt };
  }
  return { kind: "no-prf", credentialId: cred.rawId };
}

export async function unlockWithPasskey(credentialId: ArrayBuffer, salt: Uint8Array): Promise<ArrayBuffer | null> {
  if (typeof PublicKeyCredential === "undefined") return null;
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) return null;
  const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
  return ext.prf?.results?.first ?? null;
}

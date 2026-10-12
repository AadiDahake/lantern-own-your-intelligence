/**
 * Encryption for the GitHub access token stored on the project row, and the signature on the
 * OAuth state cookie.
 *
 * Both keys are derived from the service role key, which is already a server-only secret this app
 * cannot run without. That keeps the number of secrets to manage at one, and a leaked database
 * dump on its own still yields no usable GitHub token. The format is in `lib/seal.ts`.
 */
import { randomBytes } from "node:crypto";
import { keyedDigest, seal, unseal } from "@/lib/seal";

/** `iv.ciphertext.tag`, all base64url. */
export function encryptToken(plain: string): string {
  return seal("github-token", plain);
}

/** Returns null for anything that does not decrypt cleanly, so a stale row just reads as unlinked. */
export function decryptToken(stored: string): string | null {
  return unseal("github-token", stored);
}

/** `<nonce>.<hmac>`, the value of the OAuth state cookie and of the `state` query parameter. */
export function issueState(): string {
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}.${signState(nonce)}`;
}

/** Constant-time-ish check that a returned state is one this server issued. */
export function verifyState(state: string): boolean {
  const [nonce, signature] = state.split(".");
  if (!nonce || !signature) return false;
  const expected = signState(nonce);
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0;
}

function signState(nonce: string): string {
  return keyedDigest("github-state", nonce);
}

/**
 * Encryption for the GitHub access token stored on the project row, and the signature on the
 * OAuth state cookie.
 *
 * Both keys are derived from the service role key, which is already a server-only secret this app
 * cannot run without. That keeps the number of secrets to manage at one, and a leaked database
 * dump on its own still yields no usable GitHub token.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { supabaseServiceRoleKey } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function key(purpose: string): Buffer {
  return scryptSync(supabaseServiceRoleKey(), `lantern:${purpose}`, 32);
}

/** `iv.ciphertext.tag`, all base64url. */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key("github-token"), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".");
}

/** Returns null for anything that does not decrypt cleanly, so a stale row just reads as unlinked. */
export function decryptToken(stored: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, body, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv(ALGORITHM, key("github-token"), iv as Buffer);
    decipher.setAuthTag(tag as Buffer);
    return Buffer.concat([decipher.update(body as Buffer), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
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
  return createHmac("sha256", key("github-state")).update(nonce).digest("base64url");
}

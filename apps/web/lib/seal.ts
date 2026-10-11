/**
 * Values that are stored encrypted: the GitHub token on the project row and the phone number of a
 * person who asked for a text.
 *
 * Every key is derived from the service role key, which is already a server-only secret this app
 * cannot run without. That keeps the number of secrets to manage at one, and a leaked database
 * dump on its own still yields no usable token and no phone number. Each kind of value has its own
 * purpose string, so a value sealed for one purpose does not open under another.
 *
 * The worker reads the same format (`services/worker/steps/github_token.py`), so the two must stay
 * in step: AES-256-GCM, the key is scrypt(service role key, "lantern:<purpose>", 32) with Node's
 * defaults, and the stored value is `iv.ciphertext.tag`, each part base64url without padding.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { supabaseServiceRoleKey } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

/** The derived keys, one for each purpose. `from` is the secret a key was derived from. */
const derived = new Map<string, { from: string; key: Buffer }>();

/**
 * scrypt is slow on purpose (about 25 ms), and it runs on the event loop. A list of sealed values
 * is opened in one loop, so the key is derived one time for each purpose and kept. A changed
 * service role key gives a new key on the next call.
 */
function key(purpose: string): Buffer {
  const secret = supabaseServiceRoleKey();
  const kept = derived.get(purpose);
  if (kept && kept.from === secret) return kept.key;
  const fresh = scryptSync(secret, `lantern:${purpose}`, 32);
  derived.set(purpose, { from: secret, key: fresh });
  return fresh;
}

/** `iv.ciphertext.tag`, all base64url. */
export function seal(purpose: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((part) => part.toString("base64url")).join(".");
}

/** Returns null for anything that does not decrypt cleanly, so a stale row reads as empty. */
export function unseal(purpose: string, stored: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, body, tag] = parts.map((part) => Buffer.from(part, "base64url"));
    const decipher = createDecipheriv(ALGORITHM, key(purpose), iv as Buffer);
    decipher.setAuthTag(tag as Buffer);
    return Buffer.concat([decipher.update(body as Buffer), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * A keyed hash of a value, base64url. The same value gives the same digest, so it can sign a
 * nonce and it can find a row by a value that is not stored in the clear.
 */
export function keyedDigest(purpose: string, value: string): string {
  return createHmac("sha256", key(purpose)).update(value).digest("base64url");
}

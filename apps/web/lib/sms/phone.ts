/**
 * The phone number of a person who asked for a text, as it is stored.
 *
 * The number is sealed with its own purpose string (`lib/seal.ts`), so nothing that can read the
 * GitHub token's ciphertext can read a phone number with the same call. Only a module that is
 * about to send a text opens a number, and it never logs what it opened.
 */
import { keyedDigest, seal, unseal } from "@/lib/seal";

const PURPOSE = "subscriber-phone";

/** A different purpose, so the digest key is not the key that opens a number. */
const DIGEST_PURPOSE = "subscriber-phone-digest";

/** The value of `gap_subscriber.phone_sealed` for an E.164 number. */
export function sealPhone(e164: string): string {
  return seal(PURPOSE, e164);
}

/** The number, or null when the stored value does not open (a changed service role key). */
export function openPhone(stored: string): string | null {
  return unseal(PURPOSE, stored);
}

/**
 * The value of `gap_subscriber.phone_digest` for an E.164 number: the same number gives the same
 * digest, so one number is one row for one gap, and a person's rows can be found when they ask to
 * stop. The digest cannot be turned back into the number without the service role key.
 */
export function phoneDigest(e164: string): string {
  return keyedDigest(DIGEST_PURPOSE, e164);
}

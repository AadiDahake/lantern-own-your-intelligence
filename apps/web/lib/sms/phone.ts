/**
 * The phone number of a person who asked for a text, as it is stored.
 *
 * The number is sealed with its own purpose string (`lib/seal.ts`), so nothing that can read the
 * GitHub token's ciphertext can read a phone number with the same call. Only a module that is
 * about to send a text opens a number, and it never logs what it opened.
 */
import { seal, unseal } from "@/lib/seal";

const PURPOSE = "subscriber-phone";

/** The value of `gap_subscriber.phone_sealed` for an E.164 number. */
export function sealPhone(e164: string): string {
  return seal(PURPOSE, e164);
}

/** The number, or null when the stored value does not open (a changed service role key). */
export function openPhone(stored: string): string | null {
  return unseal(PURPOSE, stored);
}

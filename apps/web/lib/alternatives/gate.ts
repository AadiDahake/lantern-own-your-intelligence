/**
 * What may be asked of the agent search, and what a visitor may be offered from its answer.
 *
 * An offer points a person at a service that nobody at the company has tried, under the company's
 * name. A wrong one costs the person more time than no offer, and the index itself is no filter:
 * it answers a query of nonsense words with a full page of listings. So each rule here is strict,
 * and a listing must pass all of them:
 *
 * - It is named for the capability, word for word (`sameName`). Words that only look alike are
 *   not enough: "Export customer contacts" has each noun of "importing customer contacts", and
 *   "Book a flight" has each noun of "canceling a flight booking". The product's own rule for a
 *   control (`coversCapability`) lets one concept differ and joins synonyms, which is right for
 *   the labels of one product and wrong for the names of every tool there is.
 * - The index says that work can start now, that it needs no payment, and that it has verified
 *   who the service is. The page of a listing that is not ready tells a person that it cannot
 *   start, which is a dead end.
 * - Its name and the name of its service can stand under a company's name: plain characters, no
 *   address, no phone number, a few words. A description is never shown.
 * - One listing for one service, in the index's own order, and a small number in total.
 *
 * The query has the same strictness in the other direction (`queryFor`): the whole capability
 * name leaves the product, or nothing does.
 */
import { AGENT_SEARCH, stem } from "@lantern/shared";
import type { Alternative } from "@lantern/shared";
import type { AgentListing } from "../darwin";

/** The fewest words a capability name needs. One word is the name of a wall of listings. */
const MIN_WORDS = 2;

/** The most words of a capability name. The reading of a message asks for two to five. */
const MAX_WORDS = 8;

/** How many listings that are named for the capability and are not offered the trace names. */
const MAX_NEAR = 3;

/** Words that say nothing by themselves. Each other word must be in both names. */
const IGNORED = new Set(["a", "an", "the", "my", "your", "our", "this", "that"]);

/**
 * One word as it is compared: its stem, with a last "e" and a doubled last letter taken off, so
 * that "codes" and "code", "setting" and "set" are one word. Both names go through it, so two
 * words that are the same stay the same. No synonym is joined.
 */
function wordKey(word: string): string {
  let key = stem(word);
  if (key.length > 3 && key.endsWith("e")) key = key.slice(0, -1);
  if (key.length > 2 && key.at(-1) === key.at(-2)) key = key.slice(0, -1);
  return key;
}

/** The words of a name in their order, as they are compared. `setPriceAlert` is three words. */
function nameWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "" && !IGNORED.has(word))
    .map(wordKey);
}

/** Whether a listing's own name says the capability, word for word and in the same order. */
export function sameName(capability: string, name: string): boolean {
  const wanted = nameWords(capability);
  const have = nameWords(name);
  return wanted.length >= MIN_WORDS && wanted.length === have.length && wanted.every((word, index) => word === have[index]);
}

/** A plain word: lower-case letters, with a hyphen or an apostrophe inside. */
const PLAIN_WORD = /^[a-z]+(?:[-'][a-z]+)*$/;
/** A short word in capitals ("SMS", "CSV"). A longer one can be a code. */
const ACRONYM = /^[A-Z]{2,4}$/;
/** The one word that may start with a capital: the verb that starts the name ("Finding"). */
const LEADING_VERB = /^[A-Z][a-z]+ing$/;

/** True for a word that is safe to send: a word of the language, as far as its form can say. */
function plainWord(word: string, first: boolean): boolean {
  if (ACRONYM.test(word)) return true;
  if (first && LEADING_VERB.test(word)) return true;
  if (!PLAIN_WORD.test(word)) return false;
  // Four letters or more with no vowel is a code, not a word.
  return word.length < 4 || /[aeiouy]/.test(word);
}

/**
 * The query for one capability, or null when the name must not leave the product.
 *
 * Only the capability name from the reading of the message goes out, never the message and never
 * the page. It goes out whole or not at all: a name with one word taken out says a different
 * thing ("enabling 2FA login" is not "enabling login"). So one word that can be private stops the
 * search: a word with a digit, a mark or a dot in it (a booking code, a phone number, an email,
 * an address), a word that starts with a capital after the first (a person, a place, a brand),
 * and a longer word in capitals or with no vowel (a code). A letter that is not one of the 26 is
 * a mark here too, so a name in a different script is not searched.
 */
export function queryFor(feature: string): string | null {
  const words = feature
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[("]+|[.,;:!?)"]+$/g, ""))
    .filter((word) => word !== "");
  if (words.length > MAX_WORDS) return null;
  if (!words.every((word, index) => plainWord(word, index === 0))) return null;
  const query = words.join(" ");
  if (query.length > AGENT_SEARCH.queryChars) return null;
  return nameWords(query).length >= MIN_WORDS ? query : null;
}

/** A dot between letters reads as an address ("evil.example"), and a long run of digits as a phone number. */
function carriesAddress(text: string): boolean {
  return /[A-Za-z0-9]\.[A-Za-z]{2,}/.test(text) || text.includes("//") || (text.match(/[0-9]/g) ?? []).length >= 7;
}

const SHOWN_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.,:()'&+/-]*$/;
const SHOWN_SERVICE = /^[A-Za-z0-9][A-Za-z0-9 _.&'+-]*$/;
/** A service name is a name, not a sentence. */
const SERVICE_CHARS = 40;
const SERVICE_WORDS = 5;

/** Whether the name of a capability can stand under a company's name as it is. */
export function shownName(name: string): boolean {
  return SHOWN_NAME.test(name) && !carriesAddress(name);
}

/**
 * Whether the name of a service can stand under a company's name as it is: plain characters
 * (a letter of a different script can look like a different letter, and some characters show as
 * nothing), a few words, at least two letters, and no address.
 */
export function shownService(provider: string): boolean {
  if (!SHOWN_SERVICE.test(provider) || carriesAddress(provider)) return false;
  if (provider.length > SERVICE_CHARS || provider.split(" ").length > SERVICE_WORDS) return false;
  return (provider.match(/[A-Za-z]/g) ?? []).length >= 2;
}

/** A listing that is named for the capability and is not offered, with the reason in a few words. */
export type NearListing = { name: string; provider: string; why: string };

export type GateResult = {
  offered: Alternative[];
  counts: {
    /** Listings that were read from the answer. */
    found: number;
    /** Of those, the ones that are named for the capability. */
    named: number;
    /** Of those, the ones that the index says can start now. */
    startable: number;
  };
  near: NearListing[];
};

/** Why a listing that is named for the capability cannot be offered, or null when it can. */
function blocked(listing: AgentListing): string | null {
  if (!listing.startable) return listing.readiness === "ready" ? "cannot start now" : listing.readiness;
  if (listing.paid) return "needs a payment";
  if (!listing.verified) return "not verified";
  if (!shownService(listing.provider)) return "no service name that can be shown";
  if (!shownName(listing.name)) return "a name that cannot be shown";
  return null;
}

/** Applies each rule to the listings of one search, in the order the index gave them. */
export function gate(listings: readonly AgentListing[], capability: string): GateResult {
  const named = listings.filter((listing) => sameName(capability, listing.name));
  const offered: Alternative[] = [];
  const near: NearListing[] = [];
  const services = new Set<string>();
  for (const listing of named) {
    const why = blocked(listing);
    // A service is its name, as a person reads it. The index can list one service under two ids.
    const service = listing.provider.toLowerCase();
    if (!why && !services.has(service) && offered.length < AGENT_SEARCH.maxOffered) {
      services.add(service);
      offered.push({ name: listing.name, provider: listing.provider, url: listing.url });
      continue;
    }
    if (why && near.length < MAX_NEAR) {
      near.push({
        name: shownName(listing.name) ? listing.name : "",
        provider: shownService(listing.provider) ? listing.provider : "",
        why,
      });
    }
  }
  return {
    offered,
    counts: { found: listings.length, named: named.length, startable: named.filter((listing) => listing.startable).length },
    near,
  };
}

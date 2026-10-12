/**
 * Text messages: the limits of the send call, and the one way a text is written.
 *
 * The limits and the path were read from https://docs.getdial.ai on 2026-10-11. The reason for
 * each one is in `docs/contracts.md` section 5.
 *
 * The worker has its own copy of these rules (`services/worker/steps/sms_text.py`), and the two
 * must give the same text. `test/fixtures/sms-text.json` is run by both test suites; change a rule
 * in both files and in the fixture together.
 */
export const SMS = {
  /** `POST`: send one message. The call has no idempotency key, so a caller never repeats it. */
  sendPath: "/api/v1/messages",
  /** `GET`: the numbers of the account. The live check reads it and sends nothing. */
  numbersPath: "/api/v1/numbers",
  /** The longest body the provider takes when each character is in the basic SMS alphabet. */
  maxChars: 1530,
  /**
   * The cap when one character is outside that alphabet. `smsText` never returns such a body,
   * so this value is here only to say why the fold exists.
   */
  maxCharsWide: 670,
  /** The longest gap title a notice quotes. It keeps the notice at two segments. */
  titleChars: 80,
} as const;

export { isE164, toE164 } from "./phone";

/** Characters that have a plain replacement. */
const REPLACED: ReadonlyMap<string, string> = new Map([
  ["\u2018", "'"], ["\u2019", "'"], ["\u201a", "'"], ["\u2032", "'"], ["`", "'"],
  ["\u201c", '"'], ["\u201d", '"'], ["\u201e", '"'], ["\u2033", '"'], ["\u00ab", '"'], ["\u00bb", '"'],
  ["\u2010", "-"], ["\u2011", "-"], ["\u2012", "-"], ["\u2013", "-"], ["\u2014", "-"], ["\u2015", "-"],
  ["\u2212", "-"], ["\u2022", "-"], ["\u00b7", "-"], ["~", "-"],
  ["\u2044", "/"], ["\u00f7", "/"], ["\\", "/"], ["|", "/"], ["\u00d7", "x"], ["\u2026", "..."],
  ["[", "("], ["{", "("], ["]", ")"], ["}", ")"],
  ["\t", " "], ["\r", "\n"],
  ["\u00df", "ss"], ["\u00e6", "ae"], ["\u00c6", "AE"], ["\u0153", "oe"], ["\u0152", "OE"],
  ["\u00f8", "o"], ["\u00d8", "O"], ["\u0142", "l"], ["\u0141", "L"], ["\u0111", "d"], ["\u0110", "D"],
  ["\u20ac", "EUR"], ["\u00a3", "GBP"],
]);

/**
 * The characters a text keeps. Each one is one character of the basic SMS alphabet. The alphabet
 * has more (some accented letters, Greek capitals), but a smaller set is the same in every
 * runtime and is enough for a short notice.
 */
const KEPT = /^[A-Za-z0-9 \n!"#$%&'()*+,\-./:;<=>?@_]$/;

/** What one character becomes: itself, a plain replacement, or nothing. */
function foldChar(char: string): string {
  const replaced = REPLACED.get(char);
  if (replaced !== undefined) return replaced;
  if (char.charCodeAt(0) < 128) return KEPT.test(char) ? char : "";
  if (/^\p{Zs}$/u.test(char)) return " ";
  // An accented letter becomes its base letter. Nothing else is taken apart: the parts of a sign
  // can say something different (a "not equal" sign is an equals sign and a stroke).
  const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
  return /^[A-Za-z]+$/.test(base) ? base : "";
}

/**
 * Folds any text into the basic SMS alphabet and cuts it at `max` characters.
 *
 * One character outside the alphabet makes the provider send the whole text in a wider encoding:
 * the cap goes from 1530 to 670 characters and each segment holds 70 characters, not 160. A gap
 * title is written by a model from a visitor's words, so it can carry a curly quote or an emoji.
 * The fold keeps the cost of a text known before it is sent. A character with no plain form is
 * removed, never replaced by a different meaning.
 */
export function smsText(text: string, max: number = SMS.maxChars): string {
  let folded = "";
  for (const char of text.replace(/\r\n/g, "\n")) folded += foldChar(char);
  const tidy = folded
    .replace(/ +/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (tidy.length <= limit) return tidy;
  if (limit < 4) return tidy.slice(0, limit);
  return `${tidy.slice(0, limit - 3).trimEnd()}...`;
}

/**
 * Words from outside, made safe to quote in a text that goes out under a company's name.
 *
 * A gap's title starts as a visitor's words, and a phone turns "example.com/x" or a long number
 * into something a person can tap. So a quoted name keeps letters, digits, spaces, and three
 * marks. A dot, a slash, a colon and an at sign are removed, and so is anything that reads as a
 * phone number: five digits in a row, or seven digits with single spaces or hyphens between them.
 * What is left can be read and cannot be followed.
 */
function quotable(text: string, max: number): string {
  const plain = smsText(text)
    .replace(/[^A-Za-z0-9 ',-]/g, " ")
    .replace(/ +/g, " ")
    .replace(/\d(?:[ -]?\d){6,}/g, " ")
    .replace(/\d{5,}/g, " ")
    .replace(/ +,/g, ",");
  return smsText(plain, max);
}

/**
 * The one text a person gets when the draft change for the gap they reported is open.
 *
 * It names the company, because the person knows the company and not Lantern. It says what is
 * true at that moment: a change is drafted and the team reviews it next. It does not say that the
 * feature is live. A title that folds to nothing is left out.
 */
export function draftNoticeText(input: { company: string; title: string }): string {
  const company = quotable(input.company, 40) || "Support";
  const title = quotable(input.title, SMS.titleChars);
  const about = title ? `about "${title}"` : "when work on your request starts";
  return smsText(
    `${company}: you asked for a text ${about}. A change for it is now drafted and the team reviews it next. This is the only text for this request.`,
  );
}

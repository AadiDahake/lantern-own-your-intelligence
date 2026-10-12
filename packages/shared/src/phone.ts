/**
 * Phone numbers: the one form a number is stored and sent in, and how a typed number gets there.
 *
 * This file has no other import, so the widget takes these two functions and nothing else.
 */

/** A phone number in E.164 form: a plus sign, then 7 to 15 digits, and the first is not 0. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

/** Longer than any number a person types with its spaces and brackets. */
const MAX_TYPED_CHARS = 40;

/**
 * A phone number as a person types it, in E.164 form, or null when it is not one.
 *
 * Spaces, hyphens, dots and brackets are how people group digits, so they are removed. A "(0)"
 * directly after the country code is a trunk prefix that is not dialled from abroad, so it is
 * removed with its digit. A "(0)" in any other place has no such meaning, and the number is
 * refused. Nothing is guessed: a number with no plus sign and country code is not accepted,
 * because a wrong guess sends the text to a different person.
 *
 * A digit that the person typed and did not need (a trunk zero with no brackets) is not found
 * here. No rule can find it without the numbering plan of each country, and some countries dial
 * that zero.
 */
export function toE164(typed: string): string | null {
  if (typed.length > MAX_TYPED_CHARS) return null;
  const dialled = typed.trim().replace(/^(\+\d{1,3})[\s.-]*\(\s*0\s*\)/, "$1");
  if (/\(\s*0\s*\)/.test(dialled)) return null;
  const digits = dialled.replace(/[\s().-]/g, "");
  return isE164(digits) ? digits : null;
}

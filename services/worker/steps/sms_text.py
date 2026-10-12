"""Text messages: the limits of the send call, and the one way a text is written.

This is the worker's copy of `packages/shared/src/sms.ts`, and the two must give the same text for
the same input. `packages/shared/test/fixtures/sms-text.json` holds inputs and the exact text each
one becomes; `tests/test_sms_text.py` runs every one of them against this module, and the shared
package runs them against the TypeScript. Change a rule in both files and in the fixture together.

The limits and the paths are those of `SMS` in `@lantern/shared`. The reason for each one is in
`docs/contracts.md` section 5.

One difference between the two copies is known: an accented letter is folded with the Unicode
data of the runtime, so a character that a newer Unicode version added can fold to a letter in one
runtime and to nothing in the other.
"""

from __future__ import annotations

import math
import re
import string
import unicodedata

# `POST`: send one message. The call has no idempotency key, so a caller never repeats it.
SEND_PATH = "/api/v1/messages"
# `GET`: the numbers of the account. The sweep reads it before it claims a person, and it sends
# nothing.
NUMBERS_PATH = "/api/v1/numbers"
# The longest body the provider takes when each character is in the basic SMS alphabet.
MAX_CHARS = 1530
# The longest gap title a notice quotes. It keeps the notice at two segments.
TITLE_CHARS = 80
# The longest company name a notice quotes.
COMPANY_CHARS = 40

_E164 = re.compile(r"\+[1-9][0-9]{6,14}")


def is_e164(value: str) -> bool:
    """A phone number in E.164 form: a plus sign, then 7 to 15 digits, and the first is not 0.

    `fullmatch`, because `$` also matches before a last newline.
    """
    return _E164.fullmatch(value) is not None


# Characters that have a plain replacement.
_REPLACED: dict[str, str] = {
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u2032": "'", "`": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u2033": '"', "\u00ab": '"', "\u00bb": '"',
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-", "\u2015": "-",
    "\u2212": "-", "\u2022": "-", "\u00b7": "-", "~": "-",
    "\u2044": "/", "\u00f7": "/", "\\": "/", "|": "/", "\u00d7": "x", "\u2026": "...",
    "[": "(", "{": "(", "]": ")", "}": ")",
    "\t": " ", "\r": "\n",
    "\u00df": "ss", "\u00e6": "ae", "\u00c6": "AE", "\u0153": "oe", "\u0152": "OE",
    "\u00f8": "o", "\u00d8": "O", "\u0142": "l", "\u0141": "L", "\u0111": "d", "\u0110": "D",
    "\u20ac": "EUR", "\u00a3": "GBP",
}

# The characters a text keeps. Each one is one character of the basic SMS alphabet. The alphabet
# has more (some accented letters, Greek capitals), but a smaller set is the same in every runtime
# and is enough for a short notice.
_KEPT = frozenset(string.ascii_letters + string.digits + " \n!\"#$%&'()*+,-./:;<=>?@_")

_PLAIN_LETTERS = re.compile(r"[A-Za-z]+")


def _fold_char(char: str) -> str:
    """What one character becomes: itself, a plain replacement, or nothing."""
    replaced = _REPLACED.get(char)
    if replaced is not None:
        return replaced
    if ord(char) < 128:
        return char if char in _KEPT else ""
    if unicodedata.category(char) == "Zs":
        return " "
    # An accented letter becomes its base letter. Nothing else is taken apart: the parts of a sign
    # can say something different (a "not equal" sign is an equals sign and a stroke).
    base = "".join(
        part for part in unicodedata.normalize("NFKD", char) if not unicodedata.category(part).startswith("M")
    )
    return base if _PLAIN_LETTERS.fullmatch(base) else ""


def sms_text(text: str, max_chars: float = MAX_CHARS) -> str:
    """Folds any text into the basic SMS alphabet and cuts it at `max_chars` characters.

    One character outside the alphabet makes the provider send the whole text in a wider encoding:
    the cap goes from 1530 to 670 characters and each segment holds 70 characters, not 160. A gap
    title is written by a model from a visitor's words, so it can carry a curly quote or an emoji.
    The fold keeps the cost of a text known before it is sent. A character with no plain form is
    removed, never replaced by a different meaning.
    """
    folded = "".join(_fold_char(char) for char in text.replace("\r\n", "\n"))
    tidy = re.sub(r" +", " ", folded)
    tidy = re.sub(r" ?\n ?", "\n", tidy)
    tidy = re.sub(r"\n{3,}", "\n\n", tidy).strip(" \n")
    # A cap that is not a whole number is rounded down, and a cap that is not a number is no room.
    limit = max(0, math.floor(max_chars)) if math.isfinite(max_chars) else 0
    if len(tidy) <= limit:
        return tidy
    if limit < 4:
        return tidy[:limit]
    head = tidy[: limit - 3].rstrip(" \n")
    return f"{head}..."


def _quotable(text: str, max_chars: int) -> str:
    """Words from outside, made safe to quote in a text that goes out under a company's name.

    A gap's title starts as a visitor's words, and a phone turns "example.com/x" or a long number
    into something a person can tap. So a quoted name keeps letters, digits, spaces, and three
    marks. A dot, a slash, a colon and an at sign are removed, and so is anything that reads as a
    phone number: five digits in a row, or seven digits with single spaces or hyphens between
    them. What is left can be read and cannot be followed.
    """
    plain = re.sub(r"[^A-Za-z0-9 ',-]", " ", sms_text(text))
    plain = re.sub(r" +", " ", plain)
    plain = re.sub(r"[0-9](?:[ -]?[0-9]){6,}", " ", plain)
    plain = re.sub(r"[0-9]{5,}", " ", plain)
    plain = re.sub(r" +,", ",", plain)
    return sms_text(plain, max_chars)


def draft_notice_text(company: str, title: str) -> str:
    """The one text a person gets when the draft change for the gap they reported is open.

    It names the company, because the person knows the company and not Lantern. It says what is
    true at that moment: a change is drafted and the team reviews it next. It does not say that
    the feature is live. A title that folds to nothing is left out.
    """
    named = _quotable(company, COMPANY_CHARS) or "Support"
    quoted = _quotable(title, TITLE_CHARS)
    about = f'about "{quoted}"' if quoted else "when work on your request starts"
    return sms_text(
        f"{named}: you asked for a text {about}. A change for it is now drafted and the team "
        "reviews it next. This is the only text for this request."
    )

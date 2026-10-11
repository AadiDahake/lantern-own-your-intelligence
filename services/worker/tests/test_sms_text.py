"""The worker writes a text exactly as the web app does.

`packages/shared/test/fixtures/sms-text.json` holds inputs and the exact text each one becomes.
The shared package runs them against `packages/shared/src/sms.ts`, and this file runs every one
of them against `steps/sms_text.py`, so the two copies of the rules cannot drift apart unseen.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from steps import sms_text

VECTORS: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/shared/test/fixtures/sms-text.json").read_text(encoding="utf-8")
)

# Each character one segment of a plain text can hold without the wider encoding.
BASIC = re.compile(r"[A-Za-z0-9 \n!\"#$%&'()*+,\-./:;<=>?@_]*")


def test_the_fixture_holds_every_kind_of_vector() -> None:
    # An empty list would make the parametrized tests below pass without a check.
    assert len(VECTORS["fold"]) >= 18
    assert len(VECTORS["cut"]) >= 9
    assert len(VECTORS["notice"]) >= 5
    assert len(VECTORS["e164"]["valid"]) >= 5 and len(VECTORS["e164"]["invalid"]) >= 10


@pytest.mark.parametrize("vector", VECTORS["fold"])
def test_folds_a_text_as_the_web_app_does(vector: dict[str, str]) -> None:
    folded = sms_text.sms_text(vector["in"])
    assert folded == vector["out"]
    assert BASIC.fullmatch(folded)
    # A text that is folded again does not change.
    assert sms_text.sms_text(folded) == folded


@pytest.mark.parametrize("vector", VECTORS["cut"])
def test_cuts_a_text_as_the_web_app_does(vector: dict[str, Any]) -> None:
    cut = sms_text.sms_text(vector["in"], vector["max"])
    assert cut == vector["out"]
    assert len(cut) <= max(0, vector["max"])


@pytest.mark.parametrize("vector", VECTORS["notice"])
def test_writes_the_notice_as_the_web_app_does(vector: dict[str, str]) -> None:
    assert sms_text.draft_notice_text(vector["company"], vector["title"]) == vector["out"]


@pytest.mark.parametrize("number", VECTORS["e164"]["valid"])
def test_accepts_an_e164_number(number: str) -> None:
    assert sms_text.is_e164(number)


@pytest.mark.parametrize("number", VECTORS["e164"]["invalid"])
def test_refuses_what_is_not_an_e164_number(number: str) -> None:
    assert not sms_text.is_e164(number)


@pytest.mark.parametrize(("cap", "out"), [(2.5, "ab"), (5.99, "ab..."), (float("inf"), ""), (float("nan"), ""), (-0.5, "")])
def test_a_cap_that_is_not_a_whole_number_is_read_as_the_web_app_reads_it(cap: float, out: str) -> None:
    """The web app rounds a cap down and gives no room to a cap that is not a number."""
    assert sms_text.sms_text("abcdef", cap) == out


def test_never_returns_more_than_the_cap_of_the_send_call() -> None:
    text = sms_text.sms_text("word " * 1000)
    assert len(text) == sms_text.MAX_CHARS
    assert text.endswith("...")


def test_the_notice_stays_in_the_basic_alphabet_and_inside_two_segments() -> None:
    text = sms_text.draft_notice_text("A" * 200, "\u201cB\u201d " * 200)
    assert BASIC.fullmatch(text)
    # Two concatenated segments hold 153 characters each.
    assert len(text) <= 306


@pytest.mark.parametrize(
    "title",
    [
        "go to https://evil.example/claim?id=7",
        "visit evil.example now",
        "mail help@evil.example",
        "call +1 (415) 555-0123",
        "call 415-555-0123 or 415 555 0123 or 4155550123",
        "text 5 5 5 0 1 2 3 4",
        # Digits of a different script are not digits of a phone number, and they do not survive.
        "call \u0664\u0661\u0665\u0665\u0665\u0665\u0660\u0661\u0662\u0663 or \uff14\uff11\uff15\uff15\uff15\uff15\uff10\uff11\uff12\uff13",
    ],
)
def test_the_notice_quotes_nothing_that_a_phone_turns_into_a_link_or_a_number(title: str) -> None:
    text = sms_text.draft_notice_text(title, title)
    quoted = text[: text.index(". A change for it")]
    assert not re.search(r"[./@]|:\S|[0-9](?:[ -]?[0-9]){6,}|[0-9]{5,}", quoted)

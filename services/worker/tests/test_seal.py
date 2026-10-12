"""The sealed format, and the phone number of a person who asked for a text.

PHONE is the output of

    npx tsx --tsconfig apps/web/tsconfig.json apps/web/scripts/subscriber-phone-fixture.ts \\
      sbp_test_service_role_key_for_fixtures_only +14155550123

so it was produced by `apps/web/lib/sms/phone.ts` itself. The key is a throwaway string and the
number is a fictional one, never a real person's. Regenerate it if the format ever changes.

A value that Node sealed opens here only when the cipher, the scrypt parameters and the salt are
the same on both sides, so the two fixtures (this one and the token in `test_github_token.py`)
are the proof of all three.
"""

from __future__ import annotations

import pytest

from steps import seal
from steps.sms_notice import PHONE_PURPOSE

PHONE = {
    "serviceRoleKey": "sbp_test_service_role_key_for_fixtures_only",
    "plain": "+14155550123",
    "stored": "HHwLxOfLK-fLLN_q.S5EGq8epd6BiALMA.rFJVPkWiJfRYPIf5daVaEQ",
}


def test_opens_a_phone_number_the_typescript_side_sealed() -> None:
    assert seal.unseal(PHONE_PURPOSE, PHONE["stored"], PHONE["serviceRoleKey"]) == PHONE["plain"]


def test_a_phone_number_does_not_open_under_the_purpose_of_the_github_token() -> None:
    assert seal.unseal("github-token", PHONE["stored"], PHONE["serviceRoleKey"]) is None


def test_the_wrong_service_role_key_does_not_open_it() -> None:
    assert seal.unseal(PHONE_PURPOSE, PHONE["stored"], "some-other-key") is None


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "not-a-blob",
        "only.two",
        "a.b.c.d",
        # A flipped byte in the ciphertext: GCM authenticates, so this must not come back as text.
        "HHwLxOfLK-fLLN_q.T5EGq8epd6BiALMA.rFJVPkWiJfRYPIf5daVaEQ",
    ],
)
def test_a_value_that_does_not_open_reads_as_none(stored: str) -> None:
    assert seal.unseal(PHONE_PURPOSE, stored, PHONE["serviceRoleKey"]) is None


def test_a_list_is_opened_with_one_key_derivation(monkeypatch: pytest.MonkeyPatch) -> None:
    """scrypt takes tens of milliseconds, and one pass opens up to 201 numbers."""
    derived: list[tuple[str, str]] = []
    real = seal.derive_key

    def counted(purpose: str, service_role_key: str) -> bytes:
        derived.append((purpose, service_role_key))
        return real(purpose, service_role_key)

    monkeypatch.setattr(seal, "derive_key", counted)
    monkeypatch.setattr(seal, "_derived", {})

    for _ in range(50):
        assert seal.unseal(PHONE_PURPOSE, PHONE["stored"], PHONE["serviceRoleKey"]) == PHONE["plain"]
    assert derived == [(PHONE_PURPOSE, PHONE["serviceRoleKey"])]

    # A changed service role key gives a new key, and the old value no longer opens.
    assert seal.unseal(PHONE_PURPOSE, PHONE["stored"], "a-rotated-key") is None
    assert seal.unseal(PHONE_PURPOSE, PHONE["stored"], PHONE["serviceRoleKey"]) == PHONE["plain"]
    assert len(derived) == 3


def test_the_service_role_key_comes_from_the_environment_when_none_is_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(seal.config, "supabase_service_role_key", lambda: PHONE["serviceRoleKey"])
    assert seal.unseal(PHONE_PURPOSE, PHONE["stored"]) == PHONE["plain"]

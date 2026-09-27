"""A candidate that only fails a test it wrote itself is repaired, not thrown away.

One escalation ended with "no candidate passed the gates after 2 attempts" because the candidate's
own new test, `tests/seat-party.test.ts > moves the whole party in one apply`, disagreed with the
code beside it. Both sides came from the same run, so neither is a requirement the repository set,
and the editor was rewriting the code to satisfy a test that was itself wrong.

So the repair is told which failing tests are its own, and given the failing output, and there is
one more candidate behind it.
"""

from __future__ import annotations

import pytest

from steps import codegen, drafting, llm

VITEST_OUTPUT = """
 FAIL  tests/seat-party.test.ts > moves the whole party in one apply
AssertionError: expected [ 12A, 12B ] to deeply equal [ 12A, 12B, 12C ]
 ❯ tests/seat-party.test.ts:31:24
Test Files  1 failed (9)
"""

FILES = {
    "lib/seats/party.ts": "export function findParty() { return []; }\n",
    "tests/seat-party.test.ts": "import { findParty } from '../lib/seats/party';\n",
}
# The two files this change created; nothing here existed before it.
ORIGINALS: dict[str, str | None] = {"lib/seats/party.ts": None, "tests/seat-party.test.ts": None}


def test_the_budget_allows_a_third_candidate() -> None:
    assert drafting.MAX_CANDIDATES == 3


def test_a_new_test_the_gate_named_is_recognised_as_the_change_s_own() -> None:
    assert drafting._own_new_tests(VITEST_OUTPUT, FILES, ORIGINALS) == ["tests/seat-party.test.ts"]


def test_a_test_the_repository_already_had_is_not_the_change_s_own() -> None:
    """The repository's own guard test failing is the repository saying no, and stays that way."""
    originals = dict(ORIGINALS, **{"tests/seat-party.test.ts": "the version already in the repository\n"})
    assert drafting._own_new_tests(VITEST_OUTPUT, FILES, originals) == []


def test_a_new_source_file_the_gate_named_is_not_treated_as_a_test() -> None:
    output = "error TS2322 in lib/seats/party.ts:3:5"
    assert drafting._own_new_tests(output, FILES, ORIGINALS) == []


def test_a_new_test_the_gate_did_not_name_is_left_out_of_it() -> None:
    output = "error TS2322: Type 'string' is not assignable to type 'number'."
    assert drafting._own_new_tests(output, FILES, ORIGINALS) == []


def test_the_repair_prompt_carries_the_failing_output_and_says_the_test_is_its_own(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(
        llm, "complete",
        lambda model, system, user: prompts.append(user) or "export function findParty() { return []; }\n",
    )

    codegen.repair_file(
        "lib/seats/party.ts",
        FILES["lib/seats/party.ts"],
        VITEST_OUTPUT,
        "(no AGENTS.md)",
        {"tests/seat-party.test.ts": FILES["tests/seat-party.test.ts"]},
        own_new_tests=["tests/seat-party.test.ts"],
    )

    prompt = prompts[0]
    assert "moves the whole party in one apply" in prompt
    assert "`tests/seat-party.test.ts` did not exist before this change" in prompt
    assert "the test's expectations or the code they exercise" in prompt
    assert "Do not delete the test" in prompt


def test_the_repair_prompt_says_nothing_of_the_kind_for_an_ordinary_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prompts: list[str] = []
    monkeypatch.setattr(llm, "complete", lambda model, system, user: prompts.append(user) or "x\n")

    codegen.repair_file("lib/seats/party.ts", "x\n", "error TS2322", "(no AGENTS.md)", {})

    assert "did not exist before this change" not in prompts[0]

"""What the repair round is allowed to see when a gate names a file the plan does not touch."""

from pathlib import Path

from steps import drafting

VITEST_OUTPUT = """
 FAIL  tests/seat-party.test.ts > assignSeatsForParty > moves the whole party in one apply
TypeError: Cannot read properties of undefined (reading 'trim')
 |  lib/seats/index.ts:77:41
 |  assignSeatsForParty lib/seats/index.ts:425:33
 |  assignSeatsForParty tests/seat-party.test.ts:105:10
 Test Files  1 failed | 8 passed (9)
"""


def _repo(tmp_path: Path) -> Path:
    (tmp_path / "tests").mkdir()
    (tmp_path / "lib" / "seats").mkdir(parents=True)
    (tmp_path / "tests" / "seat-party.test.ts").write_text("return apply(passengerIds, seatIds)\n")
    (tmp_path / "lib" / "seats" / "index.ts").write_text("export const drafted = 1\n")
    return tmp_path


def test_the_repair_reads_the_test_that_failed(tmp_path: Path) -> None:
    """A stack trace does not carry the signature the code is being called with. The test does."""
    root = _repo(tmp_path)
    witnesses = drafting._witnesses(root, VITEST_OUTPUT, planned={"lib/seats/index.ts"})
    assert witnesses == {"tests/seat-party.test.ts": "return apply(passengerIds, seatIds)\n"}


def test_a_file_the_plan_already_writes_is_not_read_from_the_clone(tmp_path: Path) -> None:
    """The drafted contents are the truth for a planned file, not what the clone still holds."""
    root = _repo(tmp_path)
    planned = {"lib/seats/index.ts", "tests/seat-party.test.ts"}
    assert drafting._witnesses(root, VITEST_OUTPUT, planned) == {}


def test_witnesses_are_bounded(tmp_path: Path) -> None:
    root = tmp_path
    for index in range(5):
        (root / f"f{index}.ts").write_text(f"const a{index} = 1\n")
    output = " ".join(f"f{index}.ts" for index in range(5))
    assert len(drafting._witnesses(root, output, planned=set())) == 2


def test_a_named_file_that_is_not_in_the_clone_is_skipped(tmp_path: Path) -> None:
    assert drafting._witnesses(tmp_path, "node_modules/next/dist/thing.js failed", planned=set()) == {}


def test_affected_paths_only_ever_names_a_drafted_file(tmp_path: Path) -> None:
    """The contract is what the code must satisfy, so the repair never rewrites it."""
    files = {"lib/seats/index.ts": "x"}
    assert drafting._affected_paths(VITEST_OUTPUT, files) == ["lib/seats/index.ts"]

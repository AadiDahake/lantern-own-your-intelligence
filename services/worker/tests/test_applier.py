import json
import os
from pathlib import Path

import pytest

from steps import applier


def test_safe_join_rejects_traversal_and_absolute(tmp_path: Path) -> None:
    for bad in ("../x.ts", "a/../../x.ts", "/etc/passwd", ".git/config", "", "a\x00b"):
        with pytest.raises(applier.UnsafePath):
            applier.safe_join(tmp_path, bad)


def test_safe_join_rejects_symlink_escape(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    root = tmp_path / "repo"
    root.mkdir()
    os.symlink(outside, root / "link")
    with pytest.raises(applier.UnsafePath):
        applier.safe_join(root, "link/file.ts")


def test_safe_join_accepts_nested_new_paths(tmp_path: Path) -> None:
    target = applier.safe_join(tmp_path, "components/ThemeToggle.tsx")
    assert target == tmp_path.resolve() / "components" / "ThemeToggle.tsx"


def test_apply_files_writes_all_and_returns_originals(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("old a\n")
    originals = applier.apply_files(tmp_path, {"a.ts": "new a\n", "b/c.ts": "new c\n"})
    assert originals == {"a.ts": "old a\n", "b/c.ts": None}
    assert (tmp_path / "a.ts").read_text() == "new a\n"
    assert (tmp_path / "b" / "c.ts").read_text() == "new c\n"


def test_apply_files_is_atomic_on_bad_path(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("old a\n")
    with pytest.raises(applier.UnsafePath):
        applier.apply_files(tmp_path, {"a.ts": "new a\n", "../escape.ts": "x"})
    assert (tmp_path / "a.ts").read_text() == "old a\n"
    assert not (tmp_path.parent / "escape.ts").exists()


def test_restore_removes_new_files_and_rewrites_old(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("old a\n")
    originals = applier.apply_files(tmp_path, {"a.ts": "new a\n", "n.ts": "new\n"})
    applier.restore(tmp_path, originals)
    assert (tmp_path / "a.ts").read_text() == "old a\n"
    assert not (tmp_path / "n.ts").exists()


def test_apply_files_deletes_and_restore_puts_it_back(tmp_path: Path) -> None:
    """A guard the plan removes is written by nobody, so the applier has to do it."""
    (tmp_path / "guard.test.ts").write_text("it('has no feature', () => {})\n")
    (tmp_path / "a.ts").write_text("old a\n")
    originals = applier.apply_files(tmp_path, {"a.ts": "new a\n"}, ["guard.test.ts"])

    assert originals == {"a.ts": "old a\n", "guard.test.ts": "it('has no feature', () => {})\n"}
    assert not (tmp_path / "guard.test.ts").exists()
    assert (tmp_path / "a.ts").read_text() == "new a\n"

    applier.restore(tmp_path, originals)
    assert (tmp_path / "guard.test.ts").read_text() == "it('has no feature', () => {})\n"
    assert (tmp_path / "a.ts").read_text() == "old a\n"


def test_apply_files_is_atomic_when_a_write_fails_after_a_delete(tmp_path: Path) -> None:
    (tmp_path / "guard.test.ts").write_text("guard\n")
    with pytest.raises(applier.UnsafePath):
        applier.apply_files(tmp_path, {"../escape.ts": "x"}, ["guard.test.ts"])
    assert (tmp_path / "guard.test.ts").read_text() == "guard\n"


def test_apply_files_ignores_a_deletion_of_a_file_it_also_writes(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("old a\n")
    applier.apply_files(tmp_path, {"a.ts": "new a\n"}, ["a.ts"])
    assert (tmp_path / "a.ts").read_text() == "new a\n"


def test_unified_diffs_marks_a_deletion_against_dev_null(tmp_path: Path) -> None:
    originals = {"gone.ts": "line one\nline two\n", "kept.ts": None}
    patches = applier.unified_diffs(originals, {"kept.ts": "added\n"}, ["gone.ts"])
    by_path = {entry["path"]: entry["patch"] for entry in patches}
    assert "+++ /dev/null" in by_path["gone.ts"]
    assert "-line one" in by_path["gone.ts"]
    assert "--- /dev/null" in by_path["kept.ts"]


def _package(tmp_path: Path, scripts: dict[str, str]) -> None:
    (tmp_path / "package.json").write_text(f'{{"scripts": {json.dumps(scripts)}}}\n')


def test_package_scripts_reads_what_the_repository_defines(tmp_path: Path) -> None:
    _package(tmp_path, {"typecheck": "tsc", "build": "next build", "test": "vitest run"})
    assert applier.package_scripts(tmp_path) == {"typecheck", "build", "test"}


def test_package_scripts_is_empty_without_a_readable_package_json(tmp_path: Path) -> None:
    assert applier.package_scripts(tmp_path) == set()
    (tmp_path / "package.json").write_text("{not json")
    assert applier.package_scripts(tmp_path) == set()


def test_run_gates_runs_the_repository_own_tests(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """typecheck and build both passed on a draft that broke the target's contract test."""
    _package(tmp_path, {"typecheck": "tsc", "build": "next build", "test": "vitest run"})
    ran: list[list[str]] = []
    monkeypatch.setattr(applier, "timed_command", lambda root, args, **k: (ran.append(args) or (True, "", 1.0)))

    results = applier.run_gates(tmp_path, "slug", install=False)

    assert [args[-1] for args in ran] == ["typecheck", "test", "build"]
    assert [r.name for r in results] == ["npm run typecheck", "npm test", "npm run build"]


def test_run_gates_skips_a_gate_the_repository_does_not_define(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _package(tmp_path, {"build": "next build"})
    monkeypatch.setattr(applier, "timed_command", lambda root, args, **k: (True, "", 1.0))
    assert [r.name for r in applier.run_gates(tmp_path, "slug", install=False)] == ["npm run build"]


def test_run_gates_stops_at_the_first_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _package(tmp_path, {"typecheck": "tsc", "build": "next build", "test": "vitest run"})
    monkeypatch.setattr(
        applier, "timed_command",
        lambda root, args, **k: (args[-1] != "test", "3 failed" if args[-1] == "test" else "", 1.0),
    )
    results = applier.run_gates(tmp_path, "slug", install=False)
    assert [(r.name, r.ok) for r in results] == [("npm run typecheck", True), ("npm test", False)]

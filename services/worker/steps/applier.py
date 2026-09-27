"""Applies drafted files to a clone, runs the gates, and produces unified diffs."""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import shutil
import subprocess
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import config

GATE_TIMEOUT_S = 600


class UnsafePath(ValueError):
    pass


def safe_join(root: Path, rel_path: str) -> Path:
    """Resolve `rel_path` under `root`, rejecting absolute paths, `..`, the .git directory and symlink escapes."""
    if not rel_path or rel_path.startswith(("/", "\\")) or "\x00" in rel_path:
        raise UnsafePath(f"refusing path {rel_path!r}")
    parts = Path(rel_path).parts
    if ".." in parts or parts[0] == ".git" or any(part.endswith(":") for part in parts):
        raise UnsafePath(f"refusing path {rel_path!r}")
    root_resolved = root.resolve()
    target = (root_resolved / rel_path)
    # Resolve the deepest existing ancestor so a symlinked directory cannot point outside the clone.
    probe = target
    while not probe.exists() and probe != root_resolved:
        probe = probe.parent
    if root_resolved != probe.resolve() and root_resolved not in probe.resolve().parents:
        raise UnsafePath(f"refusing path {rel_path!r}: escapes the repository")
    return target


def snapshot(root: Path, paths: list[str]) -> dict[str, str | None]:
    originals: dict[str, str | None] = {}
    for rel in paths:
        target = safe_join(root, rel)
        originals[rel] = target.read_text(encoding="utf-8") if target.exists() else None
    return originals


def apply_files(
    root: Path,
    files: dict[str, str],
    deletions: Iterable[str] = (),
) -> dict[str, str | None]:
    """Write every file and remove every deletion, or do neither.

    Returns the original contents, `None` for a file that did not exist, which is also what
    `restore` needs to put a deleted file back.
    """
    removals = [rel for rel in deletions if rel not in files]
    originals = snapshot(root, [*files, *removals])
    touched: list[str] = []
    try:
        for rel in removals:
            target = safe_join(root, rel)
            if target.exists():
                target.unlink()
            touched.append(rel)
        for rel, content in files.items():
            target = safe_join(root, rel)
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + ".lantern-tmp")
            tmp.write_text(content, encoding="utf-8")
            os.replace(tmp, target)
            touched.append(rel)
    except Exception:
        restore(root, {rel: originals[rel] for rel in touched})
        raise
    return originals


def restore(root: Path, originals: dict[str, str | None]) -> None:
    for rel, content in originals.items():
        target = safe_join(root, rel)
        if content is None:
            if target.exists():
                target.unlink()
        else:
            target.write_text(content, encoding="utf-8")


def unified_diff(path: str, before: str | None, after: str | None) -> str:
    """A patch for one file. `after` of None is a deletion, so the new side is /dev/null."""
    old_lines = (before or "").splitlines(keepends=True)
    new_lines = (after or "").splitlines(keepends=True)
    from_file = "/dev/null" if before is None else f"a/{path}"
    to_file = "/dev/null" if after is None else f"b/{path}"
    return "".join(difflib.unified_diff(old_lines, new_lines, fromfile=from_file, tofile=to_file))


def unified_diffs(
    originals: dict[str, str | None],
    files: dict[str, str],
    deletions: Iterable[str] = (),
) -> list[dict[str, str]]:
    patches = [{"path": path, "patch": unified_diff(path, originals.get(path), content)} for path, content in files.items()]
    patches += [{"path": path, "patch": unified_diff(path, originals.get(path), None)} for path in deletions]
    return patches


@dataclass
class GateResult:
    name: str
    ok: bool
    output: str
    skipped: bool = False
    duration_s: float = 0.0


def run_command(root: Path, args: list[str], timeout_s: int = GATE_TIMEOUT_S) -> tuple[bool, str]:
    ok, output, _ = timed_command(root, args, timeout_s)
    return ok, output


def timed_command(root: Path, args: list[str], timeout_s: int = GATE_TIMEOUT_S) -> tuple[bool, str, float]:
    """Same as `run_command`, and how long it took: the PR comment reports the gate durations."""
    env = dict(os.environ, CI="1", NEXT_TELEMETRY_DISABLED="1", FORCE_COLOR="0")
    started = time.monotonic()
    try:
        completed = subprocess.run(args, cwd=root, capture_output=True, text=True, env=env, timeout=timeout_s)
    except subprocess.TimeoutExpired as error:
        return False, f"timed out after {timeout_s}s\n{error.stdout or ''}{error.stderr or ''}", time.monotonic() - started
    output = (completed.stdout or "") + (completed.stderr or "")
    return completed.returncode == 0, output, time.monotonic() - started


def _lockfile_hash(root: Path) -> str | None:
    lock = root / "package-lock.json"
    if not lock.exists():
        return None
    return hashlib.sha256(lock.read_bytes()).hexdigest()


def _copy_tree(src: Path, dest: Path) -> None:
    """Hard-link copy when possible (instant on the same filesystem), plain copy otherwise."""
    completed = subprocess.run(["cp", "-al", str(src), str(dest)], capture_output=True, text=True)
    if completed.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(src, dest, symlinks=True)


def ensure_node_modules(root: Path, repo_slug: str) -> GateResult:
    """`npm ci`, reusing ~/.cache/lantern/<slug>/node_modules when the lockfile hash matches.

    The cache is copied into the clone (hard links when on the same filesystem, so it takes well
    under a second); a symlink would be rejected by Turbopack because it points outside the project.
    A fresh install is copied into the cache afterwards so the next run can reuse it.
    """
    started = time.monotonic()
    lock_hash = _lockfile_hash(root)
    cache_dir = config.cache_root() / repo_slug
    cached_modules = cache_dir / "node_modules"
    stamp = cache_dir / "lockfile.sha256"
    local_modules = root / "node_modules"
    if local_modules.is_symlink():
        local_modules.unlink()
    elif local_modules.exists():
        shutil.rmtree(local_modules, ignore_errors=True)
    if lock_hash and cached_modules.is_dir() and stamp.exists() and stamp.read_text().strip() == lock_hash:
        _copy_tree(cached_modules, local_modules)
        return GateResult("npm ci", True, f"reused cached node_modules for lockfile {lock_hash[:12]}", skipped=True, duration_s=time.monotonic() - started)
    ok, output, _ = timed_command(root, ["npm", "ci", "--no-audit", "--no-fund", "--loglevel=error"])
    if ok and lock_hash and local_modules.is_dir():
        cache_dir.mkdir(parents=True, exist_ok=True)
        if cached_modules.exists():
            shutil.rmtree(cached_modules, ignore_errors=True)
        _copy_tree(local_modules, cached_modules)
        stamp.write_text(lock_hash)
    return GateResult("npm ci", ok, output[-8000:], duration_s=time.monotonic() - started)


# The gates, cheapest first, so a broken draft is told so before the slow one runs.
#
# `test` is here because typecheck and build are not enough on their own. A drafted change once
# passed both and still broke the target repository's own contract test: it added the two exports
# that repository documents, with a signature the test does not call. Nothing but running the suite
# would have caught it, and the repair round fixes what the gates report.
#
# `e2e` is deliberately not a gate: it wants a browser and a server, and it is a separate script in
# every repository the worker targets.
GATES: tuple[tuple[str, str], ...] = (
    ("npm run typecheck", "typecheck"),
    ("npm test", "test"),
    ("npm run build", "build"),
)


def package_scripts(root: Path) -> set[str]:
    """The script names package.json defines, so the worker only runs gates that exist."""
    try:
        data = json.loads((root / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    scripts = data.get("scripts")
    return set(scripts) if isinstance(scripts, dict) else set()


def run_gates(root: Path, repo_slug: str, install: bool = True) -> list[GateResult]:
    """Run every gate the repository defines, in order, and stop at the first failure."""
    results: list[GateResult] = []
    if install:
        install_result = ensure_node_modules(root, repo_slug)
        results.append(install_result)
        if not install_result.ok:
            return results
    scripts = package_scripts(root)
    for name, script in GATES:
        if script not in scripts:
            continue
        ok, output, seconds = timed_command(root, ["npm", "run", "--silent", script])
        results.append(GateResult(name, ok, output[-8000:], duration_s=seconds))
        if not ok:
            break
    return results

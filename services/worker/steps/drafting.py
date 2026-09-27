"""The drafting loop: write every planned file, run the gates, repair, and start over if needed."""

from __future__ import annotations

import re
from pathlib import Path

from models import Draft, FeatureRequestInput, GateOutcome, Plan
from steps import applier, codegen, llm, repo
from steps.reporter import Reporter

MAX_REPAIRS = 3
MAX_CANDIDATES = 3
# How much of a file the gate named but the plan does not touch goes into a repair.
CONTEXT_FILE_CHARS = 9000


def _affected_paths(output: str, files: dict[str, str]) -> list[str]:
    """Files named in the gate output; when none is named, every drafted file is a suspect."""
    lowered = output.lower()
    affected = [path for path in files if path.lower() in lowered or Path(path).name.lower() in lowered]
    return affected or list(files)


NAMED_PATH_RE = re.compile(r"[\w./\[\]-]+\.(?:ts|tsx|js|jsx|mjs|css)")

TEST_PATH_RE = re.compile(r"(?:^|/)(?:tests?|__tests__)/|\.(?:test|spec)\.[cm]?[jt]sx?$")


def _own_new_tests(output: str, files: dict[str, str], originals: dict[str, str | None]) -> list[str]:
    """Test files this change itself added that the failing gate names.

    A gate failing on a test the repository already had is the repository saying no. A gate failing
    only on a test this change wrote is the change disagreeing with itself, and starting over from
    a blank candidate throws away work that was nearly right. So the repair is told which tests are
    its own and given the failing output, and may correct either side.
    """
    lowered = output.lower()
    return [
        path
        for path in files
        if originals.get(path) is None
        and TEST_PATH_RE.search(path)
        and (path.lower() in lowered or Path(path).name.lower() in lowered)
    ]


def _witnesses(root: Path, output: str, planned: set[str], limit: int = 2) -> dict[str, str]:
    """Files the gate named that the plan does not touch, read from the clone.

    A failing test is the clearest case. It says what the code has to satisfy, it is not in the
    plan, so the editor never sees it, and a stack trace alone does not carry the signature it is
    being called with. Reading it is what turns a repair into more than a guess.
    """
    found: dict[str, str] = {}
    for match in NAMED_PATH_RE.findall(output):
        path = match.lstrip("./")
        if path in planned or path in found or len(found) >= limit:
            continue
        body = repo.read_file(root, path)
        if body:
            found[path] = body[:CONTEXT_FILE_CHARS]
    return found


def _first_failure(results: list[applier.GateResult]) -> applier.GateResult | None:
    for result in results:
        if not result.ok:
            return result
    return None


def _report_gates(reporter: Reporter, results: list[applier.GateResult], label: str) -> None:
    for result in results:
        summary = result.output.strip().splitlines()
        reporter.tool(
            f"{result.name}: {'passed' if result.ok else 'failed'} ({label})",
            result.name,
            "shell",
            result.name,
            (summary[-1] if summary else "") if result.ok else "\n".join(summary[-25:]),
            status="ok" if result.ok else "failed",
        )


def draft_with_gates(
    root: Path,
    req: FeatureRequestInput,
    issue_title: str,
    issue_body: str,
    plan: Plan,
    reporter: Reporter,
    repo_slug: str,
) -> Draft:
    agents_md = repo.read_file(root, "AGENTS.md") or "(no AGENTS.md)"
    dependencies = codegen.dependency_block(root)
    written_plan = [f for f in plan.files if not f.is_delete]
    # A guard the plan removes is part of the change, and no model call writes it.
    deletions = [f.path for f in plan.files if f.is_delete]
    originals = applier.snapshot(root, [f.path for f in plan.files])
    for planned in plan.files:
        if planned.is_delete:
            reporter.tool(
                f"Deleting {planned.path}", "delete_file", "fs",
                planned.reason or "superseded by this change",
                f"{len((originals.get(planned.path) or '').splitlines())} lines removed",
            )

    install = applier.ensure_node_modules(root, repo_slug)
    _report_gates(reporter, [install], "dependencies")
    if not install.ok:
        raise RuntimeError("npm ci failed:\n" + install.output[-2000:])

    total_repairs = 0
    last_error = ""
    for candidate in range(1, MAX_CANDIDATES + 1):
        label = f"candidate {candidate}"
        files: dict[str, str] = {}
        for planned in written_plan:
            existing = originals.get(planned.path)
            context = {p: c for p, c in files.items()}
            for other in written_plan:
                if other.path not in context and other.path != planned.path and originals.get(other.path):
                    context[other.path] = originals[other.path] or ""
            content = codegen.draft_file(req, issue_title, issue_body, plan, planned, existing, agents_md, context, dependencies)
            files[planned.path] = content
            reporter.model(
                f"Drafted {planned.path} ({label})",
                llm.EDITOR_MODEL,
                "write the complete file contents",
                input_summary=f"{'new file' if existing is None else f'{len(existing.splitlines())} existing lines supplied verbatim'}; reason: {planned.reason}",
                output_summary=f"{len(content.splitlines())} lines",
            )

        applier.apply_files(root, files, deletions)
        results = applier.run_gates(root, repo_slug, install=False)
        _report_gates(reporter, results, label)
        failure = _first_failure(results)

        repairs = 0
        while failure is not None and repairs < MAX_REPAIRS:
            repairs += 1
            total_repairs += 1
            witnesses = _witnesses(root, failure.output, set(files) | set(deletions))
            own_tests = _own_new_tests(failure.output, files, originals)
            for path in _affected_paths(failure.output, files):
                context = {p: c for p, c in files.items() if p != path}
                context.update(witnesses)
                files[path] = codegen.repair_file(
                    path, files[path], failure.output, agents_md, context, dependencies, own_tests
                )
                reporter.model(
                    f"Repaired {path} after {failure.name} failed (repair {repairs}/{MAX_REPAIRS}, {label})",
                    llm.EDITOR_MODEL,
                    "fix the file so the gate passes",
                    input_summary=failure.output.strip().splitlines()[-1][:300] if failure.output.strip() else failure.name,
                    output_summary=f"{len(files[path].splitlines())} lines",
                )
            applier.apply_files(root, files, deletions)
            results = applier.run_gates(root, repo_slug, install=False)
            _report_gates(reporter, results, f"{label}, repair {repairs}")
            failure = _first_failure(results)

        if failure is None:
            changed = {path: content for path, content in files.items() if content != originals.get(path)}
            if not changed and not deletions:
                raise RuntimeError("the editor returned every file unchanged")
            diffs = applier.unified_diffs(originals, changed, deletions)
            return Draft(
                files=changed,
                deletions=deletions,
                diffs=[{"path": d["path"], "patch": d["patch"]} for d in diffs],
                summary=plan.summary,
                base_sha=plan.base_sha or repo.head_sha(root),
                candidates_tried=candidate,
                repairs=total_repairs,
                # The gates of the run that passed, reported on the pull request.
                gates=[GateOutcome(name=r.name, ok=r.ok, duration_s=r.duration_s) for r in results],
            )

        last_error = f"{failure.name} failed:\n{failure.output[-1500:]}"
        applier.restore(root, originals)
        reporter.status(f"Discarded {label} after {repairs} repairs", "failed", {"gate": failure.name})

    raise RuntimeError(f"no candidate passed the gates after {MAX_CANDIDATES} attempts. Last error: {last_error}")

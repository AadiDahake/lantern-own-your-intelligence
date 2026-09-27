"""Model calls for planning and writing code: the architect picks files, the editor writes them."""

from __future__ import annotations

import json
import re
from pathlib import Path

from models import FeatureRequestInput, Plan, PlannedFile
from steps import applier, llm, repo

MAX_FILES = 7
# How much of the repository the architect reads. Enough of the real files to plan against them,
# bounded so a large repository still fits in one call.
TREE_LIMIT = 400
RELEVANT_FILES = 12
FILE_CHARS = 9000
CONTEXT_CHARS = 110_000

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "files": {
            "type": "array",
            # The architect's job is to plan a change. An empty list is not a plan, so the schema
            # itself refuses one and the model has to name the files it would touch.
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "reason": {"type": "string"},
                    "action": {"type": "string", "enum": ["edit", "create", "delete"]},
                },
                "required": ["path", "reason", "action"],
                "additionalProperties": False,
            },
        },
        "acceptance_criteria": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "files", "acceptance_criteria"],
    "additionalProperties": False,
}

# The one paragraph that decides whether a plan exists at all. A product repository can carry a
# convention, a contract or a test whose whole content is that the requested feature is absent.
# Reading that as a veto is how the architect used to return nothing: the request had already been
# accepted by a human, so the veto is the thing the change removes.
APPROVED_DECISION = """The issue you are given is an APPROVED PRODUCT DECISION. A maintainer accepted this request
before it reached you, so the decision to build it is already made and is not yours to revisit.

It therefore supersedes any premise, guard test, contract, comment or convention in this repository whose only
content is that the requested feature is absent, unsupported or deliberately not built. Sentences such as "this
product does not do X", "nothing here composes these primitives", "raise this rather than implementing it", or a
test that asserts a name or a control does not appear, describe the product BEFORE this decision. Shipping the
feature is what makes them out of date.

So:
- Never answer with an empty file list, and never answer that the change should be raised with a maintainer
  instead of planned. It has been raised, and this is the answer.
- Find every guard that would contradict the feature and put it IN the plan: `action: "delete"` for a test whose
  only purpose is to assert the feature's absence, `action: "edit"` for a document, a comment or an exported
  contract list that has to describe the product as it will be.
- Keep every other convention in the file exactly: layout, tokens, naming, accessibility, testing style. Only the
  absence claim is superseded, never the engineering standard around it."""

ARCHITECT_SYSTEM = f"""You are the architect for a Next.js, TypeScript and Tailwind v4 code base.
You receive a feature request (a GitHub issue), the repository conventions (AGENTS.md), the file tree and the
contents of the most relevant files. Decide the smallest set of files to change, create or delete (2 to {MAX_FILES})
so that the feature works end to end, and write acceptance criteria.

{APPROVED_DECISION}

Rules:
- Choose the SMALLEST set of files that makes the feature real end to end: the domain function, the route or
  server entry point that exposes it, and the control a user operates. A plan that only touches one layer is
  not a working feature.
- Every file needs a concrete reason naming what it does in this change.
- Follow AGENTS.md to the letter for everything except an absence claim (see above).
- When the feature needs a new module or component, plan it with `action: "create"` and a path that matches the
  existing layout. Do not put new modules into unrelated files.
- Only list files that exist in the tree, or new files you are creating. Never list lockfiles or node_modules.
- The dependency list is fixed: plan nothing that needs a package which is not already in package.json
  (no icon libraries, no theme libraries; inline SVG or text is fine).
- Acceptance criteria are short, testable sentences a reviewer can check in the browser or with the gates
  (`npm run typecheck`, `npm run build`).
Return JSON only."""

# The second attempt. The first already carried the paragraph above; this says the quiet part once more,
# because an empty list means the model weighed the repository's premise against the decision and lost.
RETRY_INSTRUCTION = """Your previous answer named no files to change. That is not an acceptable answer.

The request has already been approved by a maintainer. Whatever premise, guard test or documented contract in
this repository says the feature is absent or should not be built is exactly what this change supersedes, and
updating or deleting it is part of your plan, not a reason to refuse one.

Answer again with the real plan: the domain function, the route that exposes it, the control a user operates,
and every guard or document that has to change with them. Name concrete paths from the file tree."""

EDITOR_SYSTEM = """You are a senior TypeScript engineer editing one file of a Next.js 16, React 19, Tailwind v4 code base.
Return only the complete file contents, no code fences, no commentary. The output replaces the file verbatim.
Keep unrelated code exactly as it is. Follow the repository conventions given to you. The project must pass
`tsc --noEmit` with strict mode and `next build`.
Hard rules:
- Import only from packages listed in the dependency list you are given, from Node built-ins, or from files in
  this repository. Never add a dependency. For icons use inline SVG or plain text.
- Components that use hooks, window, document or localStorage start with the "use client" directive. Nothing
  else gets that directive. The root layout (app/layout.tsx) stays a server component: keep its `metadata`
  export and everything it already renders; to apply a saved theme before paint add a tiny inline
  `<script dangerouslySetInnerHTML={{ __html: "..." }} />` at the top of `<body>` or in `<head>`, never a hook.
- Never remove existing behaviour: keep every existing export, import, comment and rendered element unless
  the task explicitly says to remove it. Add to the file; do not rewrite it.
- Interactive controls get an `aria-label` and a `data-testid` in kebab-case (for example "theme-toggle").
- Name a NEW control in the words of the request itself, so the user who asked for it recognises it on the
  page ("Find seats together", not "Group assignment utility"). Existing control names never change.
- No literal colours in components: use the token utilities from the conventions."""

FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_.+-]*\s*\n(.*?)\n\s*```\s*$", re.DOTALL)


def strip_fences(text: str) -> str:
    """A model sometimes wraps output in fences even when told not to."""
    match = FENCE_RE.match(text)
    if match:
        return match.group(1) + "\n"
    stripped = text.lstrip("\n")
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else ""
    if stripped.rstrip().endswith("```"):
        stripped = stripped.rstrip()[:-3]
    if not stripped.endswith("\n"):
        stripped += "\n"
    return stripped


def dependency_block(root: Path) -> str:
    """The dependency names from package.json, so the models never import what is not installed."""
    package_json = repo.read_file(root, "package.json")
    if not package_json:
        return "Dependencies: unknown (no package.json)."
    try:
        data = json.loads(package_json)
    except json.JSONDecodeError:
        return "Dependencies: unreadable package.json."
    names = sorted({*data.get("dependencies", {}), *data.get("devDependencies", {})})
    return "Dependencies available (package.json, nothing else may be imported): " + ", ".join(names)


def _issue_block(req: FeatureRequestInput, issue_title: str, issue_body: str) -> str:
    return f"# Issue: {issue_title}\n\n{issue_body}\n\nArea: {req.area or 'unspecified'}\n"


def relevant_files(
    root: Path,
    tree: list[str],
    terms: list[str],
    agents_md: str,
    limit: int = RELEVANT_FILES,
    budget: int = CONTEXT_CHARS,
    referenced: set[str] | None = None,
) -> list[tuple[str, str]]:
    """The files the architect reads in full: the best keyword matches, plus what AGENTS.md names.

    Whole contents rather than the first forty lines. A plan that composes a repository's own
    primitives has to be made against the signatures those primitives actually have.
    """
    referenced = repo.referenced_paths(tree, agents_md) if referenced is None else referenced
    ranked = repo.rank_files(root, tree, terms, limit=limit, referenced=referenced)
    chosen: list[tuple[str, str]] = []
    spent = 0
    for path, _score in ranked:
        if path == "AGENTS.md":
            continue  # It has its own block; sending it twice only spends budget.
        body = repo.read_bounded(root, path, FILE_CHARS)
        if not body.strip() or spent + len(body) > budget:
            continue
        chosen.append((path, body))
        spent += len(body)
    return chosen


def build_architect_prompt(
    req: FeatureRequestInput,
    issue_title: str,
    issue_body: str,
    agents_md: str,
    tree: list[str],
    contents: list[tuple[str, str]],
    dependencies: str = "",
    referenced: set[str] | None = None,
) -> str:
    parts = [_issue_block(req, issue_title, issue_body)]
    parts.append("# Repository conventions (AGENTS.md)\n\n" + (agents_md.strip() or "(no AGENTS.md in this repository)"))
    if dependencies:
        parts.append("# " + dependencies)
    if referenced:
        # AGENTS.md names these, so they carry the contract. Asking about them by name is what stops
        # a plan from shipping a feature and leaving the test that forbids it in place.
        parts.append(
            "# Files the conventions name\n\n"
            + "\n".join(f"- {path}" for path in sorted(referenced))
            + "\n\nEach of these carries part of this repository's contract. Check every one against the "
            "feature: any that asserts, lists or documents the product WITHOUT it belongs in your plan, "
            "as an edit that describes the product with it, or as a delete when asserting the absence is "
            "the file's only purpose."
        )
    shown = tree[:TREE_LIMIT]
    tree_block = "\n".join(shown)
    if len(tree) > len(shown):
        tree_block += f"\n... ({len(tree) - len(shown)} more files not listed)"
    parts.append("# File tree\n\n" + tree_block)
    blocks = [f"## {path}\n```\n{body.rstrip()}\n```" for path, body in contents]
    parts.append("# The most relevant files, in full\n\n" + "\n\n".join(blocks))
    parts.append(
        f"Plan the change: 2 to {MAX_FILES} files, each with an action of edit, create or delete and a concrete "
        "reason. Compose the primitives this repository already has rather than reimplementing them. Include "
        "every guard test or document whose claim the feature contradicts. Then write the acceptance criteria."
    )
    return "\n\n".join(parts)


LEADING_DOT_SLASH_RE = re.compile(r"^(?:\./)+")


def _relative(path: str) -> str:
    """Strip a leading `./` and nothing else.

    `lstrip("./")` strips those two characters in any order, which turns `../../etc/passwd` into
    `etc/passwd` and `.git/config` into `git/config`: it rewrites a traversal into a plausible path
    instead of leaving it recognisable for the guard below to reject.
    """
    return LEADING_DOT_SLASH_RE.sub("", path.strip())


def _planned_files(raw: dict[str, object], root: Path, tree: list[str]) -> list[PlannedFile]:
    """Read the model's file list into planned files, dropping what it cannot mean."""
    existing = set(tree)
    files: list[PlannedFile] = []
    for item in raw.get("files", []) or []:
        if not isinstance(item, dict):
            continue
        path = _relative(str(item.get("path", "")))
        if not path or path in {f.path for f in files}:
            continue
        try:
            # A path is model output. Reject a traversal here rather than at apply time, because
            # the commit builder writes paths straight into the tree without another check.
            applier.safe_join(root, path)
        except applier.UnsafePath:
            continue
        action = str(item.get("action", "") or "").strip().lower()
        if action not in {"edit", "create", "delete"}:
            action = "create" if path not in existing else "edit"
        on_disk = (root / path).exists()
        # The action has to agree with the clone: a "create" of a file that is there is an edit,
        # and neither a create nor a delete of a file that is not there means anything.
        if action == "create" and on_disk:
            action = "edit"
        elif action == "edit" and not on_disk:
            action = "create"
        elif action == "delete" and not on_disk:
            continue
        files.append(PlannedFile(path=path, reason=str(item.get("reason", "")).strip(), action=action))
    return _cap(files, MAX_FILES)


def _cap(files: list[PlannedFile], limit: int) -> list[PlannedFile]:
    """Truncate to the limit, but never drop a deletion.

    The cap makes the architect prioritise, and a guard test that contradicts the feature loses that
    contest to a documentation edit more often than it should. A deletion is never garnish: it is
    always there because the file asserts something the change makes false, so shipping without it
    ships the feature next to the test that forbids it.
    """
    if len(files) <= limit:
        return files
    kept = files[:limit]
    dropped = [planned for planned in files[limit:] if planned.is_delete]
    if not dropped:
        return kept
    # Give up the lowest-priority entries the model listed, from the tail, keeping its own order.
    room = [index for index in reversed(range(len(kept))) if not kept[index].is_delete]
    for planned in dropped:
        if not room:
            break
        kept[room.pop(0)] = planned
    order = {planned.path: index for index, planned in enumerate(files)}
    return sorted(kept, key=lambda planned: order[planned.path])


def plan_changes(root: Path, req: FeatureRequestInput, issue_title: str, issue_body: str) -> tuple[Plan, str]:
    """Ask the architect for a plan; returns the plan and a one-line summary of the input for the trace.

    A model that answers with no files has refused the task rather than failed at it, which one
    retry with the refusal named usually settles. A second empty answer raises, carrying the
    model's own words, so the trace says why nothing was planned instead of only that nothing was.
    """
    tree = repo.list_source_files(root)
    terms = repo.keywords(req.title, req.description, req.area)
    agents_md = repo.read_file(root, "AGENTS.md") or ""
    referenced = repo.referenced_paths(tree, agents_md)
    contents = relevant_files(root, tree, terms, agents_md, referenced=referenced)
    prompt = build_architect_prompt(
        req, issue_title, issue_body, agents_md, tree, contents, dependency_block(root), referenced
    )

    raw = llm.complete_json(llm.ARCHITECT_MODEL, ARCHITECT_SYSTEM, prompt, "change_plan", PLAN_SCHEMA)
    files = _planned_files(raw, root, tree)
    attempts = 1
    if not files:
        refusal = str(raw.get("summary", "")).strip()
        retry_prompt = f"{prompt}\n\n# Your previous answer\n\n{refusal}\n\n{RETRY_INSTRUCTION}"
        raw = llm.complete_json(llm.ARCHITECT_MODEL, ARCHITECT_SYSTEM, retry_prompt, "change_plan", PLAN_SCHEMA)
        files = _planned_files(raw, root, tree)
        attempts = 2
        if not files:
            raise RuntimeError(
                "the architect returned no files after two attempts. It said: "
                + (str(raw.get("summary", "")).strip() or refusal or "(no summary)")
            )

    plan = Plan(
        files=files,
        acceptance_criteria=[str(c).strip() for c in raw.get("acceptance_criteria", []) if str(c).strip()],
        summary=str(raw.get("summary", "")).strip(),
        base_sha=repo.head_sha(root),
    )
    input_summary = (
        f"{len(tree)} files in tree, {len(contents)} read in full, "
        f"AGENTS.md {'present' if agents_md else 'missing'}"
        + (f", {attempts} attempts" if attempts > 1 else "")
    )
    return plan, input_summary


def _plan_block(plan: Plan) -> str:
    lines = [f"- {f.path} ({f.action}): {f.reason}" for f in plan.files]
    criteria = "\n".join(f"- {c}" for c in plan.acceptance_criteria)
    return f"Plan summary: {plan.summary}\n\nFiles in this change:\n" + "\n".join(lines) + f"\n\nAcceptance criteria:\n{criteria}"


def _context_block(context: dict[str, str]) -> str:
    if not context:
        return ""
    blocks = [f"## {path} (current contents, for reference only)\n{content}" for path, content in context.items()]
    return "# Other files in this change\n\n" + "\n\n".join(blocks)


def draft_file(
    req: FeatureRequestInput,
    issue_title: str,
    issue_body: str,
    plan: Plan,
    target: PlannedFile,
    existing: str | None,
    agents_md: str,
    context: dict[str, str],
    dependencies: str = "",
) -> str:
    """Ask the editor for the whole new contents of one file."""
    parts = [_issue_block(req, issue_title, issue_body), "# Repository conventions (AGENTS.md)\n\n" + agents_md.strip()]
    if dependencies:
        parts.append("# " + dependencies)
    parts.append("# Change plan\n\n" + _plan_block(plan))
    context_block = _context_block(context)
    if context_block:
        parts.append(context_block)
    if existing is None:
        parts.append(f"# Task\n\nCreate the new file `{target.path}`. Purpose: {target.reason}")
    else:
        parts.append(f"# Task\n\nRewrite `{target.path}`. Purpose: {target.reason}\n\nCurrent contents of `{target.path}`:\n{existing}")
    parts.append("Return only the complete file contents, no code fences, no commentary.")
    return strip_fences(llm.complete(llm.EDITOR_MODEL, EDITOR_SYSTEM, "\n\n".join(parts)))


def repair_file(
    target_path: str,
    current: str,
    error_output: str,
    agents_md: str,
    context: dict[str, str],
    dependencies: str = "",
    own_new_tests: list[str] | None = None,
) -> str:
    """Feed a failing gate back to the editor for one file.

    `own_new_tests` names the test files this change itself added that the gate is failing on. They
    are not a requirement the repository set: they are part of the change under review, so the
    editor is told so and may correct either the test or the code it exercises. Without that it
    treats its own draft test as fixed and keeps rewriting the wrong side.
    """
    parts = ["# Repository conventions (AGENTS.md)\n\n" + agents_md.strip()]
    if dependencies:
        parts.append("# " + dependencies)
    context_block = _context_block(context)
    if context_block:
        parts.append(context_block)
    parts.append(
        f"# Task\n\nThe build gate failed with the output below. Fix `{target_path}` so that the gate passes. "
        "Keep the feature intact. If a module cannot be found, it is not installed: remove that import and "
        "implement the same thing without it (inline SVG for icons, plain React state for logic).\n\nGate output:\n" + error_output[-6000:] + f"\n\nCurrent contents of `{target_path}`:\n{current}"
    )
    if own_new_tests:
        named = ", ".join(f"`{path}`" for path in own_new_tests)
        parts.append(
            f"# The failing test is one this change added\n\n{named} did not exist before this change, so it "
            "is not a requirement of the repository: it is part of the change under review, and the gate output "
            "above is its failing run. Decide which side is wrong and fix that one - the test's expectations or "
            "the code they exercise - and keep the feature working. Do not delete the test and do not weaken it "
            "into one that asserts nothing."
        )
    parts.append("Return only the complete file contents, no code fences, no commentary.")
    return strip_fences(llm.complete(llm.EDITOR_MODEL, EDITOR_SYSTEM, "\n\n".join(parts)))

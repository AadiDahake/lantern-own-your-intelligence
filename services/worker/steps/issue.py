"""Builds the GitHub issue text from a feature request, and the labels that go with it."""

from __future__ import annotations

import re

from models import FeatureRequestInput
from steps import llm

FOOTER = "Filed by Lantern after the documentation, page and repository checks found no such feature."
AUTO_FOOTER = (
    "Detected by Lantern in support conversations. Nobody asked for it to be filed: the "
    "documentation, page and repository checks found no such feature, so it was recorded here."
)
LABEL = "lantern"
AUTO_LABEL = "auto-detected"

PRIORITIES = ("low", "medium", "high")
DEFAULT_PRIORITY = "medium"

PRIORITY_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {"type": "string", "enum": list(PRIORITIES)},
        "reason": {"type": "string"},
    },
    "required": ["priority", "reason"],
    "additionalProperties": False,
}

PRIORITY_SYSTEM = """You triage feature requests for a small product team.
Given one request, choose its priority.
- high: users cannot do their work without it, or it blocks a common flow.
- medium: a real gap that users hit regularly and can work around.
- low: a nice improvement nobody is blocked on.
Be conservative: high is rare. Answer with JSON only."""

# The two lines that carry a request's weight, so a repeatedly requested feature shows it at a glance.
REQUEST_COUNT_RE = re.compile(r"Requested (\d+) times?(?:, (\d+) by users?)?", re.IGNORECASE)
PRIORITY_LINE_RE = re.compile(r"^Priority: (low|medium|high)$", re.IGNORECASE | re.MULTILINE)


def choose_priority(req: FeatureRequestInput) -> tuple[str, str]:
    """Ask the model how urgent this is. Returns (priority, reason); never raises."""
    try:
        result = llm.complete_json(
            llm.ARCHITECT_MODEL,
            PRIORITY_SYSTEM,
            f"Title: {req.title}\nDescription: {req.description}\nArea: {req.area}\n"
            f"What the user said: {req.quote}\nWhy it matters: {req.rationale}",
            "issue_priority",
            PRIORITY_SCHEMA,
        )
        priority = str(result.get("priority", "")).strip().lower()
        if priority in PRIORITIES:
            return priority, str(result.get("reason", "")).strip()
    except Exception:
        pass
    return DEFAULT_PRIORITY, "the model did not return a priority, so this fell back to medium"


def labels_for(priority: str, auto_detected: bool = False) -> list[str]:
    """Every Lantern issue carries the product label and its priority."""
    safe = priority if priority in PRIORITIES else DEFAULT_PRIORITY
    labels = [LABEL, f"priority:{safe}"]
    if auto_detected:
        labels.append(AUTO_LABEL)
    return labels


def count_line(report_count: int, user_report_count: int) -> str:
    """How much weight this request carries, in one line a maintainer can scan."""
    times = "time" if report_count == 1 else "times"
    users = "user" if user_report_count == 1 else "users"
    return f"Requested {report_count} {times}, {user_report_count} by {users}"


def set_request_counts(body: str, report_count: int, user_report_count: int) -> str:
    """Rewrite the count line to the group's own numbers, which are the authority."""
    line = count_line(report_count, user_report_count)
    if REQUEST_COUNT_RE.search(body or ""):
        return REQUEST_COUNT_RE.sub(line, body, count=1)
    separator = "" if not body or body.endswith("\n") else "\n"
    return f"{body}{separator}\n{line}\n"


def set_priority(body: str, priority: str) -> str:
    """Keep the priority line honest: a request that rose must not still read as low."""
    safe = priority if priority in PRIORITIES else DEFAULT_PRIORITY
    return PRIORITY_LINE_RE.sub(f"Priority: {safe}", body or "", count=1)


def bump_request_count(body: str) -> tuple[str, int]:
    """Raise the "Requested N times" line by one. Appends the line when the body has none."""
    match = REQUEST_COUNT_RE.search(body or "")
    if match:
        count = int(match.group(1)) + 1
        return REQUEST_COUNT_RE.sub(f"Requested {count} times", body, count=1), count
    count = 2
    separator = "" if not body or body.endswith("\n") else "\n"
    return f"{body}{separator}\nRequested {count} times\n", count


def default_acceptance_criteria(req: FeatureRequestInput) -> list[str]:
    return [
        f"{req.title.rstrip('.')} is available to users from the {req.area or 'relevant'} part of the product.",
        "The change follows the repository conventions in AGENTS.md.",
        "`npm run typecheck` and `npm run build` pass.",
    ]


def build_issue_body(
    req: FeatureRequestInput,
    acceptance_criteria: list[str] | None = None,
    priority: str = DEFAULT_PRIORITY,
) -> str:
    """The issue as the developers read it: what was asked, why, where, and how often."""
    criteria = acceptance_criteria or default_acceptance_criteria(req)
    lines = ["## What the user asked", ""]
    if req.quote:
        lines.append(f"> {req.quote.strip()}")
        lines.append("")
    lines.append(req.description.strip())
    lines += ["", "## Why it matters", "", (req.rationale or "A user asked for it and could not find it.").strip()]
    lines += ["", "## Where it belongs", "", (req.area or "To be decided by the maintainers.").strip()]
    lines += ["", "## Acceptance criteria", ""]
    lines += [f"- [ ] {item}" for item in criteria]
    if req.site_url:
        lines += ["", f"Site: {req.site_url}"]
    lines += ["", f"Priority: {priority}", "", count_line(req.report_count, req.user_report_count)]
    lines += ["", "---", AUTO_FOOTER if req.auto_detected() else FOOTER]
    return "\n".join(lines) + "\n"


def build_group_comment(req: FeatureRequestInput) -> str:
    """Left on the issue, and on the pull request, every time the same gap is reported again."""
    who = "A user asked for this again." if req.user_report_count else "The agent saw this again."
    lines = [f"{who} {count_line(req.report_count, req.user_report_count)}."]
    if req.quote:
        lines += ["", f"> {req.quote.strip()}"]
    lines += ["", f"Priority is now {req.priority or DEFAULT_PRIORITY}.", "", "---"]
    lines.append(AUTO_FOOTER if req.auto_detected() else FOOTER)
    return "\n".join(lines) + "\n"


def build_duplicate_comment(req: FeatureRequestInput, count: int | None = None) -> str:
    body = "Another user asked for this." if count is None else f"Another user asked for this. Requested {count} times."
    if req.quote:
        body += f"\n\n> {req.quote.strip()}"
    body += f"\n\n{req.description.strip()}\n\n---\n{FOOTER}"
    return body


def build_pr_body(
    req: FeatureRequestInput,
    issue_number: int,
    changed: list[str],
    criteria: list[str],
    summary: str,
    deleted: list[str] | None = None,
) -> str:
    """The pull request body: what was asked for, how many people asked, and what this touches."""
    removed = deleted or []
    lines = [f"Closes #{issue_number}", "", "## The request", ""]
    lines.append(f"**{req.title.strip()}**")
    if req.quote.strip():
        lines += ["", f"> {req.quote.strip()}"]
    lines += ["", count_line(req.report_count, req.user_report_count) + "."]
    lines += ["", "## What changed", ""]
    lines.append(summary.strip() or req.description.strip())
    lines += ["", "Files:", ""]
    lines += [f"- `{path}`" for path in changed]
    lines += [f"- `{path}` (deleted)" for path in removed]
    lines += ["", "## How to test", ""]
    lines += [f"- {item.lstrip('- ').strip()}" for item in criteria] or ["- Run the app and try the feature."]
    lines += ["", "---", "Drafted by Lantern from a user request. A maintainer reviews and approves before merge."]
    return "\n".join(lines) + "\n"


def build_gate_comment(gates: list[tuple[str, bool, float]], activity_url: str) -> str:
    """The comment left on the draft PR: what the gates did, and where to watch the rest."""
    lines = ["Lantern ran the repository's own gates against this branch before opening it.", "", "| Gate | Result | Duration |", "| --- | --- | --- |"]
    for name, ok, seconds in gates:
        lines.append(f"| `{name}` | {'passed' if ok else 'failed'} | {seconds:.0f}s |")
    lines += ["", f"Follow the rest of this change on the [Lantern activity page]({activity_url})."]
    return "\n".join(lines) + "\n"

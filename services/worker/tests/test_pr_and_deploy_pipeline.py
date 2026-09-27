"""What the trace shows once the pull request exists, and what a stalled deployment does to a run."""

import pytest
import responses

from models import Approval, Draft, FeatureRequestInput, GateOutcome, IssueRef, Plan, PlannedFile, PrRef
from steps import db, deploy, mcp_github, pipeline, slack

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"


@pytest.fixture
def req() -> FeatureRequestInput:
    return FeatureRequestInput(
        escalation_id="e1", project_id="p1", repo_full_name="AadiDahake/novaair-own-your-intelligence",
        title="Enable seat selection for families traveling",
        description="Find three seats together.", report_count=3, user_report_count=1,
    )


@pytest.fixture
def rows(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str]]:
    """Collect the trace as (kind, status, title), which is the order a reader sees."""
    written: list[tuple[str, str, str]] = []

    def fake_emit(project_id, escalation_id, kind, title, status="ok", detail=None, **_kwargs):  # type: ignore[no-untyped-def]
        written.append((kind, status, title))
        return len(written)

    monkeypatch.setattr(db, "emit_trace", fake_emit)
    monkeypatch.setattr(db, "update_escalation", lambda *a, **k: None)
    monkeypatch.setattr(db, "update_group", lambda *a, **k: None)
    monkeypatch.setattr(slack, "notify", lambda _text: True)
    return written


def _plan() -> Plan:
    return Plan(
        files=[
            PlannedFile(path="lib/seats/together.ts", reason="find the group", action="create"),
            PlannedFile(path="tests/no-group-seating.test.ts", reason="asserts the absence", action="delete"),
        ],
        acceptance_criteria=["Three seats together are found."],
        summary="Adds automatic family seat selection.",
        base_sha="parent1",
    )


def _draft() -> Draft:
    return Draft(
        files={"lib/seats/together.ts": "export const x = 1\n"},
        deletions=["tests/no-group-seating.test.ts"],
        summary="Adds automatic family seat selection.",
        base_sha="parent1",
        gates=[GateOutcome(name="npm run typecheck", ok=True, duration_s=9.0),
               GateOutcome(name="npm run build", ok=True, duration_s=41.0)],
    )


@responses.activate
def test_the_trace_ends_with_the_pr_row_and_the_approve_card(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The last thing a reader sees is the pull request, then the card asking them to decide."""
    responses.get(f"{API}/git/commits/parent1", json={"tree": {"sha": "tree0"}})
    responses.post(f"{API}/git/blobs", json={"sha": "blob1"})
    responses.post(f"{API}/git/trees", json={"sha": "tree1"})
    responses.post(f"{API}/git/commits", json={"sha": "commit1"})
    responses.get(f"{API}/git/ref/heads/lantern/7-enable-seat-selection-for-families-trave", status=404, json={"message": "Not Found"})
    responses.post(f"{API}/git/refs", json={"ref": "refs/heads/x"})
    responses.get(f"{API}/pulls", json=[])
    responses.post(f"{API}/issues/31/comments", json={"html_url": "https://github.com/x"})
    monkeypatch.setattr(
        mcp_github, "open_draft_pr_with_fallback",
        lambda *a, **k: ({"number": 31, "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/31", "node_id": "PR_31"}, "rest", "created"),
    )

    ref = pipeline.open_draft_pr(req, IssueRef(number=7, url="u", title="t"), _plan(), _draft())

    assert ref.number == 31
    assert [(kind, title) for kind, _status, title in rows][-2:] == [
        ("artifact", "Opened draft pull request #31"),
        ("pause", pipeline.PAUSE_LABEL),
    ]
    assert rows[-1][1] == "running"  # the pause card is what the console waits on


@responses.activate
def test_a_stalled_deployment_is_a_status_and_not_a_failed_run(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The merge landed. Only the watch ran out, so the run says that and stops."""
    responses.post(f"{API}/issues/31/comments", json={"html_url": "https://github.com/x"})
    responses.get(f"{API}/pulls/31", json={"number": 31, "mergeable": True, "node_id": "PR_31"})
    responses.put(f"{API}/pulls/31/merge", json={"sha": "merge1"})
    responses.post("https://api.github.com/graphql", json={"data": {"markPullRequestReadyForReview": {"pullRequest": {"isDraft": False}}}})

    def timeout(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise deploy.DeploymentTimeout("no READY deployment of merge1 in novaair after 600s (last state: BUILDING)")

    monkeypatch.setattr(deploy, "wait_for_deployment", timeout)

    outcome = pipeline.merge_and_deploy(
        req, IssueRef(number=7, url="u", title="t"),
        PrRef(number=31, url="https://github.com/AadiDahake/novaair-own-your-intelligence/pull/31", branch="b", node_id="PR_31"),
        Approval(approved=True),
    )

    assert outcome.status == "merged"
    assert outcome.merge_sha == "merge1"
    kinds = [kind for kind, _status, _title in rows]
    assert "error" not in kinds
    last_kind, last_status, last_title = rows[-1]
    assert last_kind == "status" and last_status == "failed"
    assert "Stopped watching for the deployment of merge1" in last_title
    assert "10 minutes" in last_title

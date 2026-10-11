"""What the trace shows once the pull request exists, and what a stalled deployment does to a run."""

import pytest
import responses

from models import Approval, Draft, FeatureRequestInput, GateOutcome, IssueRef, Plan, PlannedFile, PrRef
from steps import db, deploy, mcp_github, pipeline, slack, sms_notice
from steps.sms_notice import NoticeOutcome

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


def _github_takes_a_draft_pr(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every GitHub answer `open_draft_pr` needs to push the branch and open pull request 31."""
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


@responses.activate
def test_the_trace_ends_with_the_pr_row_and_the_approve_card(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The last thing a reader sees is the pull request, then the card asking them to decide."""
    _github_takes_a_draft_pr(monkeypatch)

    ref = pipeline.open_draft_pr(req, IssueRef(number=7, url="u", title="t"), _plan(), _draft())

    assert ref.number == 31
    assert [(kind, title) for kind, _status, title in rows][-2:] == [
        ("artifact", "Opened draft pull request #31"),
        ("pause", pipeline.PAUSE_LABEL),
    ]
    assert rows[-1][1] == "running"  # the pause card is what the console waits on


@responses.activate
def test_the_trace_says_that_the_text_notice_is_off_before_the_pr_row(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no provider configured the run is the same as before, plus the one row that says so."""
    _github_takes_a_draft_pr(monkeypatch)

    pipeline.open_draft_pr(req, IssueRef(number=7, url="u", title="t"), _plan(), _draft())

    assert [(status, title) for _kind, status, title in rows][-4:] == [
        ("ok", "Text notice: off"),
        ("ok", "Status: awaiting approval"),
        ("ok", "Opened draft pull request #31"),
        ("running", pipeline.PAUSE_LABEL),
    ]
    # With the notice off, no subscriber is read and no text is sent.
    called = [call.request.url for call in responses.calls]
    assert called and not any("gap_subscriber" in url or "getdial" in url for url in called)


@responses.activate
def test_the_people_who_asked_are_texted_once_the_pull_request_is_open(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The notice is for this run's project and gap, and a text that fails never fails the run."""
    _github_takes_a_draft_pr(monkeypatch)
    order: list[str] = []
    monkeypatch.setattr(db, "update_group", lambda _id, **fields: order.append(f"group {fields.get('status')}"))

    def notice(project_id: str, group_id: str) -> NoticeOutcome:
        order.append(f"notice {project_id} {group_id}")
        return NoticeOutcome("done", asked=3, sent=2, unconfirmed=1, reasons=("timeout",))

    monkeypatch.setattr(sms_notice, "draft_notice", notice)
    grouped = req.model_copy(update={"group_id": "g1"})

    ref = pipeline.open_draft_pr(grouped, IssueRef(number=7, url="u", title="t"), _plan(), _draft())

    assert ref.number == 31
    # The group says that the pull request is open before anyone is told about it.
    assert order == ["group pr_open", "notice p1 g1", "group awaiting_approval"]
    assert ("status", "failed", "Text notice: 2 of 3 sent") in rows
    assert [title for _kind, _status, title in rows][-2:] == ["Opened draft pull request #31", pipeline.PAUSE_LABEL]


@responses.activate
def test_a_notice_row_that_cannot_be_written_does_not_stop_the_run(
    req: FeatureRequestInput, rows: list[tuple[str, str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pull request is open. Losing the row about the texts must not lose the approve card."""
    _github_takes_a_draft_pr(monkeypatch)
    record = db.emit_trace

    def flaky(project_id, escalation_id, kind, title, status="ok", detail=None, **kwargs):  # type: ignore[no-untyped-def]
        if title.startswith("Text notice"):
            raise RuntimeError("PostgREST 503: not now")
        return record(project_id, escalation_id, kind, title, status, detail, **kwargs)

    monkeypatch.setattr(db, "emit_trace", flaky)

    ref = pipeline.open_draft_pr(req, IssueRef(number=7, url="u", title="t"), _plan(), _draft())

    assert ref.number == 31
    titles = [title for _kind, _status, title in rows]
    assert not any(title.startswith("Text notice") for title in titles)
    assert titles[-2:] == ["Opened draft pull request #31", pipeline.PAUSE_LABEL]


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

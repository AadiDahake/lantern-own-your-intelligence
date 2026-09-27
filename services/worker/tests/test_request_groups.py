"""Grouped requests: the count line, the labels, the issue-only run and the update run."""

import json

import pytest
import responses

from models import FeatureRequestInput
from steps import db, issue as issue_text, mcp_github, pipeline, slack, trace

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"


def _req(**over: object) -> FeatureRequestInput:
    fields: dict[str, object] = {
        "escalation_id": "e1",
        "project_id": "p1",
        "repo_full_name": "AadiDahake/novaair-own-your-intelligence",
        "title": "Add dark mode",
        "description": "Users want a dark theme for the console.",
        "area": "Header / appearance",
        "quote": "How do I turn on dark mode?",
        "group_id": "g1",
        "priority": "low",
        "report_count": 1,
        "user_report_count": 0,
    }
    fields.update(over)
    return FeatureRequestInput(**fields)  # type: ignore[arg-type]


@pytest.fixture
def quiet(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """Silence the database, the trace and Slack, and collect what they were told."""
    seen: dict[str, object] = {"slack": [], "escalation": [], "group": []}
    monkeypatch.setattr(db, "emit_trace", lambda *a, **k: None)
    # The group has no issue yet and this run wins its issue slot, which is the ordinary case.
    monkeypatch.setattr(db, "get_group", lambda group_id: {"id": group_id, "issue_number": None})
    monkeypatch.setattr(db, "claim_issue_slot", lambda group_id, escalation_id: True)
    monkeypatch.setattr(db, "release_issue_slot", lambda group_id, escalation_id: None)
    monkeypatch.setattr(trace, "issue_draft", lambda *a, **k: None)
    monkeypatch.setattr(trace, "issue", lambda *a, **k: None)
    monkeypatch.setattr(trace, "status", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_set_status", lambda *a, **k: None)
    monkeypatch.setattr(
        db, "update_escalation",
        lambda escalation_id, **fields: seen["escalation"].append(fields),  # type: ignore[union-attr]
    )
    monkeypatch.setattr(
        db, "update_group",
        lambda group_id, **fields: seen["group"].append(fields),  # type: ignore[union-attr]
    )
    monkeypatch.setattr(slack, "notify", lambda text: seen["slack"].append(text) or True)  # type: ignore[union-attr]
    return seen


def test_count_line_reads_as_a_sentence() -> None:
    assert issue_text.count_line(1, 0) == "Requested 1 time, 0 by users"
    assert issue_text.count_line(3, 1) == "Requested 3 times, 1 by user"
    assert issue_text.count_line(7, 2) == "Requested 7 times, 2 by users"


def test_set_request_counts_rewrites_rather_than_increments() -> None:
    body = issue_text.build_issue_body(_req(report_count=1))
    raised = issue_text.set_request_counts(body, 4, 2)
    assert "Requested 4 times, 2 by users" in raised
    assert "Requested 1 time," not in raised
    # It also survives the older wording, which had no user count at all.
    assert "Requested 5 times, 1 by user" in issue_text.set_request_counts("Requested 2 times", 5, 1)
    appended = issue_text.set_request_counts("An issue somebody filed by hand.", 2, 0)
    assert appended.rstrip().endswith("Requested 2 times, 0 by users")


def test_an_undetected_request_is_labelled_and_footed_as_such() -> None:
    req = _req()
    assert req.auto_detected() is True
    assert issue_text.labels_for("low", auto_detected=True) == ["lantern", "priority:low", "auto-detected"]
    body = issue_text.build_issue_body(req, priority="low")
    assert issue_text.AUTO_FOOTER in body
    assert "Requested 1 time, 0 by users" in body

    reported = _req(user_report_count=1, priority="medium")
    assert reported.auto_detected() is False
    assert issue_text.labels_for("medium") == ["lantern", "priority:medium"]
    assert issue_text.FOOTER in issue_text.build_issue_body(reported)


def test_set_priority_keeps_the_priority_line_honest() -> None:
    body = issue_text.build_issue_body(_req(), priority="low")
    assert "Priority: high" in issue_text.set_priority(body, "high")
    assert "Priority: medium" in issue_text.set_priority(body, "nonsense")


def test_group_comment_carries_the_new_quote_and_the_weight() -> None:
    comment = issue_text.build_group_comment(_req(report_count=3, user_report_count=1, priority="medium"))
    assert "Requested 3 times, 1 by user" in comment
    assert "> How do I turn on dark mode?" in comment
    assert "Priority is now medium" in comment


@responses.activate
def test_an_issue_only_run_files_the_issue_and_stops(quiet: dict[str, object], monkeypatch: pytest.MonkeyPatch) -> None:
    filed: dict[str, object] = {}

    def fake_file_issue(repo_full_name, title, body, labels, rest=None):  # type: ignore[no-untyped-def]
        filed["labels"] = labels
        filed["body"] = body
        return {"number": 9, "url": f"https://github.com/{repo_full_name}/issues/9", "transport": "mcp", "args_summary": "", "result_summary": ""}

    monkeypatch.setattr(mcp_github, "file_issue_with_model", fake_file_issue)
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Alow", json={"name": "priority:low"})
    responses.get(f"{API}/labels/auto-detected", json={"name": "auto-detected"})
    responses.get(f"{API}/issues", json=[])

    ref = pipeline.file_issue(_req(file_only=True))

    assert ref.number == 9 and ref.priority == "low"
    assert filed["labels"] == ["lantern", "priority:low", "auto-detected"]
    assert issue_text.AUTO_FOOTER in str(filed["body"])
    # The group is filed, and the run that filed it is over: nothing drafted a change.
    assert {"issue_url", "issue_number", "priority", "status"} <= set(quiet["group"][-1])  # type: ignore[index]
    assert quiet["group"][-1]["status"] == "filed"  # type: ignore[index]
    assert quiet["escalation"][-1] == {"status": "filed"}  # type: ignore[index]


@responses.activate
def test_an_update_run_raises_the_count_everywhere_and_opens_nothing(
    quiet: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        db, "get_group",
        lambda group_id: {
            "id": "g1",
            "issue_number": 3,
            "pr_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/12",
        },
    )
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Ahigh", json={"name": "priority:high"})
    responses.get(
        f"{API}/issues/3",
        json={"number": 3, "body": "Priority: low\n\nRequested 3 times, 1 by user\n", "html_url": f"https://github.com/AadiDahake/novaair-own-your-intelligence/issues/3"},
    )
    responses.patch(f"{API}/issues/3", json={"number": 3})
    responses.put(f"{API}/issues/3/labels", json=[{"name": "lantern"}])
    responses.post(f"{API}/issues/3/comments", json={"html_url": "https://github.com/x/issues/3#c1"})
    responses.post(f"{API}/issues/12/comments", json={"html_url": "https://github.com/x/pull/12#c1"})

    outcome = pipeline.update_group(_req(report_count=4, user_report_count=2, priority="high"))

    assert outcome.status == "updated"
    posted = [call for call in responses.calls if call.request.method == "POST"]
    assert [call.request.url for call in posted] == [
        f"{API}/issues/3/comments",
        f"{API}/issues/12/comments",
    ]
    body = json.loads(next(c for c in responses.calls if c.request.method == "PATCH").request.body)["body"]
    assert "Requested 4 times, 2 by users" in body
    # A request that rose must not still read as low priority.
    assert "Priority: high" in body and "Priority: low" not in body
    labels = json.loads(next(c for c in responses.calls if c.request.method == "PUT").request.body)["labels"]
    assert labels == ["lantern", "priority:high"]
    assert "Requested 4 times, 2 by users" in json.loads(posted[0].request.body)["body"]
    assert quiet["escalation"][-1]["status"] == "updated"  # type: ignore[index]


@responses.activate
def test_an_update_run_files_the_issue_when_the_first_run_has_not_landed(
    quiet: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(db, "get_group", lambda group_id: {"id": "g1", "issue_number": None, "pr_url": None})
    monkeypatch.setattr(
        mcp_github, "file_issue_with_model",
        lambda repo_full_name, title, body, labels, rest=None: {
            "number": 9, "url": "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/9",
            "transport": "rest", "args_summary": "", "result_summary": "",
        },
    )
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Alow", json={"name": "priority:low"})
    responses.get(f"{API}/labels/auto-detected", json={"name": "auto-detected"})
    responses.get(f"{API}/issues", json=[])

    outcome = pipeline.update_group(_req(report_count=2))

    assert outcome.status == "updated"
    assert outcome.issue_url.endswith("/issues/9")

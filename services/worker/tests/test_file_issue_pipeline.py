"""`file_issue` end to end against a fake GitHub: labels, priority, dedupe counting, Slack."""

import json

import pytest
import responses

from models import FeatureRequestInput
from steps import db, issue as issue_text, mcp_github, pipeline, slack, trace
from steps.github import GitHubClient

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"


@pytest.fixture
def req() -> FeatureRequestInput:
    return FeatureRequestInput(
        escalation_id="e1",
        project_id="p1",
        repo_full_name="AadiDahake/novaair-own-your-intelligence",
        title="Add dark mode",
        description="Users want a dark theme for the console.",
        area="Header / appearance",
        quote="How do I turn on dark mode?",
    )


@pytest.fixture
def quiet(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Silence the database and the trace, and collect what would have gone to Slack."""
    posted: list[str] = []
    monkeypatch.setattr(db, "update_escalation", lambda *a, **k: None)
    monkeypatch.setattr(db, "emit_trace", lambda *a, **k: None)
    monkeypatch.setattr(trace, "issue_draft", lambda *a, **k: None)
    monkeypatch.setattr(trace, "issue", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_set_status", lambda *a, **k: None)
    monkeypatch.setattr(slack, "notify", lambda text: posted.append(text) or True)
    monkeypatch.setattr(issue_text, "choose_priority", lambda _req: ("high", "it blocks a common flow"))
    return posted


@responses.activate
def test_new_issue_gets_both_labels(req: FeatureRequestInput, quiet: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    filed: dict[str, object] = {}

    def fake_file_issue(repo_full_name, title, body, labels, rest=None):  # type: ignore[no-untyped-def]
        filed["labels"] = labels
        filed["body"] = body
        return {"number": 9, "url": f"https://github.com/{repo_full_name}/issues/9", "transport": "mcp", "args_summary": "", "result_summary": ""}

    monkeypatch.setattr(mcp_github, "file_issue_with_model", fake_file_issue)
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Ahigh", status=404, json={"message": "Not Found"})
    responses.post(f"{API}/labels", json={"name": "priority:high"})
    responses.get(f"{API}/issues", json=[])

    ref = pipeline.file_issue(req)

    assert ref.number == 9 and ref.priority == "high" and ref.deduplicated is False
    assert filed["labels"] == ["lantern", "priority:high"]
    assert "Priority: high" in str(filed["body"])
    assert quiet and "high priority" in quiet[0]


@responses.activate
def test_duplicate_issue_is_counted_and_quoted(req: FeatureRequestInput, quiet: list[str]) -> None:
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Ahigh", json={"name": "priority:high"})
    responses.get(
        f"{API}/issues",
        json=[{"number": 3, "title": "Add dark mode", "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/3"}],
    )
    responses.get(f"{API}/issues/3", json={"number": 3, "body": "Priority: high\n\nRequested 2 times\n"})
    responses.patch(f"{API}/issues/3", json={"number": 3})
    responses.post(f"{API}/issues/3/comments", json={"html_url": "https://github.com/x/issues/3#c1"})

    ref = pipeline.file_issue(req)

    assert ref.deduplicated is True and ref.number == 3 and ref.request_count == 3
    patched = json.loads(next(c for c in responses.calls if c.request.method == "PATCH").request.body)
    assert "Requested 3 times" in patched["body"]
    comment = json.loads(responses.calls[-1].request.body)["body"]
    assert "Requested 3 times" in comment and "> How do I turn on dark mode?" in comment
    assert quiet and "requested 3 times" in quiet[0]


@responses.activate
def test_draft_pr_reports_the_gates_and_links_to_the_console(
    req: FeatureRequestInput, quiet: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from models import Draft, GateOutcome, IssueRef, Plan

    monkeypatch.setenv("NEXT_PUBLIC_APP_URL", "https://console.example.com")
    monkeypatch.setattr(trace, "pr", lambda *a, **k: None)
    monkeypatch.setattr(trace, "pause", lambda *a, **k: None)
    monkeypatch.setattr(GitHubClient, "push_files", lambda self, *a, **k: "commit1")
    monkeypatch.setattr(
        mcp_github,
        "open_draft_pr_with_fallback",
        lambda *a, **k: ({"number": 12, "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/12", "node_id": "PR_1"}, "rest", "created"),
    )
    responses.get(f"{API}/pulls", json=[])
    responses.post(f"{API}/issues/12/comments", json={"html_url": "https://github.com/x/pull/12#c1"})

    issue = IssueRef(number=3, url="https://github.com/AadiDahake/novaair-own-your-intelligence/issues/3", title=req.title)
    plan = Plan(files=[], acceptance_criteria=["The toggle appears in the header."], summary="Adds a theme toggle.")
    draft = Draft(
        files={"components/ThemeToggle.tsx": "export const x = 1;\n"},
        base_sha="parent1",
        gates=[
            GateOutcome(name="npm run typecheck", ok=True, duration_s=11.6),
            GateOutcome(name="npm run build", ok=True, duration_s=47.2),
        ],
    )

    ref = pipeline.open_draft_pr(req, issue, plan, draft)

    assert ref.number == 12
    comment = json.loads(responses.calls[-1].request.body)["body"]
    assert "| `npm run typecheck` | passed | 12s |" in comment
    assert "| `npm run build` | passed | 47s |" in comment
    assert "https://console.example.com/console/activity" in comment
    assert quiet and "waiting for approval" in quiet[0]

"""One reported gap is one GitHub issue, whatever order the runs reach GitHub in.

The night this was written, two runs for group a9619dda overlapped by four seconds: the first
filed issue #18 and the second, which had read the group a moment earlier and seen no issue
number, filed #19 for the same request. When the same two runs happened to be one second apart the
second one reused the issue, so the repository's second issue depended on nothing but timing.

The tests below drive that race directly: a fake group row that gains its `issue_number` only
after the first run files, and a second run that starts while the first is still filing.
"""

from __future__ import annotations

import threading

import pytest
import responses

from models import FeatureRequestInput
from steps import db, issue as issue_text, mcp_github, pipeline, slack, trace
from steps.github import GitHubClient

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"
GROUP = "a9619dda"


class FakeGroups:
    """The one group row both runs read and write, with a lock where the database has a row lock."""

    def __init__(self) -> None:
        self.row: dict[str, object] = {
            "id": GROUP,
            "status": "observed",
            "issue_number": None,
            "issue_url": None,
            "pr_url": None,
            "issue_claim": None,
        }
        self._lock = threading.Lock()

    def get(self, group_id: str) -> dict[str, object]:
        with self._lock:
            return dict(self.row)

    def update(self, group_id: str, **fields: object) -> dict[str, object]:
        with self._lock:
            self.row.update(fields)
            return dict(self.row)

    def claim(self, group_id: str, escalation_id: str) -> bool:
        """`PATCH ?issue_claim=is.null&issue_number=is.null`: one UPDATE, so one winner."""
        with self._lock:
            if self.row["issue_claim"] is not None or self.row["issue_number"] is not None:
                return False
            self.row["issue_claim"] = escalation_id
            return True

    def release(self, group_id: str, escalation_id: str) -> None:
        with self._lock:
            if self.row["issue_claim"] == escalation_id:
                self.row["issue_claim"] = None


def _req(escalation_id: str, **over: object) -> FeatureRequestInput:
    fields: dict[str, object] = {
        "escalation_id": escalation_id,
        "project_id": "p1",
        "repo_full_name": "AadiDahake/novaair-own-your-intelligence",
        "title": "Find seats together for a party",
        "description": "Let a family take three seats side by side in one move.",
        "area": "seats",
        "quote": "Can you find us three seats together?",
        "group_id": GROUP,
        "priority": "medium",
        "report_count": 2,
        "user_report_count": 1,
    }
    fields.update(over)
    return FeatureRequestInput(**fields)


@pytest.fixture
def groups(monkeypatch: pytest.MonkeyPatch) -> FakeGroups:
    """The group table, the trace and Slack, all in memory."""
    store = FakeGroups()
    monkeypatch.setattr(db, "get_group", store.get)
    monkeypatch.setattr(db, "update_group", store.update)
    monkeypatch.setattr(db, "claim_issue_slot", store.claim)
    monkeypatch.setattr(db, "release_issue_slot", store.release)
    monkeypatch.setattr(db, "update_escalation", lambda *a, **k: None)
    monkeypatch.setattr(db, "emit_trace", lambda *a, **k: None)
    monkeypatch.setattr(trace, "issue_draft", lambda *a, **k: None)
    monkeypatch.setattr(trace, "issue", lambda *a, **k: None)
    monkeypatch.setattr(pipeline, "_set_status", lambda *a, **k: None)
    monkeypatch.setattr(slack, "notify", lambda text: True)
    monkeypatch.setattr(issue_text, "choose_priority", lambda _req: ("medium", "a real gap"))
    monkeypatch.setattr(pipeline, "ISSUE_POLL_S", 0.01)
    return store


def _github_for(filed: list[int], next_number: list[int]) -> None:
    """Labels, an empty issue list, and a `create_issue` that hands out numbers in order."""
    responses.get(f"{API}/labels/lantern", json={"name": "lantern"})
    responses.get(f"{API}/labels/priority%3Amedium", json={"name": "priority:medium"})
    responses.get(f"{API}/issues", json=[])


@responses.activate
def test_the_second_run_joins_the_issue_the_first_one_is_filing(
    groups: FakeGroups, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The exact 03:07Z race: the report starts while the note's issue does not exist yet."""
    filed: list[str] = []
    started = threading.Event()
    release = threading.Event()

    def fake_file_issue(repo_full_name, title, body, labels, rest=None):  # type: ignore[no-untyped-def]
        # The first run is inside GitHub's create_issue call for as long as the test says so.
        filed.append(title)
        started.set()
        release.wait(timeout=5)
        return {
            "number": 18,
            "url": f"https://github.com/{repo_full_name}/issues/18",
            "transport": "rest",
            "args_summary": "",
            "result_summary": "",
        }

    monkeypatch.setattr(mcp_github, "file_issue_with_model", fake_file_issue)
    _github_for(filed, [18])
    responses.get(
        f"{API}/issues/18",
        json={
            "number": 18,
            "title": "Find seats together for a party",
            "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/18",
            "body": "Priority: medium\n\nRequested 1 time\n",
        },
    )
    responses.patch(f"{API}/issues/18", json={"number": 18})
    responses.put(f"{API}/issues/18/labels", json=[])
    responses.post(f"{API}/issues/18/comments", json={"html_url": f"{API}/issues/18#c1"})

    first: list[object] = []
    note = threading.Thread(target=lambda: first.append(pipeline.file_issue(_req("e9716276", file_only=True))))
    note.start()
    assert started.wait(timeout=5), "the first run never reached GitHub"

    # The user's report arrives four seconds later, while the first run is still filing.
    report = threading.Thread(target=lambda: release.set() or None)
    report.start()
    report.join()
    second = pipeline.file_issue(_req("960ac8c0"))
    note.join(timeout=5)

    # One issue, and the second run commented on it instead of opening its own.
    assert filed == ["Find seats together for a party"]
    assert second.number == 18 and second.deduplicated is True
    assert groups.row["issue_number"] == 18


@responses.activate
def test_a_run_that_loses_the_claim_never_files_its_own_issue(
    groups: FakeGroups, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The waiter adopts the number the winner writes rather than opening a second issue."""
    groups.row["issue_claim"] = "e9716276"

    def never(*args: object, **kwargs: object) -> None:
        raise AssertionError("a second issue was filed for the same group")

    monkeypatch.setattr(mcp_github, "file_issue_with_model", never)
    _github_for([], [])
    responses.get(
        f"{API}/issues/18",
        json={
            "number": 18,
            "title": "Find seats together for a party",
            "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/18",
            "body": "Priority: medium\n\nRequested 1 time\n",
        },
    )
    responses.patch(f"{API}/issues/18", json={"number": 18})
    responses.put(f"{API}/issues/18/labels", json=[])
    responses.post(f"{API}/issues/18/comments", json={"html_url": f"{API}/issues/18#c1"})

    # The holder of the claim files while the second run is waiting.
    def land() -> None:
        groups.update(GROUP, issue_number=18, issue_url=f"{API}/issues/18", issue_claim=None)

    threading.Timer(0.05, land).start()

    ref = pipeline.file_issue(_req("960ac8c0"))

    assert ref.number == 18 and ref.deduplicated is True


@responses.activate
def test_a_claim_that_never_files_is_taken_over_rather_than_waited_on_for_ever(
    groups: FakeGroups, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A run that died holding the slot must not stop the next report being recorded."""
    groups.row["issue_claim"] = "dead-run"
    monkeypatch.setattr(pipeline, "ISSUE_WAIT_S", 0.05)

    def fake_file_issue(repo_full_name, title, body, labels, rest=None):  # type: ignore[no-untyped-def]
        return {
            "number": 19,
            "url": f"https://github.com/{repo_full_name}/issues/19",
            "transport": "rest",
            "args_summary": "",
            "result_summary": "",
        }

    monkeypatch.setattr(mcp_github, "file_issue_with_model", fake_file_issue)
    _github_for([], [19])

    ref = pipeline.file_issue(_req("960ac8c0"))

    assert ref.number == 19
    assert groups.row["issue_number"] == 19

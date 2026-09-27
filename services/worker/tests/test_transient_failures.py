"""A blip on the wire must not cost a user their request.

Two escalations died one night because a single Supabase call raised
`HTTPSConnectionPool(...): Max retries exceeded` - one of them at `open_draft_pr`, after the pull
request it was recording had already been opened. The user was told their request could not be
built, and a pull request nobody could see was sitting in the repository.

So: transient failures are retried, a run whose pull request is already open is never marked
failed, and a run that really does fail says so in words and leaves the request open to be tried
again.
"""

from __future__ import annotations

import pytest
import requests
import responses

from models import FeatureRequestInput
from steps import db, pipeline, retry, trace

SUPABASE = "https://example.supabase.co/rest/v1"


def _req(**over: object) -> FeatureRequestInput:
    fields: dict[str, object] = {
        "escalation_id": "afb25429",
        "project_id": "p1",
        "repo_full_name": "AadiDahake/novaair-own-your-intelligence",
        "title": "Find seats together for a party",
        "description": "Let a family take three seats side by side in one move.",
        "group_id": "g1",
    }
    fields.update(over)
    return FeatureRequestInput(**fields)


# ---- (a) transient network errors ------------------------------------------


def test_a_dropped_connection_is_retried_rather_than_raised() -> None:
    attempts: list[int] = []

    def flaky(method: str, url: str, **kwargs: object) -> requests.Response:
        attempts.append(1)
        if len(attempts) < 3:
            raise requests.exceptions.ConnectionError("Max retries exceeded with url: /rest/v1/escalation")
        response = requests.Response()
        response.status_code = 200
        response._content = b"[]"
        return response

    original = requests.request
    try:
        requests.request = flaky  # type: ignore[assignment]
        response = retry.send("GET", f"{SUPABASE}/escalation", sleep=lambda _seconds: None)
    finally:
        requests.request = original  # type: ignore[assignment]

    assert len(attempts) == 3
    assert response.status_code == 200


def test_a_server_that_says_not_now_is_asked_again() -> None:
    codes = [503, 502, 200]

    def answering(method: str, url: str, **kwargs: object) -> requests.Response:
        response = requests.Response()
        response.status_code = codes.pop(0)
        response._content = b"[]"
        return response

    original = requests.request
    try:
        requests.request = answering  # type: ignore[assignment]
        response = retry.send("PATCH", f"{SUPABASE}/escalation", sleep=lambda _seconds: None)
    finally:
        requests.request = original  # type: ignore[assignment]

    assert response.status_code == 200 and codes == []


def test_an_answer_about_this_request_is_never_retried() -> None:
    """A 404 or a 422 is the server's answer, not a blip. Retrying it only delays the truth."""
    calls: list[str] = []

    def answering(method: str, url: str, **kwargs: object) -> requests.Response:
        calls.append(url)
        response = requests.Response()
        response.status_code = 422
        response._content = b"{}"
        return response

    original = requests.request
    try:
        requests.request = answering  # type: ignore[assignment]
        response = retry.send("POST", f"{SUPABASE}/escalation", sleep=lambda _seconds: None)
    finally:
        requests.request = original  # type: ignore[assignment]

    assert len(calls) == 1 and response.status_code == 422


def test_giving_up_raises_the_error_the_network_gave() -> None:
    def always(method: str, url: str, **kwargs: object) -> requests.Response:
        raise requests.exceptions.ConnectionError("Max retries exceeded with url: /rest/v1/escalation")

    original = requests.request
    try:
        requests.request = always  # type: ignore[assignment]
        with pytest.raises(requests.exceptions.ConnectionError):
            retry.send("GET", f"{SUPABASE}/escalation", attempts=2, sleep=lambda _seconds: None)
    finally:
        requests.request = original  # type: ignore[assignment]


@responses.activate
def test_the_worker_reads_a_row_through_a_reconnect() -> None:
    """The whole path, from `db.get_escalation` down: one refusal, then the row."""
    responses.get(f"{SUPABASE}/escalation", body=requests.exceptions.ConnectionError("connection reset"))
    responses.get(f"{SUPABASE}/escalation", json=[{"id": "afb25429", "status": "drafting"}])

    assert db.get_escalation("afb25429") == {"id": "afb25429", "status": "drafting"}


# ---- (c) what a failure leaves behind ---------------------------------------


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[object]]:
    seen: dict[str, list[object]] = {"escalation": [], "group": [], "trace": [], "released": []}
    monkeypatch.setattr(db, "update_escalation", lambda _id, **fields: seen["escalation"].append(fields))
    monkeypatch.setattr(db, "update_group", lambda _id, **fields: seen["group"].append(fields))
    monkeypatch.setattr(db, "release_issue_slot", lambda group_id, escalation_id: seen["released"].append(group_id))
    monkeypatch.setattr(
        trace, "error",
        lambda project_id, escalation_id, title, message: seen["trace"].append(("error", title, message)),
    )
    monkeypatch.setattr(
        trace, "status",
        lambda project_id, escalation_id, title, state="ok", detail=None: seen["trace"].append(("status", title, detail)),
    )
    return seen


def test_a_run_whose_pull_request_is_open_is_never_marked_failed(
    recorded: dict[str, list[object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The 02:5x failure: the connection dropped on the call that was recording PR #20."""
    monkeypatch.setattr(db, "get_escalation", lambda _id: {"id": "afb25429", "pr_url": None})
    monkeypatch.setattr(
        db, "get_group",
        lambda _id: {"id": "g1", "status": "drafting", "pr_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/20"},
    )

    pipeline.fail(_req(), "open_draft_pr", RuntimeError("HTTPSConnectionPool(host='x.supabase.co', port=443)"))

    assert recorded["escalation"] == [
        {
            "status": "awaiting_approval",
            "pr_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/20",
            "error": "open_draft_pr: HTTPSConnectionPool(host='x.supabase.co', port=443)",
        }
    ]
    assert recorded["trace"][0][0] == "status"
    assert "waiting for approval" in str(recorded["trace"][0][1])


def test_a_real_failure_says_what_happened_and_leaves_the_request_open(
    recorded: dict[str, list[object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(db, "get_escalation", lambda _id: {"id": "3a42f6a1", "pr_url": None})
    monkeypatch.setattr(db, "get_group", lambda _id: {"id": "g1", "status": "drafting", "issue_number": 21, "pr_url": None})

    pipeline.fail(_req(), "draft_implementation", RuntimeError("no candidate passed the gates after 3 attempts"))

    assert recorded["escalation"][0]["status"] == "failed"
    kind, title, message = recorded["trace"][0]  # type: ignore[misc]
    assert kind == "error"
    # A person reads this, so it names what could not be done, not the function that was running.
    assert title == "Lantern could not get a change past the repository's own checks."
    assert "draft_implementation" not in title
    assert "still open, so it can be tried again" in str(message)
    # The group goes back to a state a later report can start a run from, and the issue stays open.
    assert recorded["group"] == [{"status": "filed"}]
    assert recorded["released"] == ["g1"]


def test_a_failure_before_the_issue_leaves_the_group_where_it_started(
    recorded: dict[str, list[object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(db, "get_escalation", lambda _id: {"id": "e1", "pr_url": None})
    monkeypatch.setattr(db, "get_group", lambda _id: {"id": "g1", "status": "drafting", "issue_number": None, "pr_url": None})

    pipeline.fail(_req(), "file_issue", RuntimeError("GitHub is unreachable"))

    assert recorded["group"] == [{"status": "observed"}]

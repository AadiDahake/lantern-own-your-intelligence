"""The people who asked for a text, in the database, and the whole notice from the environment.

PostgREST and the provider are mocked with `responses`, which also proves each query's filters
and the order a run makes its calls in. The rule itself is in `test_sms_notice.py`.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import requests
import responses
from responses import matchers

from steps import retry, seal, sms_notice
from steps.sms_notice import GapSubscribers, NoticeOutcome, Owed

TEXT = (
    'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted '
    "and the team reviews it next. This is the only text for this request."
)


def done(asked: int, sent: int, unconfirmed: int = 0, taken: int = 0, reasons: tuple[str, ...] = ()) -> NoticeOutcome:
    return NoticeOutcome("done", asked=asked, sent=sent, unconfirmed=unconfirmed, taken=taken, reasons=reasons)


REST = "https://example.supabase.co/rest/v1"
ROW = {"id": "eq.s1", "project_id": "eq.p1", "group_id": "eq.g1"}

# Sealed by `apps/web/lib/sms/phone.ts`; `test_seal.py` says how.
SEALED = {
    "serviceRoleKey": "sbp_test_service_role_key_for_fixtures_only",
    "plain": "+14155550123",
    "stored": "HHwLxOfLK-fLLN_q.S5EGq8epd6BiALMA.rFJVPkWiJfRYPIf5daVaEQ",
}


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> GapSubscribers:
    monkeypatch.setattr(seal.config, "supabase_service_role_key", lambda: SEALED["serviceRoleKey"])
    return GapSubscribers("p1", "g1")


@responses.activate
def test_the_store_reads_the_company_and_the_gaps_title_scoped_to_the_project(store: GapSubscribers) -> None:
    responses.get(
        f"{REST}/project",
        json=[{"name": "NovaAir"}],
        match=[matchers.query_param_matcher({"id": "eq.p1", "select": "name"})],
    )
    responses.get(
        f"{REST}/feature_request_group",
        json=[{"title": "Seat a party together"}],
        match=[matchers.query_param_matcher({"id": "eq.g1", "project_id": "eq.p1", "select": "title"})],
    )
    assert store.names() == ("NovaAir", "Seat a party together")


@responses.activate
def test_a_gap_of_a_different_project_has_no_title_to_quote(store: GapSubscribers) -> None:
    responses.get(f"{REST}/project", json=[{"name": None}])
    responses.get(f"{REST}/feature_request_group", json=[])
    assert store.names() == ("", "")


@responses.activate
def test_the_store_lists_the_people_of_this_gap_who_are_still_owed_oldest_first(store: GapSubscribers) -> None:
    responses.get(
        f"{REST}/gap_subscriber",
        json=[{"id": "s1", "phone_sealed": SEALED["stored"]}, {"id": "s2", "phone_sealed": "does.not.open"}],
        match=[
            matchers.query_param_matcher(
                {
                    "project_id": "eq.p1",
                    "group_id": "eq.g1",
                    "notified_at": "is.null",
                    "phone_sealed": "not.is.null",
                    "select": "id,phone_sealed",
                    "order": "created_at.asc",
                    "limit": "201",
                }
            )
        ],
    )
    assert store.owed(201) == [Owed("s1", SEALED["plain"]), Owed("s2", None)]


@responses.activate
def test_the_claim_is_one_update_that_only_lands_where_nobody_holds_the_person(store: GapSubscribers) -> None:
    responses.patch(
        f"{REST}/gap_subscriber",
        json=[{"id": "s1"}],
        match=[
            matchers.query_param_matcher({**ROW, "notified_at": "is.null", "select": "id"}),
            matchers.header_matcher({"Prefer": "return=representation"}),
        ],
    )
    before = datetime.now(timezone.utc)

    assert store.claim("s1") is True

    claimed_at = datetime.fromisoformat(json.loads(responses.calls[0].request.body)["notified_at"])
    assert before <= claimed_at <= datetime.now(timezone.utc)


@responses.activate
def test_a_claim_that_comes_back_empty_was_taken_by_a_different_run(store: GapSubscribers) -> None:
    responses.patch(f"{REST}/gap_subscriber", json=[])
    assert store.claim("s1") is False


@pytest.mark.parametrize("failure", [{"status": 503, "json": {"message": "not now"}}, {"body": requests.exceptions.ConnectionError("reset")}])
@responses.activate
def test_a_claim_is_never_repeated(store: GapSubscribers, failure: dict[str, Any]) -> None:
    """A second update after a lost answer comes back empty, and nobody can say who holds the claim."""
    responses.patch(f"{REST}/gap_subscriber", **failure)
    with pytest.raises(Exception):  # noqa: B017, PT011 - any failure means "do not send"
        store.claim("s1")
    assert len(responses.calls) == 1
    assert retry.ATTEMPTS > 1


@pytest.mark.parametrize("state", ["sent", "unconfirmed"])
@responses.activate
def test_the_number_is_erased_after_a_text_is_sent_or_may_have_gone(store: GapSubscribers, state: str) -> None:
    # A blip on this write is worth a second attempt: erasing a number two times is the same as one.
    responses.patch(f"{REST}/gap_subscriber", status=503, json={"message": "not now"})
    responses.patch(f"{REST}/gap_subscriber", status=204, match=[matchers.query_param_matcher(ROW)])

    store.settle("s1", state)

    assert len(responses.calls) == 2
    assert json.loads(responses.calls[1].request.body) == {"phone_sealed": None}


@responses.activate
def test_the_claim_is_released_after_a_refusal_and_the_number_stays(store: GapSubscribers) -> None:
    responses.patch(f"{REST}/gap_subscriber", status=204, match=[matchers.query_param_matcher(ROW)])

    store.settle("s1", "refused")

    assert json.loads(responses.calls[0].request.body) == {"notified_at": None}


@responses.activate
def test_a_release_is_never_repeated(store: GapSubscribers) -> None:
    """A second release after a lost answer can free the claim of a run that took the person since."""
    responses.patch(f"{REST}/gap_subscriber", status=503, json={"message": "not now"})
    with pytest.raises(RuntimeError):
        store.settle("s1", "refused")
    assert len(responses.calls) == 1


@responses.activate
def test_old_claims_of_the_whole_project_lose_their_number(store: GapSubscribers) -> None:
    responses.patch(f"{REST}/gap_subscriber", status=204)

    store.forget_stale()

    request = responses.calls[0].request
    params = dict(request.params)
    older_than = params.pop("notified_at")
    assert params == {"project_id": "eq.p1", "phone_sealed": "not.is.null"}
    assert older_than.startswith("lt.")
    limit = datetime.fromisoformat(older_than[3:])
    assert abs((datetime.now(timezone.utc) - timedelta(minutes=15)) - limit) < timedelta(seconds=5)
    assert json.loads(request.body) == {"phone_sealed": None}


@responses.activate
def test_a_database_error_is_raised_so_the_rule_can_refuse_to_send(store: GapSubscribers) -> None:
    responses.get(f"{REST}/gap_subscriber", status=404, json={"code": "PGRST205", "message": "no such table"})
    with pytest.raises(RuntimeError, match="PostgREST 404"):
        store.owed(201)


DIAL = "https://api.getdial.ai/api/v1/messages"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIAL_API_KEY", "test-dial-key")
    monkeypatch.setenv("DIAL_FROM_NUMBER", "+14155550100")
    monkeypatch.setattr(seal.config, "supabase_service_role_key", lambda: SEALED["serviceRoleKey"])


@pytest.mark.parametrize(
    ("env", "reason"),
    [
        ({}, "DIAL_API_KEY is not set"),
        ({"DIAL_FROM_NUMBER": "+14155550100"}, "DIAL_API_KEY is not set"),
        ({"DIAL_API_KEY": "test-dial-key"}, "DIAL_FROM_NUMBER is not set"),
        ({"DIAL_API_KEY": "  ", "DIAL_FROM_NUMBER": "+14155550100"}, "DIAL_API_KEY is not set"),
    ],
)
@responses.activate
def test_the_notice_is_off_and_reads_nothing_when_a_variable_is_blank(
    monkeypatch: pytest.MonkeyPatch, env: dict[str, str], reason: str
) -> None:
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    assert sms_notice.draft_notice("p1", "g1") == NoticeOutcome("off", reason=reason)
    # Not one call: a worker with no provider and no `gap_subscriber` table behaves as it did.
    assert len(responses.calls) == 0


@responses.activate
def test_a_run_with_no_request_group_has_nobody_to_text_and_reads_nothing(configured: None) -> None:
    assert sms_notice.draft_notice("p1", "") == done(0, 0)
    assert len(responses.calls) == 0


@responses.activate
def test_the_notice_claims_then_sends_then_erases_in_that_order(configured: None) -> None:
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the old claims
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    responses.get(f"{REST}/feature_request_group", json=[{"title": "Seat a party together"}])
    responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])  # the claim
    responses.post(DIAL, status=201, json={"message": {"id": "msg_1", "status": "sent"}})
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the number

    assert sms_notice.draft_notice("p1", "g1") == done(1, 1)

    calls = [(call.request.method, call.request.url.split("?")[0].rsplit("/", 1)[-1]) for call in responses.calls]
    assert calls == [
        ("PATCH", "gap_subscriber"),
        ("GET", "project"),
        ("GET", "feature_request_group"),
        ("GET", "gap_subscriber"),
        ("PATCH", "gap_subscriber"),
        ("POST", "messages"),
        ("PATCH", "gap_subscriber"),
    ]
    assert json.loads(responses.calls[4].request.body).keys() == {"notified_at"}
    assert json.loads(responses.calls[5].request.body) == {
        "to": SEALED["plain"],
        "fromNumber": "+14155550100",
        "body": TEXT,
    }
    assert responses.calls[5].request.headers["Authorization"] == "Bearer test-dial-key"
    assert json.loads(responses.calls[6].request.body) == {"phone_sealed": None}
    # The number is in the request to the provider and nowhere else.
    for index, call in enumerate(responses.calls):
        if index != 5:
            assert SEALED["plain"] not in (call.request.url or "")
            assert SEALED["plain"] not in str(call.request.body or "")


@responses.activate
def test_the_text_goes_to_the_address_in_dial_api_url(configured: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIAL_API_URL", "https://dial.example/")
    responses.patch(f"{REST}/gap_subscriber", status=204)
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    responses.get(f"{REST}/feature_request_group", json=[{"title": "Seat a party together"}])
    responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])
    responses.post("https://dial.example/api/v1/messages", status=402, json={"code": "insufficient_credit"})
    responses.patch(f"{REST}/gap_subscriber", status=204)

    assert sms_notice.draft_notice("p1", "g1") == done(1, 0, reasons=("insufficient_credit",))
    # Refused, so the last write gives the claim back and keeps the number.
    assert json.loads(responses.calls[-1].request.body) == {"notified_at": None}


@responses.activate
def test_a_worker_with_no_table_says_failed_and_sends_nothing(configured: None) -> None:
    missing = {"code": "PGRST205", "message": "Could not find the table 'public.gap_subscriber'"}
    responses.patch(f"{REST}/gap_subscriber", status=404, json=missing)
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    responses.get(f"{REST}/feature_request_group", json=[{"title": "Seat a party together"}])
    responses.get(f"{REST}/gap_subscriber", status=404, json=missing)
    sent = responses.post(DIAL, status=201, json={"message": {"id": "msg_1"}})

    outcome = sms_notice.draft_notice("p1", "g1")

    assert outcome.state == "failed"
    assert outcome.reason.startswith("PostgREST 404")
    assert sent.call_count == 0
    assert sms_notice.notice_trace(outcome)[:2] == ("Text notice: could not read who asked for a text", "failed")


def test_a_notice_that_breaks_in_a_way_nobody_planned_is_failed_and_does_not_raise(
    configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> NoticeOutcome:
        raise ValueError("the rule itself broke")

    monkeypatch.setattr(sms_notice, "send_draft_notice", explode)
    assert sms_notice.draft_notice("p1", "g1") == NoticeOutcome("failed", reason="the rule itself broke")

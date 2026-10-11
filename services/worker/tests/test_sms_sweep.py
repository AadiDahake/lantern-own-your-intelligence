"""The sweep for owed texts, as the worker's rule, and the sweep wired from the environment.

`packages/shared/test/fixtures/sms-sweep.json` holds the scenarios, and the web app's suite runs
the same file against its own copy of the rule (`apps/web/test/sms-sweep.test.ts`). In the first
part the list of gaps, the provider and the pass are functions, so nothing leaves the process.
In the last part PostgREST and the provider are mocked with `responses`, which also proves the
order of the calls of one sweep.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
import responses
from responses import matchers

from steps import retry, seal, sms_sweep
from steps.sms_notice import NoticeOutcome
from steps.sms_sweep import OwedGap, SweepResult, Sweeper

FIXTURE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parents[3] / "packages/shared/test/fixtures/sms-sweep.json").read_text(encoding="utf-8")
)

MINUTE_S = 60.0


def at(minute: float) -> Callable[[], float]:
    """A clock that stands at one minute."""
    return lambda: minute * MINUTE_S


def gap_of(group_id: str) -> OwedGap:
    return OwedGap("p1", group_id, f"run-{group_id}")


def outcome_of(raw: dict[str, Any]) -> NoticeOutcome:
    """An outcome of the fixture, as the pass gives it."""
    if raw["state"] != "done":
        return NoticeOutcome(raw["state"], reason=raw["reason"])
    return NoticeOutcome(
        "done",
        asked=raw["asked"],
        sent=raw["sent"],
        unconfirmed=raw["unconfirmed"],
        taken=raw["taken"],
        reasons=tuple(raw["reasons"]),
    )


DONE = NoticeOutcome("done", asked=1, sent=1)
REFUSED = NoticeOutcome("done", asked=1, sent=0, reasons=("http_400",))


class StepDeps:
    """One sweep with what the step gives, and a record of each thing the sweep did."""

    def __init__(self, step: dict[str, Any]) -> None:
        self.step = step
        self.read = False
        self.checked = False
        self.passed: list[str] = []
        self.said: list[list[str]] = []
        self.say_failed: list[list[str]] = []
        self.rows: list[tuple[str, dict[str, Any]]] = []

    def owed_gaps(self, limit: int) -> list[OwedGap]:
        self.read = True
        owed = self.step.get("owed")
        if owed is None:
            raise RuntimeError("the step gives no list of gaps")
        if isinstance(owed, dict):
            raise RuntimeError(owed["error"])
        return [gap_of(group_id) for group_id in owed]

    def provider_answers(self) -> tuple[bool, str]:
        self.checked = True
        answer = self.step.get("provider", "ok")
        return (True, "") if answer == "ok" else (False, answer)

    def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
        self.passed.append(gap.group_id)
        name = self.step.get("passes", {}).get(gap.group_id)
        if not name:
            raise RuntimeError(f"the step gives no pass for {gap.group_id}")
        return outcome_of(FIXTURE["outcomes"][name]), gap.group_id in self.step.get("refusedForAll", [])

    def say(self, gap: OwedGap, title: str, status: str, detail: dict[str, Any]) -> None:
        entry = [gap.group_id, title, status]
        if gap.group_id in self.step.get("sayFails", []):
            self.say_failed.append(entry)
            raise RuntimeError("the trace row could not be written")
        self.said.append(entry)
        self.rows.append((gap.group_id, detail))


def titled(said: list[list[str]] | None) -> list[list[str]]:
    """A fixture names the two long titles by a key."""
    return [[gap, FIXTURE["titles"].get(title, title), status] for gap, title, status in said or []]


@pytest.mark.parametrize("scenario", FIXTURE["scenarios"], ids=lambda scenario: scenario["name"])
def test_the_sweep_does_what_the_web_app_does(scenario: dict[str, Any]) -> None:
    sweeper = Sweeper()
    for step in scenario["steps"]:
        deps = StepDeps(step)
        expect = step["expect"]
        where = f"at minute {step['at']}"

        result = sweeper.run(deps, now=at(step["at"]))

        assert result.as_dict() == expect["result"], where
        assert deps.read is expect["read"], f"{where}: the list of gaps was read"
        assert deps.checked is expect["checked"], f"{where}: the provider was asked"
        assert deps.passed == expect["passed"], f"{where}: the gaps that got a pass"
        assert deps.said == titled(expect["said"]), f"{where}: the rows that were written"
        assert deps.say_failed == titled(expect.get("sayFailed")), f"{where}: the rows that could not be written"
        assert sms_sweep.sweep_line(result) == expect["line"], f"{where}: the runner's line"
        for gap, detail in deps.rows:
            # The detail of a row is the outcome that it reports.
            name = step.get("passes", {}).get(gap)
            outcome = FIXTURE["outcomes"][name] if name else {"state": "waiting", "reason": step.get("provider")}
            assert detail == {"notice": "draft_sms", "pass": "later", **outcome}, f"{where}: the row for {gap}"


def test_the_fixture_has_a_step_that_proves_each_rule() -> None:
    # An empty list would make the parametrized test above pass without a check.
    states = {step["expect"]["result"]["state"] for scenario in FIXTURE["scenarios"] for step in scenario["steps"]}
    assert states == {"failed", "idle", "provider", "swept", "waiting"}
    assert len(FIXTURE["scenarios"]) >= 20
    stops = {
        step["expect"]["result"].get("stop")
        for scenario in FIXTURE["scenarios"]
        for step in scenario["steps"]
        if step["expect"]["result"]["state"] == "swept"
    }
    assert stops == {None, "unconfirmed", "refused"}


class Deps:
    """A list of gaps and the outcome of each pass, for one sweep."""

    def __init__(self, owed: list[str], passes: dict[str, NoticeOutcome] | None = None) -> None:
        self.owed = owed
        self.passes = passes or {}
        self.limit: int | None = None
        self.passed: list[str] = []
        self.told: list[OwedGap] = []
        self.said: list[str] = []

    def owed_gaps(self, limit: int) -> list[OwedGap]:
        self.limit = limit
        return [gap_of(group_id) for group_id in self.owed]

    def provider_answers(self) -> tuple[bool, str]:
        return True, ""

    def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
        self.passed.append(gap.group_id)
        return self.passes.get(gap.group_id, DONE), False

    def say(self, gap: OwedGap, title: str, status: str, detail: dict[str, Any]) -> None:
        self.told.append(gap)
        self.said.append(f"{gap.group_id}: {title}")


def test_claims_no_one_when_the_question_to_the_provider_raises() -> None:
    class Broken(Deps):
        def provider_answers(self) -> tuple[bool, str]:
            raise OSError("socket hang up")

    deps = Broken(["g1"])

    assert Sweeper().run(deps, now=at(0)) == SweepResult("provider", reason="check_failed", gaps=1)
    assert deps.passed == []


def test_reads_a_pass_that_raises_as_a_list_that_could_not_be_read_and_goes_on_to_the_next_gap() -> None:
    class Broken(Deps):
        def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
            if gap.group_id == "g1":
                raise RuntimeError("PostgREST is unreachable")
            return DONE, False

    deps = Broken(["g1", "g2"])

    assert Sweeper().run(deps, now=at(0)) == SweepResult("swept", gaps=2, sent=1, left=1, stop=None)
    assert deps.said == [
        "g1: Text notice, later pass: could not read who is owed a text",
        "g2: Text notice, later pass: 1 of 1 sent",
    ]


def test_asks_for_at_most_one_sweep_of_gaps() -> None:
    deps = Deps([])
    Sweeper().run(deps, now=at(0))
    assert deps.limit == sms_sweep.SWEEP_GAPS


def test_keeps_the_wait_of_a_gap_that_a_full_list_did_not_show() -> None:
    """With more gaps than one sweep reads, a gap that waits can be past the end of the list.

    It is still owed, so its wait is not forgotten: a gap is forgotten by time only.
    """
    sweeper = Sweeper()
    sweeper.run(Deps(["g1"], {"g1": REFUSED}), now=at(0))

    others = [f"other-{index}" for index in range(sms_sweep.SWEEP_GAPS)]
    sweeper.run(Deps(others), now=at(1))

    again = Deps(["g1"], {"g1": REFUSED})
    assert sweeper.run(again, now=at(2)) == SweepResult("idle", owed=1)
    assert again.passed == []


def test_starts_a_gap_from_nothing_after_each_person_of_it_was_texted_also_while_the_list_is_full() -> None:
    """A gap is not forgotten while the list has it, so a confirmed text must end its wait."""
    sweeper = Sweeper()
    full = ["g1", *(f"other-{index}" for index in range(sms_sweep.SWEEP_GAPS - 1))]
    sweeper.run(Deps(full, {"g1": REFUSED}), now=at(0))
    sweeper.run(Deps(full, {"g1": DONE}), now=at(10))
    # A person of the same gap is owed again. The first wait is 10 minutes again, not 20.
    sweeper.run(Deps(full, {"g1": REFUSED}), now=at(11))
    early = Deps(full, {"g1": REFUSED})
    sweeper.run(early, now=at(20))
    assert "g1" not in early.passed
    due = Deps(full, {"g1": REFUSED})
    sweeper.run(due, now=at(21))
    assert "g1" in due.passed


def test_a_pass_that_confirmed_a_text_and_left_people_starts_the_waits_of_its_gap_from_nothing() -> None:
    """The gap made progress, so the wait after its next refusal is 10 minutes again, not 40."""
    one_of_two = NoticeOutcome("done", asked=2, sent=1, reasons=("http_400",))
    sweeper = Sweeper()
    sweeper.run(Deps(["g1"], {"g1": REFUSED}), now=at(0))
    sweeper.run(Deps(["g1"], {"g1": one_of_two}), now=at(10))
    # Due at once after the pass that confirmed a text, and refused again.
    again = Deps(["g1"], {"g1": REFUSED})
    sweeper.run(again, now=at(11))
    assert again.passed == ["g1"]
    early = Deps(["g1"], {"g1": REFUSED})
    assert sweeper.run(early, now=at(20)) == SweepResult("idle", owed=1)
    due = Deps(["g1"], {"g1": REFUSED})
    sweeper.run(due, now=at(21))
    assert due.passed == ["g1"]


def test_writes_no_row_and_starts_no_wait_for_a_pass_that_says_that_texts_are_off() -> None:
    class Off(Deps):
        def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
            self.passed.append(gap.group_id)
            return NoticeOutcome("off", reason="DIAL_API_KEY is not set"), False

    sweeper = Sweeper()
    first = Off(["g1"])
    assert sweeper.run(first, now=at(0)) == SweepResult("swept", gaps=1, sent=0, left=0)
    assert first.said == []
    again = Deps(["g1"])
    sweeper.run(again, now=at(1))
    assert again.passed == ["g1"]


def test_reads_the_clock_again_after_each_pass_so_a_wait_starts_when_the_pass_ends() -> None:
    """One pass can take a minute. A wait from the start of the sweep would be short by that time."""
    clock = [0.0]

    class Slow(Deps):
        def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
            clock[0] += 5 * MINUTE_S
            return REFUSED, False

    sweeper = Sweeper()
    sweeper.run(Slow(["g1"]), now=lambda: clock[0])
    early = Deps(["g1"], {"g1": REFUSED})
    sweeper.run(early, now=at(14))
    assert early.passed == []
    due = Deps(["g1"], {"g1": REFUSED})
    sweeper.run(due, now=at(15))
    assert due.passed == ["g1"]


def test_starts_the_wait_after_a_text_with_no_confirmed_answer_when_the_pass_ends() -> None:
    """Not when the sweep starts: a wait from the start would be short by the time of each pass."""
    clock = [0.0]

    class Slow(Deps):
        def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
            clock[0] += 5 * MINUTE_S
            return NoticeOutcome("done", asked=1, unconfirmed=1, reasons=("timeout",)), False

    sweeper = Sweeper()
    assert sweeper.run(Slow(["g1"]), now=lambda: clock[0]).stop == "unconfirmed"
    assert sweeper.run(Deps([]), now=at(14)) == SweepResult("waiting")
    assert sweeper.run(Deps([]), now=at(15)) == SweepResult("idle", owed=0)


def test_the_clock_of_a_sweep_is_the_one_that_does_not_go_back() -> None:
    """The wall clock can be set back, and a wait that is measured on it then holds the sweep."""
    import inspect
    import time

    assert inspect.signature(Sweeper.run).parameters["now"].default is time.monotonic


def test_reads_the_run_of_a_gap_from_an_object_or_a_list_and_a_gap_with_no_run_has_none() -> None:
    rows = [
        {"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}},
        {"id": "g2", "project_id": "p1", "escalation": [{"id": "run-2"}]},
        {"id": "g3", "project_id": "p1", "escalation": None},
        {"id": "g4", "project_id": "p1"},
    ]
    assert [sms_sweep._gap_of(row).escalation_id for row in rows] == ["run-1", "run-2", None, None]


def test_gives_each_gap_its_own_trace_in_the_run_that_carries_the_gap() -> None:
    deps = Deps(["g1"], {"g1": REFUSED})
    Sweeper().run(deps, now=at(0))
    assert deps.told == [OwedGap(project_id="p1", group_id="g1", escalation_id="run-g1")]


def test_keeps_the_waits_of_two_runners_apart() -> None:
    one, two = Sweeper(), Sweeper()
    one.run(Deps(["g1"], {"g1": REFUSED}), now=at(0))
    other = Deps(["g1"], {"g1": REFUSED})
    two.run(other, now=at(1))
    assert other.passed == ["g1"]


def test_a_sweep_with_no_clock_given_reads_the_clock_that_does_not_go_back() -> None:
    """A new sweeper has no wait on that clock, and a refused gap waits from this moment."""
    sweeper = Sweeper()
    assert sweeper.run(Deps(["g1"], {"g1": REFUSED})) == SweepResult("swept", gaps=1, left=1)
    again = Deps(["g1"], {"g1": REFUSED})
    assert sweeper.run(again) == SweepResult("idle", owed=1)
    assert again.passed == []


def test_the_waits_start_at_10_minutes_are_2_times_as_long_each_time_and_stop_at_6_hours() -> None:
    waits: list[float] = []
    wait = 0.0
    for _ in range(8):
        wait = sms_sweep.longer_wait(wait)
        waits.append(wait / MINUTE_S)
    assert waits == [10, 20, 40, 80, 160, 320, 360, 360]
    assert sms_sweep.FIRST_WAIT_S == 10 * MINUTE_S
    assert sms_sweep.MAX_WAIT_S == 360 * MINUTE_S


def test_the_waits_are_never_shorter_than_the_time_between_two_sweeps() -> None:
    assert sms_sweep.FIRST_WAIT_S >= sms_sweep.SWEEP_EVERY_S
    # The docs and the web app's copy give these two numbers.
    assert sms_sweep.SWEEP_EVERY_S == 5 * MINUTE_S
    assert sms_sweep.SWEEP_GAPS == 1000


def test_a_later_pass_says_nothing_when_it_had_no_one_to_text() -> None:
    assert sms_sweep.later_pass_trace(NoticeOutcome("done")) is None
    assert sms_sweep.later_pass_trace(NoticeOutcome("done", taken=3)) is None
    assert sms_sweep.later_pass_trace(NoticeOutcome("off", reason="DIAL_API_KEY is not set")) is None


def test_a_later_pass_counts_the_texts_names_the_pass_and_is_failed_when_one_was_not_sent() -> None:
    assert sms_sweep.later_pass_trace(NoticeOutcome("done", asked=2, sent=2)) == (
        "Text notice, later pass: 2 of 2 sent",
        "ok",
        {
            "notice": "draft_sms",
            "pass": "later",
            "state": "done",
            "asked": 2,
            "sent": 2,
            "unconfirmed": 0,
            "taken": 0,
            "reasons": [],
        },
    )
    refused = sms_sweep.later_pass_trace(REFUSED)
    assert refused is not None and refused[1] == "failed"


def test_a_later_pass_says_that_the_list_could_not_be_read() -> None:
    assert sms_sweep.later_pass_trace(NoticeOutcome("failed", reason="PostgREST 503")) == (
        "Text notice, later pass: could not read who is owed a text",
        "failed",
        {"notice": "draft_sms", "pass": "later", "state": "failed", "reason": "PostgREST 503"},
    )


def test_the_row_about_the_provider_says_that_nothing_was_sent_yet_with_the_reason_as_a_code() -> None:
    assert sms_sweep.provider_wait_trace("http_503") == (
        "Text notice, later pass: not sent yet, the text message provider did not answer",
        "failed",
        {"notice": "draft_sms", "pass": "later", "state": "waiting", "reason": "http_503"},
    )


def test_the_line_says_off_with_the_variable_that_is_missing() -> None:
    off = SweepResult("off", reason="DIAL_API_KEY is not set")
    assert sms_sweep.sweep_line(off) == "text sweep: off, DIAL_API_KEY is not set"


def test_the_line_says_nothing_for_a_sweep_that_waits_or_has_no_gap_that_is_due() -> None:
    assert sms_sweep.sweep_line(SweepResult("waiting")) is None
    assert sms_sweep.sweep_line(SweepResult("idle", owed=4)) is None


@pytest.mark.parametrize(
    ("result", "shape"),
    [
        (SweepResult("off", reason="DIAL_API_KEY is not set"), {"state": "off", "reason": "DIAL_API_KEY is not set"}),
        (SweepResult("waiting"), {"state": "waiting"}),
        (SweepResult("failed", reason="PostgREST 503"), {"state": "failed", "reason": "PostgREST 503"}),
        (SweepResult("idle", owed=1), {"state": "idle", "owed": 1}),
        (SweepResult("provider", reason="timeout", gaps=2), {"state": "provider", "reason": "timeout", "gaps": 2}),
        (
            SweepResult("swept", gaps=2, sent=3, left=1, stop="unconfirmed"),
            {"state": "swept", "gaps": 2, "sent": 3, "left": 1, "stop": "unconfirmed"},
        ),
        (
            SweepResult("swept", gaps=1, sent=0, left=1),
            {"state": "swept", "gaps": 1, "sent": 0, "left": 1, "stop": None},
        ),
    ],
)
def test_a_result_as_a_dict_has_the_keys_of_its_state_and_no_more(result: SweepResult, shape: dict[str, Any]) -> None:
    assert result.as_dict() == shape


# From here: the sweep that a runner makes, on PostgREST and the provider.

REST = "https://example.supabase.co/rest/v1"
NUMBERS = "https://api.getdial.ai/api/v1/numbers"
SEND = "https://api.getdial.ai/api/v1/messages"

TEXT = (
    'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted '
    "and the team reviews it next. This is the only text for this request."
)

# Sealed by `apps/web/lib/sms/phone.ts`; `test_seal.py` says how.
SEALED = {
    "serviceRoleKey": "sbp_test_service_role_key_for_fixtures_only",
    "plain": "+14155550123",
    "stored": "HHwLxOfLK-fLLN_q.S5EGq8epd6BiALMA.rFJVPkWiJfRYPIf5daVaEQ",
}

OWED_GAPS = {
    "status": "in.(pr_open,awaiting_approval)",
    "select": "id,project_id,escalation!escalation_id!inner(id),gap_subscriber!inner(id)",
    "escalation.status": "in.(pr_open,awaiting_approval)",
    "escalation.mode": "eq.full",
    "escalation.approval": "is.null",
    "gap_subscriber.notified_at": "is.null",
    "gap_subscriber.phone_sealed": "not.is.null",
    "gap_subscriber.limit": "1",
    "order": "last_seen.asc,id.asc",
    "limit": str(sms_sweep.SWEEP_GAPS),
}


def still_open(group_id: str, project_id: str) -> dict[str, str]:
    """The question about one gap just before its pass."""
    return {
        "id": f"eq.{group_id}",
        "project_id": f"eq.{project_id}",
        "status": "in.(pr_open,awaiting_approval)",
        "select": "id,escalation!escalation_id!inner(id)",
        "escalation.status": "in.(pr_open,awaiting_approval)",
        "escalation.mode": "eq.full",
        "escalation.approval": "is.null",
        "limit": "1",
    }


def draft(group_id: str, project_id: str, open_now: bool = True) -> None:
    """What the question about one gap answers: a row while no person has decided the draft."""
    responses.get(
        f"{REST}/feature_request_group",
        json=[{"id": group_id}] if open_now else [],
        match=[matchers.query_param_matcher(still_open(group_id, project_id))],
    )


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIAL_API_KEY", "test-dial-key")
    monkeypatch.setenv("DIAL_FROM_NUMBER", "+14155550100")
    monkeypatch.setattr(seal.config, "supabase_service_role_key", lambda: SEALED["serviceRoleKey"])


def gaps(*rows: dict[str, Any]) -> None:
    """What the list of gaps answers. The query must be the one query of the sweep."""
    responses.get(f"{REST}/feature_request_group", json=list(rows), match=[matchers.query_param_matcher(OWED_GAPS)])


def calls() -> list[tuple[str, str]]:
    return [(call.request.method, call.request.url.split("?")[0].rsplit("/", 1)[-1]) for call in responses.calls]


def trace_rows() -> list[dict[str, Any]]:
    return [json.loads(call.request.body) for call in responses.calls if "/trace_event" in call.request.url]


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
def test_the_sweep_is_off_and_calls_nothing_when_a_variable_is_blank(
    monkeypatch: pytest.MonkeyPatch, env: dict[str, str], reason: str
) -> None:
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    result = sms_sweep.draft_sweep()()

    assert result == SweepResult("off", reason=reason)
    assert sms_sweep.sweep_line(result) == f"text sweep: off, {reason}"
    # Not one call: a worker with no provider and no `gap_subscriber` table behaves as it did.
    assert len(responses.calls) == 0


@responses.activate
def test_a_sweep_asks_the_provider_then_claims_sends_and_erases_and_says_so_in_the_run_of_the_gap(
    configured: None,
) -> None:
    gaps({"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}, "gap_subscriber": [{"id": "s1"}]})
    responses.get(NUMBERS, json={"numbers": [{"id": "num_1", "number": "+14155550100"}]})
    draft("g1", "p1")
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the old claims
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    responses.get(
        f"{REST}/feature_request_group",
        json=[{"title": "Seat a party together"}],
        match=[matchers.query_param_matcher({"id": "eq.g1", "project_id": "eq.p1", "select": "title"})],
    )
    responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])  # the claim
    responses.post(SEND, status=201, json={"message": {"id": "msg_1", "status": "sent"}})
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the number
    responses.post(f"{REST}/trace_event", json=[{"id": 1}])

    result = sms_sweep.draft_sweep()()

    assert result == SweepResult("swept", gaps=1, sent=1, left=0, stop=None)
    assert calls() == [
        ("GET", "feature_request_group"),
        ("GET", "numbers"),
        # The question about the gap, just before its pass and before each query about a person.
        ("GET", "feature_request_group"),
        ("PATCH", "gap_subscriber"),
        ("GET", "project"),
        ("GET", "feature_request_group"),
        ("GET", "gap_subscriber"),
        ("PATCH", "gap_subscriber"),
        ("POST", "messages"),
        ("PATCH", "gap_subscriber"),
        ("POST", "trace_event"),
    ]
    assert responses.calls[1].request.headers["Authorization"] == "Bearer test-dial-key"
    # The pass is scoped to the project and the gap of the row that the list gave.
    assert dict(responses.calls[7].request.params) == {
        "id": "eq.s1",
        "project_id": "eq.p1",
        "group_id": "eq.g1",
        "notified_at": "is.null",
        "select": "id",
    }
    assert json.loads(responses.calls[7].request.body).keys() == {"notified_at"}
    assert json.loads(responses.calls[8].request.body) == {
        "to": SEALED["plain"],
        "fromNumber": "+14155550100",
        "body": TEXT,
    }
    assert json.loads(responses.calls[9].request.body) == {"phone_sealed": None}
    assert trace_rows() == [
        {
            "project_id": "p1",
            "escalation_id": "run-1",
            "conversation_id": None,
            "source": "workflow",
            "kind": "status",
            "status": "ok",
            "title": "Text notice, later pass: 1 of 1 sent",
            "detail": {
                "notice": "draft_sms",
                "pass": "later",
                "state": "done",
                "asked": 1,
                "sent": 1,
                "unconfirmed": 0,
                "taken": 0,
                "reasons": [],
            },
        }
    ]
    # The number is in the request to the provider and nowhere else.
    for index, call in enumerate(responses.calls):
        if index != 8:
            assert SEALED["plain"] not in (call.request.url or "")
            assert SEALED["plain"] not in str(call.request.body or "")
    assert "415555" not in repr(result) and "415555" not in str(sms_sweep.sweep_line(result))


@responses.activate
def test_a_sweep_claims_no_one_and_sends_nothing_while_the_provider_does_not_answer(configured: None) -> None:
    gaps(
        {"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}, "gap_subscriber": [{"id": "s1"}]},
        # An answer with no run in it gives no trace to write to.
        {"id": "g2", "project_id": "p2", "escalation": None, "gap_subscriber": [{"id": "s2"}]},
    )
    asked = responses.get(NUMBERS, status=503, json={"error": "upstream"})
    claimed = responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])
    sent = responses.post(SEND, status=201, json={"message": {"id": "msg_1"}})
    responses.post(f"{REST}/trace_event", json=[{"id": 1}])
    sweep = sms_sweep.draft_sweep()

    result = sweep()

    assert result == SweepResult("provider", reason="http_503", gaps=2)
    assert calls() == [
        ("GET", "feature_request_group"),
        ("GET", "numbers"),
        ("POST", "trace_event"),
        ("POST", "trace_event"),
    ]
    # The question is asked one time, although a 503 is a status that the worker tries again.
    assert asked.call_count == 1 and 503 in retry.RETRYABLE_STATUS and retry.ATTEMPTS > 1
    assert claimed.call_count == 0 and sent.call_count == 0
    waiting = {
        "conversation_id": None,
        "source": "workflow",
        "kind": "status",
        "status": "failed",
        "title": "Text notice, later pass: not sent yet, the text message provider did not answer",
        "detail": {"notice": "draft_sms", "pass": "later", "state": "waiting", "reason": "http_503"},
    }
    assert trace_rows() == [
        {"project_id": "p1", "escalation_id": "run-1", **waiting},
        {"project_id": "p2", "escalation_id": None, **waiting},
    ]

    # The function keeps what it said, so the next sweep asks again and writes no second row.
    assert sweep() == result
    assert asked.call_count == 2
    assert len(trace_rows()) == 2
    assert claimed.call_count == 0 and sent.call_count == 0


@responses.activate
def test_a_sweep_makes_no_pass_for_a_gap_whose_draft_a_person_decided_after_the_list_was_read(
    configured: None,
) -> None:
    gaps({"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}, "gap_subscriber": [{"id": "s1"}]})
    responses.get(NUMBERS, json={"numbers": []})
    draft("g1", "p1", open_now=False)
    people = responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    claimed = responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])
    sent = responses.post(SEND, status=201, json={"message": {"id": "msg_1"}})

    result = sms_sweep.draft_sweep()()

    # The text says that the team reviews the change next. After the decision that is false, so
    # no person is read, no one is claimed, and nothing is sent or said.
    assert result == SweepResult("swept", gaps=1, sent=0, left=0)
    assert calls() == [("GET", "feature_request_group"), ("GET", "numbers"), ("GET", "feature_request_group")]
    assert people.call_count == 0 and claimed.call_count == 0 and sent.call_count == 0


@responses.activate
def test_a_sweep_stops_at_a_refusal_that_is_not_about_one_person_and_waits_before_the_next_send(
    configured: None,
) -> None:
    gaps(
        {"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}, "gap_subscriber": [{"id": "s1"}]},
        {"id": "g2", "project_id": "p1", "escalation": {"id": "run-2"}, "gap_subscriber": [{"id": "s2"}]},
    )
    responses.get(NUMBERS, json={"numbers": []})
    draft("g1", "p1")
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the old claims
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    responses.get(
        f"{REST}/feature_request_group",
        json=[{"title": "Seat a party together"}],
        match=[matchers.query_param_matcher({"id": "eq.g1", "project_id": "eq.p1", "select": "title"})],
    )
    responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])  # the claim
    # The account has no credit: the provider answers the question and refuses each text.
    sent = responses.post(SEND, status=402, json={"error": "no credit", "code": "insufficient_credit"})
    responses.patch(f"{REST}/gap_subscriber", status=204)  # the claim goes back
    responses.post(f"{REST}/trace_event", json=[{"id": 1}])
    sweep = sms_sweep.draft_sweep()

    result = sweep()

    # One send, not one for each gap: the second gap is not asked about and gets no pass.
    assert result == SweepResult("swept", gaps=1, sent=0, left=2, stop="refused")
    assert sent.call_count == 1
    assert json.loads(responses.calls[9].request.body) == {"notified_at": None}
    assert [(row["escalation_id"], row["title"], row["detail"]["reasons"]) for row in trace_rows()] == [
        ("run-1", "Text notice, later pass: 0 of 1 sent", ["insufficient_credit"])
    ]
    # The next send waits, so the next sweep reads nothing.
    before = len(responses.calls)
    assert sweep() == SweepResult("waiting")
    assert len(responses.calls) == before


@responses.activate
def test_a_refusal_that_is_about_one_person_does_not_stop_the_sweep(configured: None) -> None:
    gaps(
        {"id": "g1", "project_id": "p1", "escalation": {"id": "run-1"}, "gap_subscriber": [{"id": "s1"}]},
        {"id": "g2", "project_id": "p1", "escalation": {"id": "run-2"}, "gap_subscriber": [{"id": "s2"}]},
    )
    responses.get(NUMBERS, json={"numbers": []})
    draft("g1", "p1")
    draft("g2", "p1")
    responses.get(f"{REST}/project", json=[{"name": "NovaAir"}])
    for group_id in ("g1", "g2"):
        responses.get(
            f"{REST}/feature_request_group",
            json=[{"title": "Seat a party together"}],
            match=[matchers.query_param_matcher({"id": f"eq.{group_id}", "project_id": "eq.p1", "select": "title"})],
        )
    responses.get(f"{REST}/gap_subscriber", json=[{"id": "s1", "phone_sealed": SEALED["stored"]}])
    # Each write of a person's row: the old claims, the claim, and what the send left.
    responses.patch(f"{REST}/gap_subscriber", json=[{"id": "s1"}])
    # The provider refuses the number of the first gap, and takes the text of the second one.
    refused = responses.post(SEND, status=400, json={"error": "this number cannot get a text"})
    taken = responses.post(SEND, status=201, json={"message": {"id": "msg_2"}})
    responses.post(f"{REST}/trace_event", json=[{"id": 1}])

    result = sms_sweep.draft_sweep()()

    # A 400 is about that number. The next gap gets its pass in the same sweep.
    assert result == SweepResult("swept", gaps=2, sent=1, left=1)
    assert refused.call_count == 1 and taken.call_count == 1
    assert [(row["escalation_id"], row["title"]) for row in trace_rows()] == [
        ("run-1", "Text notice, later pass: 0 of 1 sent"),
        ("run-2", "Text notice, later pass: 1 of 1 sent"),
    ]


@responses.activate
def test_a_sweep_that_cannot_read_the_list_of_gaps_asks_no_one_and_says_why(configured: None) -> None:
    missing = {"code": "PGRST205", "message": "Could not find the table 'public.gap_subscriber'"}
    responses.get(f"{REST}/feature_request_group", status=404, json=missing)
    asked = responses.get(NUMBERS, json={"numbers": []})

    result = sms_sweep.draft_sweep()()

    assert result.state == "failed"
    assert result.reason.startswith("PostgREST 404")
    assert asked.call_count == 0
    assert str(sms_sweep.sweep_line(result)).startswith("text sweep: failed (PostgREST 404")


def test_a_sweep_that_breaks_in_a_way_nobody_planned_is_failed_and_does_not_raise(
    configured: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> SweepResult:
        raise ValueError("the rule itself broke")

    monkeypatch.setattr(Sweeper, "run", explode)
    # The kind of the failure only, as the forge runner prints it: nothing planned for this
    # error, so its words are not printed where a person's number was just handled.
    result = sms_sweep.draft_sweep()()
    assert result == SweepResult("failed", reason="ValueError")
    assert sms_sweep.sweep_line(result) == "text sweep: failed (ValueError)"

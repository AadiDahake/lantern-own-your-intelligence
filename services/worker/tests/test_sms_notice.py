"""The text a person asked for, as the worker's rule: who is claimed, who is texted, what is said.

The list of people is in memory and the send is a function, so nothing leaves the process. The
store on PostgREST and the whole notice are in `test_sms_subscribers.py`.
"""

from __future__ import annotations

import json
import threading
import time

import pytest
import requests

from steps import sms_notice
from steps.dial import SmsResult
from steps.sms_notice import NoticeOutcome, Owed

TEXT = (
    'NovaAir: you asked for a text about "Seat a party together". A change for it is now drafted '
    "and the team reviews it next. This is the only text for this request."
)

ANA = Owed("s1", "+14155550101")
BEN = Owed("s2", "+14155550102")
CAT = Owed("s3", "+14155550103")


class MemoryStore:
    """A list of people in memory, with the claim rule of the table: one winner for each row."""

    def __init__(
        self,
        people: list[Owed],
        taken_by_other_run: tuple[str, ...] = (),
        claim_fails: tuple[str, ...] = (),
        settle_fails: bool = False,
        cleanup_fails: bool = False,
        read_fails: bool = False,
    ) -> None:
        self.people = people
        self.claimed = {person.id: person.id in taken_by_other_run for person in people}
        self.settled: dict[str, str] = {}
        self.calls: list[str] = []
        self.claim_fails = claim_fails
        self.settle_fails = settle_fails
        self.cleanup_fails = cleanup_fails
        self.read_fails = read_fails
        self._lock = threading.Lock()

    def names(self) -> tuple[str, str]:
        return "NovaAir", "Seat a party together"

    def owed(self, limit: int) -> list[Owed]:
        self.calls.append("owed")
        if self.read_fails:
            raise RuntimeError("PostgREST 404: the table gap_subscriber does not exist")
        return self.people[:limit]

    def claim(self, person_id: str) -> bool:
        if person_id in self.claim_fails:
            raise requests.exceptions.ConnectionError("PostgREST is unreachable")
        with self._lock:
            if self.claimed[person_id]:
                return False
            self.claimed[person_id] = True
            return True

    def settle(self, person_id: str, state: str) -> None:
        if self.settle_fails:
            raise RuntimeError("PostgREST is unreachable")
        self.settled[person_id] = state
        if state == "refused":
            self.claimed[person_id] = False

    def forget_stale(self) -> None:
        self.calls.append("forget_stale")
        if self.cleanup_fails:
            raise RuntimeError("PostgREST is unreachable")


class Sender:
    """A send that answers from a table of numbers, and records each text it was asked to send.

    `takes_s` is how long one send takes. A real send waits on the network, and that wait is
    where a second run gets its turn.
    """

    def __init__(self, answers: dict[str, SmsResult] | None = None, takes_s: float = 0.0) -> None:
        self.answers = answers or {}
        self.takes_s = takes_s
        self.sent_to: list[tuple[str, str]] = []
        self._lock = threading.Lock()

    def __call__(self, to: str, body: str) -> SmsResult:
        with self._lock:
            self.sent_to.append((to, body))
        if self.takes_s:
            time.sleep(self.takes_s)
        return self.answers.get(to, SmsResult("sent", id="msg"))


def done(asked: int, sent: int, unconfirmed: int = 0, taken: int = 0, reasons: tuple[str, ...] = ()) -> NoticeOutcome:
    return NoticeOutcome("done", asked=asked, sent=sent, unconfirmed=unconfirmed, taken=taken, reasons=reasons)


def test_texts_each_person_once_with_the_company_and_the_gap_by_name() -> None:
    store, send = MemoryStore([ANA, BEN]), Sender()

    assert sms_notice.send_draft_notice(store, send) == done(2, 2)

    assert send.sent_to == [(ANA.phone, TEXT), (BEN.phone, TEXT)]
    assert store.claimed == {"s1": True, "s2": True}
    assert store.settled == {"s1": "sent", "s2": "sent"}


def test_sends_nothing_when_no_one_asked() -> None:
    send = Sender()
    assert sms_notice.send_draft_notice(MemoryStore([]), send) == done(0, 0)
    assert send.sent_to == []


def test_does_not_text_a_person_that_a_different_run_already_claimed() -> None:
    store, send = MemoryStore([ANA, BEN], taken_by_other_run=("s1",)), Sender()
    # The other run reports its own person, so this run asked one.
    assert sms_notice.send_draft_notice(store, send) == done(1, 1, taken=1)
    assert [to for to, _body in send.sent_to] == [BEN.phone]


def test_runs_that_overlap_give_one_text_for_each_person() -> None:
    """The rule sends only for a claim it won. The claim itself is the database's work.

    The store here takes a claim under a lock, as the table does with one conditional update. What
    this test holds is the rule around it: three runs that take turns through one list never send
    for a person a different run holds, and never miss one.
    """
    people = [Owed(f"s{index}", f"+1415555{index:04d}") for index in range(40)]
    store, send = MemoryStore(people), Sender(takes_s=0.002)
    start = threading.Barrier(3)
    outcomes: list[NoticeOutcome] = []

    def run() -> None:
        start.wait()
        outcomes.append(sms_notice.send_draft_notice(store, send))

    threads = [threading.Thread(target=run) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(to for to, _body in send.sent_to) == sorted(str(person.phone) for person in people)
    assert sum(outcome.sent for outcome in outcomes) == 40
    assert sum(outcome.asked for outcome in outcomes) == 40
    assert set(store.settled.values()) == {"sent"}
    # The runs did take turns: more than one of them sent, and each one met people that a
    # different run held.
    assert sum(1 for outcome in outcomes if outcome.sent > 0) >= 2
    assert all(outcome.taken > 0 for outcome in outcomes)


def test_does_not_send_when_it_cannot_know_who_holds_the_claim() -> None:
    store, send = MemoryStore([ANA, BEN], claim_fails=("s1",)), Sender()
    assert sms_notice.send_draft_notice(store, send) == done(2, 1, reasons=("claim_failed",))
    assert [to for to, _body in send.sent_to] == [BEN.phone]


def test_releases_the_claim_of_a_refused_text_and_goes_on_to_the_next_person() -> None:
    store = MemoryStore([ANA, BEN])
    send = Sender({str(ANA.phone): SmsResult("refused", "rate_limited")})

    assert sms_notice.send_draft_notice(store, send) == done(2, 1, reasons=("rate_limited",))

    # Still owed: the claim went back, and the store was told to keep the number.
    assert store.claimed == {"s1": False, "s2": True}
    assert store.settled == {"s1": "refused", "s2": "sent"}


def test_keeps_the_claim_of_a_text_with_no_answer_and_stops_there() -> None:
    """An outage costs one person their text and not everyone: the others are not claimed."""
    store = MemoryStore([ANA, BEN, CAT])
    send = Sender({str(ANA.phone): SmsResult("unconfirmed", "timeout")})

    assert sms_notice.send_draft_notice(store, send) == done(3, 0, unconfirmed=1, reasons=("timeout",))

    assert [to for to, _body in send.sent_to] == [ANA.phone]
    assert store.claimed == {"s1": True, "s2": False, "s3": False}
    assert store.settled == {"s1": "unconfirmed"}


def test_stops_at_a_refusal_that_is_about_the_account_and_leaves_the_others_unclaimed() -> None:
    store = MemoryStore([ANA, BEN, CAT])
    send = Sender({str(ANA.phone): SmsResult("refused", "insufficient_credit", for_all=True)})

    assert sms_notice.send_draft_notice(store, send) == done(3, 0, reasons=("insufficient_credit",))

    assert [to for to, _body in send.sent_to] == [ANA.phone]
    assert store.claimed == {"s1": False, "s2": False, "s3": False}


def test_texts_at_most_one_pass_of_people_and_says_that_more_are_owed() -> None:
    people = [Owed(f"s{index}", f"+1415555{index:04d}") for index in range(sms_notice.PASS_LIMIT + 5)]
    store, send = MemoryStore(people), Sender()

    outcome = sms_notice.send_draft_notice(store, send)

    assert outcome == done(sms_notice.PASS_LIMIT + 1, sms_notice.PASS_LIMIT, reasons=("pass_limit",))
    assert len(send.sent_to) == sms_notice.PASS_LIMIT
    assert store.claimed[f"s{sms_notice.PASS_LIMIT}"] is False


def test_says_so_when_a_different_run_claimed_everyone() -> None:
    store, send = MemoryStore([ANA, BEN], taken_by_other_run=("s1", "s2")), Sender()
    outcome = sms_notice.send_draft_notice(store, send)
    assert outcome == done(0, 0, taken=2)
    assert sms_notice.notice_trace(outcome)[0] == "Text notice: a different run sent the texts"
    assert send.sent_to == []


def test_stops_when_the_pass_has_taken_its_time_and_leaves_the_others_unclaimed() -> None:
    store, send = MemoryStore([ANA, BEN, CAT]), Sender()
    # The clock is read one time for the deadline, then one time before each person.
    clock = iter([0.0, 1.0, sms_notice.PASS_BUDGET_S + 0.5])

    outcome = sms_notice.send_draft_notice(store, send, now=lambda: next(clock))

    assert outcome == done(3, 1, reasons=("time_budget",))
    assert [to for to, _body in send.sent_to] == [ANA.phone]
    assert store.claimed == {"s1": True, "s2": False, "s3": False}


def test_erases_the_numbers_of_old_claims_first_and_goes_on_when_that_fails() -> None:
    store, send = MemoryStore([ANA]), Sender()
    assert sms_notice.send_draft_notice(store, send) == done(1, 1)
    assert store.calls == ["forget_stale", "owed"]

    broken = MemoryStore([ANA], cleanup_fails=True)
    assert sms_notice.send_draft_notice(broken, send) == done(1, 1, reasons=("cleanup_failed",))


@pytest.mark.parametrize("phone", [None, "", "4155550101", "+1 415 555 0101", "+14155550101\n"])
def test_skips_a_number_that_does_not_open_or_is_not_e164(phone: str | None) -> None:
    """Not claimed and not erased: a worker with the wrong service role key reads every number so."""
    store, send = MemoryStore([Owed("s1", phone), BEN]), Sender()

    assert sms_notice.send_draft_notice(store, send) == done(2, 1, reasons=("unreadable_number",))

    assert [to for to, _body in send.sent_to] == [BEN.phone]
    assert store.claimed["s1"] is False
    assert "s1" not in store.settled


def test_counts_a_text_as_sent_when_the_record_of_it_could_not_be_written() -> None:
    store, send = MemoryStore([ANA, BEN], settle_fails=True), Sender()
    assert sms_notice.send_draft_notice(store, send) == done(2, 2, reasons=("settle_failed",))
    # The claim still holds, so no later pass texts these people again.
    assert store.claimed == {"s1": True, "s2": True}


def test_reads_a_send_that_raises_as_unconfirmed_and_keeps_the_claim() -> None:
    store = MemoryStore([ANA, BEN])

    def explode(_to: str, _body: str) -> SmsResult:
        raise RuntimeError("the provider module broke with +14155550101 in its words")

    outcome = sms_notice.send_draft_notice(store, explode)

    assert outcome == done(2, 0, unconfirmed=1, reasons=("send_failed",))
    assert store.claimed == {"s1": True, "s2": False}
    assert store.settled == {"s1": "unconfirmed"}


def test_answers_failed_and_sends_nothing_when_the_list_cannot_be_read() -> None:
    store, send = MemoryStore([ANA], read_fails=True), Sender()

    outcome = sms_notice.send_draft_notice(store, send)

    assert outcome == NoticeOutcome("failed", reason="PostgREST 404: the table gap_subscriber does not exist")
    assert send.sent_to == []
    assert store.claimed == {"s1": False}


def test_an_outcome_never_holds_a_phone_number() -> None:
    answers = {
        str(ANA.phone): SmsResult("refused", "http_400"),
        str(BEN.phone): SmsResult("unconfirmed", "http_503"),
    }
    outcome = sms_notice.send_draft_notice(MemoryStore([ANA, BEN, CAT]), Sender(answers))

    title, _status, detail = sms_notice.notice_trace(outcome)
    for text in (repr(outcome), title, json.dumps(detail)):
        assert "415555" not in text


def test_a_person_who_is_owed_a_text_does_not_show_the_number_when_printed() -> None:
    """A traceback or a log line that shows the value shows the id only."""
    assert "415555" not in repr(ANA) and "415555" not in str([ANA, BEN])
    assert repr(ANA) == "Owed(id='s1')"


def test_thrown_message_is_cut_short_and_is_never_empty() -> None:
    assert sms_notice.thrown_message(RuntimeError("x" * 900)) == "x" * 300
    assert sms_notice.thrown_message(KeyError()) == "KeyError"


def test_the_trace_says_off_with_the_variable_that_is_missing() -> None:
    assert sms_notice.notice_trace(NoticeOutcome("off", reason="DIAL_API_KEY is not set")) == (
        "Text notice: off",
        "ok",
        {"notice": "draft_sms", "state": "off", "reason": "DIAL_API_KEY is not set"},
    )


def test_the_trace_says_that_no_one_asked() -> None:
    assert sms_notice.notice_trace(done(0, 0)) == (
        "Text notice: no one asked for a text about this request",
        "ok",
        {"notice": "draft_sms", "state": "done", "asked": 0, "sent": 0, "unconfirmed": 0, "taken": 0, "reasons": []},
    )


def test_the_trace_counts_the_texts_and_is_failed_when_one_was_not_sent() -> None:
    assert sms_notice.notice_trace(done(3, 3))[:2] == ("Text notice: 3 of 3 sent", "ok")
    assert sms_notice.notice_trace(done(3, 2, unconfirmed=1, reasons=("timeout",))) == (
        "Text notice: 2 of 3 sent",
        "failed",
        {"notice": "draft_sms", "state": "done", "asked": 3, "sent": 2, "unconfirmed": 1, "taken": 0, "reasons": ["timeout"]},
    )


def test_the_trace_says_that_the_list_could_not_be_read() -> None:
    assert sms_notice.notice_trace(NoticeOutcome("failed", reason="PostgREST 404")) == (
        "Text notice: could not read who asked for a text",
        "failed",
        {"notice": "draft_sms", "state": "failed", "reason": "PostgREST 404"},
    )

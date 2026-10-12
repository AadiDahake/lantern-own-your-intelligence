"""The runner's sweep for owed texts: when it runs, what it logs, and that a failure does not end it.

The sweep is a function here and the wait is a function too, so no thread starts, no time passes
and nothing leaves the process. The sweep itself is in `test_sms_sweep.py`.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from types import SimpleNamespace
from typing import Any

import pytest

import local_runner
from steps.sms_sweep import SWEEP_EVERY_S, SweepResult

OFF = SweepResult("off", reason="DIAL_API_KEY is not set")
IDLE = SweepResult("idle", owed=1)
WAITING = SweepResult("waiting")
SWEPT = SweepResult("swept", gaps=1, sent=1, left=0)
REFUSED = SweepResult("swept", gaps=1, sent=0, left=1)
NO_ANSWER = SweepResult("provider", reason="http_503", gaps=2)

OFF_LINE = "text sweep: off, DIAL_API_KEY is not set"
SWEPT_LINE = "text sweep: 1 text sent in 1 pass, 0 gaps still with a person who is owed"
REFUSED_LINE = "text sweep: 0 texts sent in 1 pass, 1 gap still with a person who is owed"
NO_ANSWER_LINE = "text sweep: nothing sent for 2 gaps, the text message provider did not answer (http_503)"


class Stop(BaseException):
    """Ends a loop that has no end. It is not an `Exception`, so nothing in the loop catches it."""


@pytest.fixture
def logged(caplog: pytest.LogCaptureFixture) -> Iterator[Callable[[], list[tuple[int, str]]]]:
    """What the runner logged: the level and the line of each record."""
    with caplog.at_level(logging.INFO, logger="lantern.local"):
        yield lambda: [
            (record.levelno, record.getMessage()) for record in caplog.records if record.name == "lantern.local"
        ]


def sweeps(*results: SweepResult | Exception) -> Callable[[], SweepResult]:
    """A sweep that gives each result in turn, and raises the ones that are errors."""
    turns = iter(results)

    def sweep() -> SweepResult:
        result = next(turns)
        if isinstance(result, Exception):
            raise result
        return result

    return sweep


def ticks(sweep: Callable[[], SweepResult], count: int) -> None:
    last_line = ""
    for _ in range(count):
        last_line = local_runner.sweep_tick(sweep, last_line)


def test_a_tick_logs_the_line_of_a_sweep_that_did_something(logged: Callable[[], list[tuple[int, str]]]) -> None:
    assert local_runner.sweep_tick(lambda: SWEPT, "") == SWEPT_LINE
    assert logged() == [(logging.INFO, SWEPT_LINE)]


def test_a_line_is_logged_only_when_it_differs_from_the_last_one(logged: Callable[[], list[tuple[int, str]]]) -> None:
    ticks(sweeps(NO_ANSWER, NO_ANSWER, NO_ANSWER, REFUSED, REFUSED, NO_ANSWER), 6)
    assert logged() == [(logging.INFO, NO_ANSWER_LINE), (logging.INFO, REFUSED_LINE), (logging.INFO, NO_ANSWER_LINE)]


def test_a_line_is_logged_for_each_sweep_that_sent_a_text_also_when_the_line_is_the_same(
    logged: Callable[[], list[tuple[int, str]]],
) -> None:
    ticks(sweeps(SWEPT, SWEPT), 2)
    assert logged() == [(logging.INFO, SWEPT_LINE), (logging.INFO, SWEPT_LINE)]


def test_a_sweep_that_is_off_says_so_one_time(logged: Callable[[], list[tuple[int, str]]]) -> None:
    ticks(lambda: OFF, 5)
    assert logged() == [(logging.INFO, OFF_LINE)]


@pytest.mark.parametrize("quiet", [IDLE, WAITING])
def test_a_sweep_with_nothing_to_say_logs_nothing_and_keeps_the_last_line(
    logged: Callable[[], list[tuple[int, str]]], quiet: SweepResult
) -> None:
    assert local_runner.sweep_tick(lambda: quiet, REFUSED_LINE) == REFUSED_LINE
    assert logged() == []

    # A gap waits between its tries, and the sweeps in between have nothing to say. The same
    # refusal after them is not a new line.
    ticks(sweeps(REFUSED, quiet, quiet, REFUSED), 4)
    assert logged() == [(logging.INFO, REFUSED_LINE)]


def test_a_sweep_that_raises_is_logged_by_its_kind_and_the_last_line_stays(
    logged: Callable[[], list[tuple[int, str]]],
) -> None:
    broken = sweeps(RuntimeError("the sweep broke with +14155550101 in its words"))

    assert local_runner.sweep_tick(broken, SWEPT_LINE) == SWEPT_LINE

    assert logged() == [(logging.WARNING, "text sweep failed (RuntimeError)")]
    assert "415555" not in str(logged())


def test_the_loop_waits_first_and_sweeps_second(logged: Callable[[], list[tuple[int, str]]]) -> None:
    """The waits of the sweep are in memory, so a runner that starts again and again sweeps nothing."""
    did: list[str] = []

    def sweep() -> SweepResult:
        did.append("sweep")
        return REFUSED

    def sleep(seconds: float) -> None:
        if did.count("sweep") == 2:
            raise Stop
        did.append(f"wait {seconds}")

    with pytest.raises(Stop):
        local_runner.sweep_loop(sweep, sleep)

    # The first thing is the wait. No sweep runs before it, and one wait is before each sweep.
    assert did == [f"wait {SWEEP_EVERY_S}", "sweep", f"wait {SWEEP_EVERY_S}", "sweep"]
    # The loop carries the last line from one sweep to the next.
    assert logged() == [(logging.INFO, REFUSED_LINE)]


def test_a_runner_that_stops_in_its_first_wait_did_not_sweep() -> None:
    swept: list[str] = []

    def sleep(_seconds: float) -> None:
        raise Stop

    with pytest.raises(Stop):
        local_runner.sweep_loop(lambda: swept.append("sweep") or SWEPT, sleep)

    assert swept == []


def test_a_sweep_that_raises_does_not_end_the_loop(logged: Callable[[], list[tuple[int, str]]]) -> None:
    slept: list[float] = []

    def sleep(seconds: float) -> None:
        # Four waits and four sweeps, then the wait that ends the test.
        if len(slept) == 4:
            raise Stop
        slept.append(seconds)

    with pytest.raises(Stop):
        local_runner.sweep_loop(sweeps(REFUSED, ValueError("the rule itself broke"), REFUSED, OFF), sleep)

    assert slept == [SWEEP_EVERY_S] * 4
    assert logged() == [
        (logging.INFO, REFUSED_LINE),
        (logging.WARNING, "text sweep failed (ValueError)"),
        # The line before the failure is the last line, so it is not said a second time.
        (logging.INFO, OFF_LINE),
    ]


def test_the_loop_makes_its_sweep_one_time_because_the_sweep_keeps_the_waits(monkeypatch: pytest.MonkeyPatch) -> None:
    made: list[str] = []
    ran: list[str] = []

    def draft_sweep() -> Callable[[], SweepResult]:
        made.append("made")
        return lambda: ran.append("ran") or IDLE

    def sleep(_seconds: float) -> None:
        if len(ran) == 3:
            raise Stop

    monkeypatch.setattr(local_runner, "draft_sweep", draft_sweep)
    with pytest.raises(Stop):
        local_runner.sweep_loop(sleep=sleep)

    assert made == ["made"]
    assert ran == ["ran"] * 3


def test_the_runner_starts_the_heartbeat_and_the_sweep_as_threads_that_end_with_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started: list[tuple[Any, bool]] = []

    class Thread:
        def __init__(self, target: Any, daemon: bool = False, **_more: Any) -> None:
            self.target, self.daemon = target, daemon

        def start(self) -> None:
            started.append((self.target, self.daemon))

    def stop() -> None:
        raise Stop

    # Only the runner's own names change, so no other thread of the test run is touched.
    monkeypatch.setattr(local_runner, "threading", SimpleNamespace(Thread=Thread))
    monkeypatch.setattr(local_runner.logging, "basicConfig", lambda **_settings: None)
    # The first poll for a queued run ends the runner, so the test does not poll for ever.
    monkeypatch.setattr(local_runner.db, "claim_queued_local", stop)

    with pytest.raises(Stop):
        local_runner.main()

    assert started == [(local_runner.heartbeat_loop, True), (local_runner.sweep_loop, True)]

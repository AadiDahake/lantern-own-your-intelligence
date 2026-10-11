"""The sweep: a later pass for each person who is still owed a text while the draft is open.

The pass at the draft runs one time. A person who is still owed after that pass had no way to the
text: the provider refused the number at that moment, the pass stopped at a failure, or its time
ran out. So the worker runs this sweep in its runner (`local_runner.py`). It reads the gaps that
have an open draft, which no person has decided, and a person who is owed, and it runs the same
pass (`send_draft_notice`) for each one. The claim and the one-text rule are those of the first
pass, so a sweep and a run, or two runners, cannot text one person two times for one consent.

This is the worker's copy of the rule in `apps/web/lib/sms/sweep.ts`, which the forge runner
runs; change them together. `packages/shared/test/fixtures/sms-sweep.json` holds scenarios, and
`tests/test_sms_sweep.py` runs each one against this module as the web app's suite runs them
against the TypeScript.

A later try must not cost more people than it helps. Four rules hold that:

- The provider is asked one read-only question first. When it does not answer as itself, the
  sweep claims no one and sends nothing. An outage, a wrong address and a key that stopped
  working then cost no person their text, however many sweeps run in that time.
- A text with no confirmed answer costs one person their text, and the next send is expected to
  end the same way. It stops the whole sweep, and the next send waits: 10 minutes, then 2 times
  as long each time, up to 6 hours. One confirmed text ends that wait. A refusal that is not
  about one person (no credit, a key that the provider does not take) stops the sweep in the
  same way; it costs no person a text, and one try for each wait is enough to see it end.
- A gap whose pass left people and confirmed no text waits in the same way, by itself. A number
  that the provider refuses each time (a region that it does not serve) is then tried a few
  times a day and not each 5 minutes, and it holds back no other gap that the sweep reads.
- The gap with the least trouble goes first, and the gap of a text with no confirmed answer waits
  by itself too. So the gap that caused a stop is not the first try after the wait.

The waits are in the memory of the process, so a worker that starts again starts with no wait.
A runner therefore makes its first sweep one interval after it starts, not at the start: a runner
that stops within that interval of each start sweeps nothing. The waits are measured on a clock
that only goes forward (`time.monotonic`).

A phone number is never in a result, a trace row, or a log line.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import config
from config import SmsSender
from steps import db, dial
from steps.sms_notice import GapSubscribers, NoticeOutcome, send_draft_notice, thrown_message

# How often a runner starts a sweep, and how long after its start the first one comes.
SWEEP_EVERY_S = 300.0

# The first wait after a pass that must not be repeated at once. Each next wait is 2 times as long.
FIRST_WAIT_S = 600.0

# The longest wait. A number that is refused each time is then tried 4 times a day. It is also how
# long a gap that is not in the list is remembered, with its wait and its last row.
MAX_WAIT_S = 21600.0

# The most gaps one sweep reads. The list has the gaps that wait in it too, so a deployment with
# more owed gaps than this, where each one waits, gives the gaps past the end no pass.
SWEEP_GAPS = 1000


@dataclass(frozen=True)
class OwedGap:
    """A gap with an open draft that no person has decided, and at least one person who is owed.

    `escalation_id` is the gap's own run, whose draft is open, so the sweep's row is in that
    run's trace.
    """

    project_id: str
    group_id: str
    escalation_id: str | None


# The fields that each state of a result has. A different field keeps its default and says nothing.
_FIELDS: dict[str, tuple[str, ...]] = {
    "off": ("reason",),
    "waiting": (),
    "failed": ("reason",),
    "idle": ("owed",),
    "provider": ("reason", "gaps"),
    "swept": ("gaps", "sent", "left", "stop"),
}


@dataclass(frozen=True)
class SweepResult:
    """How one sweep ended.

    - `off`: text messages are not configured. `reason` names the variable. Nothing was read.
    - `waiting`: the provider did not take a send a short time ago, so nothing is sent yet.
      Nothing was read.
    - `failed`: the sweep could not run. `reason` is the words of the database error for the
      list of gaps, and the kind of the error for anything else.
    - `idle`: no gap is due. `owed` gaps have people left and wait for their next try.
    - `provider`: the provider did not answer the read-only question, so no one was claimed.
      `reason` is a short code, and `gaps` gaps were due.
    - `swept`: `gaps` passes ran and `sent` texts were confirmed. `left` gaps still have a person
      who is owed. `stop` says why the sweep ended before each due gap had its pass:
      `unconfirmed` (a text had no confirmed answer), `refused` (a send was refused for a cause
      that is not the person), or None.
    """

    state: Literal["off", "waiting", "failed", "idle", "provider", "swept"]
    reason: str = ""
    owed: int = 0
    gaps: int = 0
    sent: int = 0
    left: int = 0
    stop: Literal["unconfirmed", "refused"] | None = None

    def as_dict(self) -> dict[str, Any]:
        """The state and only the fields of that state: the shape that the web app's copy gives."""
        return {"state": self.state, **{name: getattr(self, name) for name in _FIELDS[self.state]}}


class SweepDeps(Protocol):
    def owed_gaps(self, limit: int) -> list[OwedGap]:
        """The gaps with an open draft and a person who is owed a text, at most `limit`."""

    def provider_answers(self) -> tuple[bool, str]:
        """Asks the provider one read-only question. Sends nothing. False comes with a short code."""

    def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
        """The same pass that runs at the draft, for one gap, and how it ended.

        The second value is true when a send of the pass was refused for a cause that is not the
        person (the key, the credit, the provider's address): the pass stopped there, and the
        next send is expected to end the same way.
        """

    def say(self, gap: OwedGap, title: str, status: str, detail: dict[str, Any]) -> None:
        """Writes one trace row for the gap."""


def longer_wait(wait_s: float) -> float:
    """The next wait after `wait_s`: 10 minutes first, then 2 times as long, at most 6 hours."""
    return min(max(wait_s * 2, FIRST_WAIT_S), MAX_WAIT_S)


def _count(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else many or f'{one}s'}"


_STOPPED = {
    "unconfirmed": ", stopped at a text with no confirmed answer",
    "refused": ", stopped at a refusal that is not about one person",
}


def sweep_line(result: SweepResult) -> str | None:
    """What a runner logs about a sweep, or None when there is nothing to say.

    There is nothing to say when no gap was due, or when the sweep waits. The reasons are short
    codes and the words of a database error.
    """
    if result.state == "off":
        return f"text sweep: off, {result.reason}"
    if result.state == "failed":
        return f"text sweep: failed ({result.reason})"
    if result.state == "provider":
        return (
            f"text sweep: nothing sent for {_count(result.gaps, 'gap')}, "
            f"the text message provider did not answer ({result.reason})"
        )
    if result.state == "swept":
        stop = _STOPPED.get(result.stop or "", "")
        return (
            f"text sweep: {_count(result.sent, 'text')} sent in {_count(result.gaps, 'pass', 'passes')}, "
            f"{_count(result.left, 'gap')} still with a person who is owed{stop}"
        )
    return None


def _detail_of(outcome: dict[str, Any]) -> dict[str, Any]:
    return {"notice": "draft_sms", "pass": "later", **outcome}


def later_pass_trace(outcome: NoticeOutcome) -> tuple[str, str, dict[str, Any]] | None:
    """The row for a later pass: its title, its status and its detail.

    None when the pass has nothing to say: no one was left for it, or a different run took each
    person and reports them itself.
    """
    if outcome.state == "off":
        return None
    if outcome.state == "failed":
        return "Text notice, later pass: could not read who is owed a text", "failed", _detail_of(outcome.detail())
    if outcome.asked == 0:
        return None
    status = "ok" if outcome.sent == outcome.asked else "failed"
    return f"Text notice, later pass: {outcome.sent} of {outcome.asked} sent", status, _detail_of(outcome.detail())


def provider_wait_trace(reason: str) -> tuple[str, str, dict[str, Any]]:
    """The row for a sweep that sent nothing because the provider did not answer the question."""
    return (
        "Text notice, later pass: not sent yet, the text message provider did not answer",
        "failed",
        _detail_of({"state": "waiting", "reason": reason}),
    )


@dataclass
class _Wait:
    """A wait, and the moment that it ends. A clock is never under 0, so 0 is "no wait"."""

    wait_s: float = 0.0
    not_before: float = 0.0


@dataclass
class _GapState(_Wait):
    """A gap's own wait, the last row that the sweep wrote for it, and since when it is missing.

    `missing` is the time of the first list that did not have the gap. It is None while the list
    has it.
    """

    said: str = ""
    missing: float | None = None


class Sweeper:
    """One runner's sweep. It keeps the waits, so a runner makes one and calls `run` on a timer."""

    def __init__(self) -> None:
        # The wait after a send that the provider did not take. It holds back each gap.
        self._provider = _Wait()
        # Only the gaps that the sweep has something to remember about.
        self._gaps: dict[str, _GapState] = {}

    def _state(self, gap: OwedGap) -> _GapState:
        return self._gaps.setdefault(gap.group_id, _GapState())

    def _not_before(self, gap: OwedGap) -> float:
        """The moment that the gap's wait ends. A gap with nothing to remember has no wait."""
        state = self._gaps.get(gap.group_id)
        return state.not_before if state else 0.0

    def _wait_of(self, gap: OwedGap) -> float:
        state = self._gaps.get(gap.group_id)
        return state.wait_s if state else 0.0

    def _tell(self, deps: SweepDeps, gap: OwedGap, row: tuple[str, str, dict[str, Any]], words: str) -> None:
        """Writes a row only when it differs from the last row that this sweeper wrote for the gap.

        A number that is refused on each try then gives one row, not one row for each try.
        `words` is what makes two rows the same. A row that could not be written is tried again
        with the next pass.
        """
        title, status, detail = row
        state = self._state(gap)
        if state.said == words:
            return
        try:
            deps.say(gap, title, status, detail)
            state.said = words
        except Exception:  # noqa: BLE001 - the texts count, not the row about them
            pass

    def _grow(self, gap: OwedGap, now: float) -> None:
        state = self._state(gap)
        state.wait_s = longer_wait(state.wait_s)
        state.not_before = now + state.wait_s

    def run(self, deps: SweepDeps, now: Callable[[], float] = time.monotonic) -> SweepResult:
        """One sweep. Never raises."""
        if now() < self._provider.not_before:
            return SweepResult("waiting")

        try:
            owed = deps.owed_gaps(SWEEP_GAPS)
        except Exception as error:  # noqa: BLE001 - a list that cannot be read is a result
            return SweepResult("failed", reason=thrown_message(error))
        # A gap can be out of one list and owed again in the next: a different runner holds its
        # one person for the moment of a send. So a gap is forgotten only when no list had it for
        # the longest wait, counted from the first list without it. A sweep that read nothing for
        # hours then forgets nothing at its first list.
        read = now()
        listed = {gap.group_id for gap in owed}
        for group_id, state in list(self._gaps.items()):
            if group_id in listed:
                state.missing = None
            elif state.missing is None:
                state.missing = read
            elif read - state.missing > MAX_WAIT_S:
                del self._gaps[group_id]

        # The gap with the least trouble first; the order of the list for the rest.
        due = sorted((gap for gap in owed if now() >= self._not_before(gap)), key=self._wait_of)
        if not due:
            return SweepResult("idle", owed=len(owed))

        try:
            ok, reason = deps.provider_answers()
        except Exception:  # noqa: BLE001 - a question that fails is a provider that did not answer
            ok, reason = False, "check_failed"
        if not ok:
            # One row for as long as the provider does not answer, whatever the reason of each
            # try is: a reason that changes from sweep to sweep must not write a row for each gap
            # each time.
            row = provider_wait_trace(reason)
            for gap in due:
                self._tell(deps, gap, row, row[0])
            return SweepResult("provider", reason=reason, gaps=len(due))

        passes = sent = 0
        # The gaps that wait for their own next try still have their people.
        left = len(owed) - len(due)
        stop: Literal["unconfirmed", "refused"] | None = None
        for gap in due:
            try:
                outcome, refused_for_all = deps.run_pass(gap)
            except Exception as error:  # noqa: BLE001 - a pass that fails is a list that was not read
                outcome, refused_for_all = NoticeOutcome("failed", reason=thrown_message(error)), False
            passes += 1
            # The caller reads the configuration before the sweep, so this is a pass that did nothing.
            if outcome.state == "off":
                continue
            row = later_pass_trace(outcome)
            if row:
                self._tell(deps, gap, row, json.dumps([row[0], row[2]]))

            confirmed = outcome.sent if outcome.state == "done" else 0
            unconfirmed = outcome.unconfirmed if outcome.state == "done" else 0
            people_left = outcome.state == "failed" or outcome.asked > confirmed + unconfirmed
            sent += confirmed
            if people_left:
                left += 1
            if confirmed > 0:
                # A confirmed text is the one proof that the provider takes a text now, and the
                # gap made progress: each wait starts from nothing.
                self._provider = _Wait()
                state = self._gaps.get(gap.group_id)
                if state:
                    state.wait_s, state.not_before = 0.0, 0.0

            if unconfirmed > 0 or refused_for_all:
                # The provider did not take a send, and the next send is expected to end the same
                # way. After a text with no confirmed answer each such send costs a person, so no
                # gap is tried before the wait ends.
                wait_s = longer_wait(self._provider.wait_s)
                self._provider = _Wait(wait_s, now() + wait_s)
                # The cause can be this gap alone. It waits too, so a different gap is the next try.
                if unconfirmed > 0:
                    self._grow(gap, now())
                left += len(due) - passes
                stop = "unconfirmed" if unconfirmed > 0 else "refused"
                break
            if people_left and confirmed == 0:
                self._grow(gap, now())
        return SweepResult("swept", gaps=passes, sent=sent, left=left, stop=stop)


def _gap_of(row: dict[str, Any]) -> OwedGap:
    # A relation to one row comes back as an object.
    run = row.get("escalation")
    if isinstance(run, list):
        run = run[0] if run else None
    run_id = run.get("id") if isinstance(run, dict) else None
    return OwedGap(str(row["project_id"]), str(row["id"]), run_id if isinstance(run_id, str) else None)


class _Wired:
    """What a sweep needs, from the database and the provider, for one sender."""

    def __init__(self, sender: SmsSender) -> None:
        self._sender = sender

    def owed_gaps(self, limit: int) -> list[OwedGap]:
        return [_gap_of(row) for row in db.owed_gaps(limit)]

    def provider_answers(self) -> tuple[bool, str]:
        # The account's numbers. The call sends nothing.
        return dial.provider_answers(self._sender)

    def run_pass(self, gap: OwedGap) -> tuple[NoticeOutcome, bool]:
        # A person can have decided the draft after the list was read.
        if not db.draft_still_open(gap.project_id, gap.group_id):
            return NoticeOutcome("done"), False
        # The sweep gives the pass its sender, so it sees what the pass sees: a refusal that is
        # not about the person ends the pass, and the sweep must stop there too.
        refused_for_all = False

        def send(to: str, body: str) -> dial.SmsResult:
            nonlocal refused_for_all
            result = dial.send_sms(self._sender, to, body)
            if result.state == "refused" and result.for_all:
                refused_for_all = True
            return result

        outcome = send_draft_notice(GapSubscribers(gap.project_id, gap.group_id), send)
        return outcome, refused_for_all

    def say(self, gap: OwedGap, title: str, status: str, detail: dict[str, Any]) -> None:
        # In the trace of the gap's own run, so a person who reads why a text did not come finds
        # the later pass in the same trace as the first one.
        db.emit_trace(gap.project_id, gap.escalation_id, "status", title, status, detail)


def draft_sweep() -> Callable[[], SweepResult]:
    """The sweep for one runner. The function that comes back never raises.

    That function keeps the waits, so a runner makes it one time and calls it on a timer. It
    reads the configuration on each call. Off, with the name of the missing variable, when text
    messages are not configured; the database and the provider are not called in that case.
    """
    sweeper = Sweeper()

    def sweep() -> SweepResult:
        try:
            sender, reason = config.sms_sender()
            if sender is None:
                return SweepResult("off", reason=reason)
            return sweeper.run(_Wired(sender))
        except Exception as error:  # noqa: BLE001 - a sweep that fails never stops the runner
            # The kind of failure only: nothing planned for this error, so its words are not
            # printed where a person's number was just handled.
            return SweepResult("failed", reason=type(error).__name__)

    return sweep

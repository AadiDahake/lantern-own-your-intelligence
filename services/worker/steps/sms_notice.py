"""The one text a person asked for: sent when the draft change for the gap they reported opens.

This is the worker's copy of the rule in `apps/web/lib/sms` (`notice.ts` and `subscribers.ts`), so
a person gets the same one text whichever engine builds the change. "The text notice" in section
4 of `docs/contracts.md` is the contract for both.

One gap is one text for one person, however the runs overlap:

- A person is claimed before the send, with a conditional update that only one run wins. The
  send call has no idempotency key, so the claim is the only thing that stops a second text.
- A text that was refused was not sent, so the claim is released and the text is still owed.
- A text with no answer may have gone. The claim stays, and nobody sends it again.
- A refusal that is not about the person (the key, the credit, the provider's address) stops
  the pass, and so does a text with no answer: the next send is expected to end the same way,
  and each such send would cost one more person their text. The people who are left are not
  claimed, so they are still owed.
- One pass texts at most `PASS_LIMIT` people and goes on to the next person for at most
  `PASS_BUDGET_S`, so the run that waits for it is never held for long.

The pass at the draft runs one time. A person who is still owed after it (a refusal, a pass that
stopped, the time budget) is texted by the sweep (`steps/sms_sweep.py`) while the draft is open.

A phone number is never in an outcome, a reason, a trace row or a log line.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Protocol

import config
from steps import db, dial, seal
from steps.dial import SmsResult
from steps.sms_text import draft_notice_text, is_e164

# The most people one pass texts. The sends are one after the other, and a run waits for them.
PASS_LIMIT = 200

# The longest a pass goes on to the next person. One more send can end after it.
PASS_BUDGET_S = 60.0

# A claim is held for one send and one write, which is seconds. A claim older than this with a
# number still stored is what a stopped run left behind.
STALE_CLAIM = timedelta(minutes=15)

# The purpose a phone number is sealed under (`apps/web/lib/sms/phone.ts`).
PHONE_PURPOSE = "subscriber-phone"


@dataclass(frozen=True)
class NoticeOutcome:
    """How a notice ended.

    - `off`: text messages are not configured. `reason` names the variable.
    - `failed`: the list of people could not be read, so nothing was sent.
    - `done`: this run had `asked` people to text. `sent` texts were confirmed, and `unconfirmed`
      may or may not have gone. The rest were not sent; `reasons` says why, as short codes.
      `taken` people were claimed by a different run at the same moment, which reports them
      itself.
    """

    state: Literal["off", "failed", "done"]
    reason: str = ""
    asked: int = 0
    sent: int = 0
    unconfirmed: int = 0
    taken: int = 0
    reasons: tuple[str, ...] = ()

    def detail(self) -> dict[str, Any]:
        """The `detail` of the trace row, in the shape the contract gives for both engines."""
        if self.state != "done":
            return {"notice": "draft_sms", "state": self.state, "reason": self.reason}
        return {
            "notice": "draft_sms",
            "state": "done",
            "asked": self.asked,
            "sent": self.sent,
            "unconfirmed": self.unconfirmed,
            "taken": self.taken,
            "reasons": list(self.reasons),
        }


@dataclass(frozen=True)
class Owed:
    """A person who is owed the text. `phone` is None when the stored number does not open.

    The number is not in the `repr`, so a traceback or a log line that shows this value shows the
    id only.
    """

    id: str
    phone: str | None = field(repr=False)


class NoticeStore(Protocol):
    def names(self) -> tuple[str, str]:
        """What the text names: the company the person knows, and the gap's title."""

    def owed(self, limit: int) -> list[Owed]:
        """The people who agreed to a text and have not had it, oldest first, at most `limit`."""

    def claim(self, person_id: str) -> bool:
        """Takes one person for this run. False when a different run already took them."""

    def settle(self, person_id: str, state: str) -> None:
        """Records how the send ended: erase the number, or release the claim after a refusal."""

    def forget_stale(self) -> None:
        """Erases the numbers of claims that are older than any send can be."""


SendText = Callable[[str, str], SmsResult]


def thrown_message(error: BaseException) -> str:
    """The words of anything that was raised, cut short."""
    return (str(error) or type(error).__name__)[:300]


def send_draft_notice(
    store: NoticeStore, send: SendText, now: Callable[[], float] = time.monotonic
) -> NoticeOutcome:
    """Sends the text to each person who is owed it. Never raises."""
    deadline = now() + PASS_BUDGET_S
    reasons: set[str] = set()
    try:
        try:
            store.forget_stale()
        except Exception:  # noqa: BLE001 - an old number that stays is not a reason to text no one
            reasons.add("cleanup_failed")
        company, title = store.names()
        # One more than a pass takes, so the outcome can say that people are left.
        owed = store.owed(PASS_LIMIT + 1)
        body = draft_notice_text(company, title)
    except Exception as error:  # noqa: BLE001 - a notice that fails never fails the run
        return NoticeOutcome("failed", reason=thrown_message(error))

    asked = len(owed)
    taken = sent = unconfirmed = 0
    if len(owed) > PASS_LIMIT:
        reasons.add("pass_limit")
    for person in owed[:PASS_LIMIT]:
        if now() > deadline:
            reasons.add("time_budget")
            break
        if not person.phone or not is_e164(person.phone):
            # Not claimed and not erased: a runner with the wrong service role key reads every
            # number this way, and that mistake must not destroy what people gave.
            reasons.add("unreadable_number")
            continue
        try:
            claimed = store.claim(person.id)
        except Exception:  # noqa: BLE001 - not knowing who holds the claim is a reason not to send
            reasons.add("claim_failed")
            continue
        if not claimed:
            asked -= 1
            taken += 1
            continue
        try:
            result = send(person.phone, body)
        except Exception:  # noqa: BLE001 - the text may have gone, so it is not sent again
            result = SmsResult("unconfirmed", "send_failed")
        if result.state == "sent":
            sent += 1
        else:
            reasons.add(result.reason)
            if result.state == "unconfirmed":
                unconfirmed += 1
        try:
            store.settle(person.id, result.state)
        except Exception:  # noqa: BLE001 - the text is counted as it ended; the claim still holds
            reasons.add("settle_failed")
        if result.state == "unconfirmed" or (result.state == "refused" and result.for_all):
            break
    return NoticeOutcome(
        "done", asked=asked, sent=sent, unconfirmed=unconfirmed, taken=taken, reasons=tuple(sorted(reasons))
    )


def notice_trace(outcome: NoticeOutcome) -> tuple[str, str, dict[str, Any]]:
    """The one trace row a notice writes: its title, its status and its detail."""
    detail = outcome.detail()
    if outcome.state == "off":
        return "Text notice: off", "ok", detail
    if outcome.state == "failed":
        return "Text notice: could not read who asked for a text", "failed", detail
    if outcome.asked == 0:
        if outcome.taken > 0:
            return "Text notice: a different run sent the texts", "ok", detail
        return "Text notice: no one asked for a text about this request", "ok", detail
    status = "ok" if outcome.sent == outcome.asked else "failed"
    return f"Text notice: {outcome.sent} of {outcome.asked} sent", status, detail


class GapSubscribers:
    """The people who asked for a text about one gap, in the database (`steps/db.py`)."""

    def __init__(self, project_id: str, group_id: str) -> None:
        self.project_id = project_id
        self.group_id = group_id

    def names(self) -> tuple[str, str]:
        return db.notice_names(self.project_id, self.group_id)

    def owed(self, limit: int) -> list[Owed]:
        rows = db.owed_subscribers(self.project_id, self.group_id, limit)
        return [Owed(str(row["id"]), seal.unseal(PHONE_PURPOSE, str(row["phone_sealed"]))) for row in rows]

    def claim(self, person_id: str) -> bool:
        return db.claim_subscriber(self.project_id, self.group_id, person_id)

    def settle(self, person_id: str, state: str) -> None:
        # A refused text is still owed, so the claim goes back. In every other case the number has
        # done its work, or must not be used again, and is erased.
        if state == "refused":
            db.release_subscriber(self.project_id, self.group_id, person_id)
        else:
            db.erase_subscriber_phone(self.project_id, self.group_id, person_id)

    def forget_stale(self) -> None:
        db.forget_stale_subscribers(self.project_id, datetime.now(timezone.utc) - STALE_CLAIM)


def draft_notice(project_id: str, group_id: str) -> NoticeOutcome:
    """The notice for one run. Never raises.

    Off, with the name of the missing variable, when text messages are not configured; the
    database is not read in that case, so a worker with no provider and no `gap_subscriber` table
    behaves as it did.
    """
    try:
        sender, reason = config.sms_sender()
        if sender is None:
            return NoticeOutcome("off", reason=reason)
        if not group_id:
            return NoticeOutcome("done")
        return send_draft_notice(
            GapSubscribers(project_id, group_id), lambda to, body: dial.send_sms(sender, to, body)
        )
    except Exception as error:  # noqa: BLE001 - a notice that fails never fails the run
        return NoticeOutcome("failed", reason=thrown_message(error))

"""The escalation runner.

Polls `escalation` rows with status='queued' and engine='local' every 2 s, runs the steps in order,
and implements the pause by polling `escalation.approval` every 3 s until the console sets it.
Each run gets its own thread, because a run waiting on a human must not hold up the issue-only and
count-update runs behind it. Run with `vault-exec uv run python local_runner.py`.

Two more threads run for as long as the runner does. One sends the heartbeat each 60 s. The other
runs the sweep for owed texts each 5 minutes: a later pass for each person who is still owed a
text while a draft is open (`steps/sms_sweep.py`). The first sweep comes 5 minutes after the
start, not at the start.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from models import Approval, FeatureRequestInput
from steps import db, pipeline
from steps.sms_sweep import SWEEP_EVERY_S, SweepResult, draft_sweep, sweep_line
from heartbeat import beat_once

POLL_S = 2
APPROVAL_POLL_S = 3
log = logging.getLogger("lantern.local")


def request_from_row(row: dict[str, Any]) -> FeatureRequestInput:
    request = row.get("request") or {}
    project = db.get_project(row["project_id"]) or {}
    # The group carries the weight of this request, so the run reads it fresh off the row's group.
    group = db.get_group(row["group_id"]) if row.get("group_id") else None
    mode = str(row.get("mode") or "full")
    return FeatureRequestInput(
        escalation_id=row["id"],
        project_id=row["project_id"],
        repo_full_name=request.get("repo_full_name") or project.get("repo_full_name") or "",
        default_branch=request.get("default_branch") or project.get("repo_default_branch") or "main",
        title=request.get("title", ""),
        description=request.get("description", ""),
        area=request.get("area", "") or "",
        quote=request.get("quote", "") or "",
        rationale=request.get("rationale", "") or "",
        conversation_excerpt=request.get("conversation_excerpt", "") or "",
        site_url=request.get("site_url") or project.get("site_url") or "",
        group_id=str(row.get("group_id") or ""),
        trace_escalation_id=str((group or {}).get("escalation_id") or "") if mode == "update" else "",
        report_count=int((group or {}).get("report_count") or 1),
        user_report_count=int((group or {}).get("user_report_count") or 0),
        priority=str((group or {}).get("priority") or ""),
        issue_number=int((group or {}).get("issue_number") or 0),
        file_only=mode == "file_only",
        update_only=mode == "update",
    )


def wait_for_approval(escalation_id: str) -> Approval:
    while True:
        row = db.get_escalation(escalation_id) or {}
        approval = row.get("approval")
        if isinstance(approval, dict) and "approved" in approval:
            return Approval(approved=bool(approval["approved"]), note=str(approval.get("note") or ""))
        time.sleep(APPROVAL_POLL_S)


def run_escalation(row: dict[str, Any]) -> None:
    req = request_from_row(row)
    step = "update_group" if req.update_only else "file_issue"
    try:
        if req.update_only:
            outcome = pipeline.update_group(req)
            log.info("escalation %s finished: %s", req.escalation_id, outcome.status)
            return
        issue = pipeline.file_issue(req)
        if req.file_only:
            log.info("escalation %s filed issue #%s and stopped", req.escalation_id, issue.number)
            return
        step = "inspect_repository"
        plan = pipeline.inspect_repository(req, issue)
        step = "draft_implementation"
        draft = pipeline.draft_implementation(req, issue, plan)
        step = "open_draft_pr"
        pr = pipeline.open_draft_pr(req, issue, plan, draft)
        decision = wait_for_approval(req.escalation_id)
        step = "merge_and_deploy"
        outcome = pipeline.merge_and_deploy(req, issue, pr, decision)
        log.info("escalation %s finished: %s", req.escalation_id, outcome.status)
    except Exception as error:  # noqa: BLE001 - record the failure, keep polling
        log.exception("escalation %s failed in %s", req.escalation_id, step)
        pipeline.fail(req, step, error)


def heartbeat_loop() -> None:
    while True:
        try:
            beat_once("local")
        except Exception as error:  # noqa: BLE001
            log.warning("heartbeat failed: %s", error)
        time.sleep(60)


def sweep_tick(sweep: Callable[[], SweepResult], last_line: str) -> str:
    """One sweep for owed texts. Returns the last line that a sweep had, for the next tick.

    Never raises. A line is logged when it differs from the last line, and always when a text was
    sent. So a sweep that is off, or that meets the same refusal at each try, says it one time,
    and no text goes out with no line. A sweep with nothing to say keeps the last line. A sweep
    that raises is logged by its kind, and the last line stays. (`draft_sweep` does not raise: it
    gives a `failed` result with the kind of the error.)
    """
    try:
        result = sweep()
        line = sweep_line(result)
    except Exception as error:  # noqa: BLE001 - a failed sweep must not stop the next one
        # The kind of failure only: the words of an error are not written where a person's
        # number was just handled.
        log.warning("text sweep failed (%s)", type(error).__name__)
        return last_line
    if line and (line != last_line or (result.state == "swept" and result.sent > 0)):
        log.info("%s", line)
    return line or last_line


def sweep_loop(
    sweep: Callable[[], SweepResult] | None = None, sleep: Callable[[float], None] = time.sleep
) -> None:
    """A wait, then one sweep, for as long as the runner runs.

    The first sweep comes one wait after the start, not at the start. The waits of the sweep are
    in memory, so a runner that stops and starts in a loop must not try the same send with each
    start. The next sweep starts only after the last one ends, because a sweep sends one text
    after the other and can take longer than the wait.
    """
    # Made one time: the function keeps the waits of the sweep.
    sweep = sweep or draft_sweep()
    last_line = ""
    while True:
        sleep(SWEEP_EVERY_S)
        last_line = sweep_tick(sweep, last_line)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    threading.Thread(target=sweep_loop, daemon=True).start()
    log.info("local runner polling for queued escalations and owed texts")
    while True:
        try:
            row = db.claim_queued_local()
        except Exception as error:  # noqa: BLE001
            log.warning("poll failed: %s", error)
            row = None
        if row:
            threading.Thread(target=run_escalation, args=(row,), daemon=True).start()
        else:
            time.sleep(POLL_S)


if __name__ == "__main__":
    main()

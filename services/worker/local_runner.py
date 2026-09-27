"""The escalation runner.

Polls `escalation` rows with status='queued' and engine='local' every 2 s, runs the steps in order,
and implements the pause by polling `escalation.approval` every 3 s until the console sets it.
Each run gets its own thread, because a run waiting on a human must not hold up the issue-only and
count-update runs behind it. Run with `vault-exec uv run python local_runner.py`.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from models import Approval, FeatureRequestInput
from steps import db, pipeline
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


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    log.info("local runner polling for queued escalations")
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

"""The five synchronous steps of an escalation. Activities and the local runner both call these."""

from __future__ import annotations

import re
import shutil
import tempfile
import time
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path

import config
from models import Approval, Draft, FeatureRequestInput, IssueRef, Outcome, Plan, PrRef
from steps import codegen, db, deploy, drafting, issue as issue_text, llm, mcp_github, repo, slack, trace
from steps.github import GitHubClient
from steps.github_token import project_token
from steps.reporter import Reporter

PAUSE_LABEL = "Merge this pull request?"

# How long a run that lost the race for a group's issue waits for the winner to file it, and how
# often it looks. Filing an issue is a handful of GitHub calls, so half a minute is generous; a
# waiter that gives up takes the slot over rather than leaving the request unfiled.
ISSUE_WAIT_S = 30
ISSUE_POLL_S = 1.0

# What went wrong, in the words a person reads in the console. The step name means nothing to them.
STEP_FAILURES = {
    "file_issue": "Lantern could not open the issue for this request.",
    "inspect_repository": "Lantern could not read the repository to plan this change.",
    "draft_implementation": "Lantern could not get a change past the repository's own checks.",
    "open_draft_pr": "Lantern could not open the pull request for this change.",
    "merge_and_deploy": "Lantern could not finish merging and releasing this change.",
    "update_group": "Lantern could not add this new report to the issue.",
}


def _slug(text: str, limit: int = 40) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:limit].rstrip("-") or "change"


def _set_status(req: FeatureRequestInput, status: str, **fields: object) -> None:
    db.update_escalation(req.escalation_id, status=status, **fields)
    trace.status(req.project_id, req.trace_id(), f"Status: {status.replace('_', ' ')}", detail={"status": status})


def _set_group(req: FeatureRequestInput, **fields: object) -> None:
    """Carry a run's progress back to the group, which is what the console lists."""
    if req.group_id:
        db.update_group(req.group_id, **fields)


def _open_pull_request(req: FeatureRequestInput) -> str:
    """The pull request this run already opened, from its own row or from its group.

    Reads on the failure path are best effort: this often runs because the database was the thing
    that was unreachable, and not knowing about a pull request must never stop the failure being
    recorded.
    """
    try:
        rows = (db.get_escalation(req.escalation_id), db.get_group(req.group_id) if req.group_id else None)
    except Exception:  # noqa: BLE001 - see above
        return ""
    for row in rows:
        url = str((row or {}).get("pr_url") or "")
        if url:
            return url
    return ""


def _reopen_for_retry(req: FeatureRequestInput) -> None:
    """Leave the group where a later report can pick it up again.

    A run that died mid-draft leaves the group reading `drafting`, and `actionFor` never starts a
    second full run against a group in that state, so the request would be stuck for good. The
    issue is never closed here: it is the record of the request, and it is what a retry attaches
    to.
    """
    if not req.group_id:
        return
    try:
        db.release_issue_slot(req.group_id, req.escalation_id)
        group = db.get_group(req.group_id) or {}
        if str(group.get("status") or "") == "drafting" and not group.get("pr_url"):
            db.update_group(req.group_id, status="filed" if group.get("issue_number") else "observed")
    except Exception:  # noqa: BLE001 - best effort, like the read above
        return


def fail(req: FeatureRequestInput, step: str, error: Exception) -> None:
    """Record a run that could not finish, in words a reader can act on.

    Two things outrank the stack trace. A run whose pull request is already open has done the work
    somebody is waiting to approve, so a blip on the call that was recording it never turns into a
    failed request. And whatever else happened, the issue stays open and the group goes back to a
    state a later report can start from, so asking again is all it takes.
    """
    message = f"{step}: {error}"
    opened = _open_pull_request(req)
    if opened:
        db.update_escalation(req.escalation_id, status="awaiting_approval", pr_url=opened, error=message[:2000])
        trace.status(
            req.project_id,
            req.trace_id(),
            "The pull request is open and waiting for approval, so this run was not failed",
            detail={"pr_url": opened, "message": message[:2000]},
        )
        return

    plain = STEP_FAILURES.get(step, "Lantern could not finish this request.")
    db.update_escalation(req.escalation_id, status="failed", error=message[:2000])
    trace.error(
        req.project_id,
        req.trace_id(),
        plain,
        f"{plain} Nothing was lost and the request is still open, so it can be tried again.\n\n{message}",
    )
    _reopen_for_retry(req)


# ---- 1. file_issue ----------------------------------------------------------

def _group_issue_number(req: FeatureRequestInput) -> int:
    """The issue this group already has, from the run's own input or from the group row now.

    The runner read the group when it claimed the row, which can be seconds before this step gets
    there. Reading it again is what closes the window in which two runs both believe the group has
    no issue yet.
    """
    if req.issue_number:
        return req.issue_number
    if not req.group_id:
        return 0
    return int((db.get_group(req.group_id) or {}).get("issue_number") or 0)


def _wait_for_group_issue(req: FeatureRequestInput, sleep: Callable[[float], None] = time.sleep) -> int:
    """Claim the right to file this group's issue, or wait for whoever holds it.

    Exactly one run wins the conditional update on `issue_claim`, and it files. Everyone else polls
    the group until the winner's `issue_number` appears and comments on that issue instead, which is
    what makes one reported gap one issue no matter which run reaches GitHub first. A claim that
    never produces an issue is taken over rather than waited on for ever.
    """
    if not req.group_id:
        return 0
    if db.claim_issue_slot(req.group_id, req.escalation_id):
        return 0

    deadline = time.monotonic() + ISSUE_WAIT_S
    while time.monotonic() < deadline:
        sleep(ISSUE_POLL_S)
        group = db.get_group(req.group_id) or {}
        number = int(group.get("issue_number") or 0)
        if number:
            trace.status(
                req.project_id,
                req.trace_id(),
                f"Another run filed issue #{number} for this request, so this one joins it",
                detail={"issue_number": number, "group_id": req.group_id},
            )
            return number
        if not group.get("issue_claim"):
            break
    # Whoever held the claim did not file. Take it over so the request is not left unrecorded.
    db.claim_issue_slot(req.group_id, req.escalation_id)
    return 0


def file_issue(req: FeatureRequestInput) -> IssueRef:
    _set_status(req, "filing")
    reporter = Reporter(req.project_id, req.trace_id())

    # The group's own weight decides this. Only a request that arrived without one still asks
    # the model, which is the path a direct workflow execution takes.
    if req.priority in issue_text.PRIORITIES:
        priority = req.priority
        reporter.status(
            f"Priority: {priority}",
            detail={
                "priority": priority,
                "reportCount": req.report_count,
                "userReportCount": req.user_report_count,
            },
        )
    else:
        priority, reason = issue_text.choose_priority(req)
        reporter.model(
            f"Priority: {priority}",
            llm.ARCHITECT_MODEL,
            "decide how urgent this request is",
            input_summary=req.title,
            output_summary=reason or priority,
        )
    labels = issue_text.labels_for(priority, auto_detected=req.auto_detected())

    criteria = issue_text.default_acceptance_criteria(req)
    body = issue_text.build_issue_body(req, criteria, priority=priority)
    trace.issue_draft(req.project_id, req.trace_id(), req.title, body)

    github = GitHubClient.for_project(req.repo_full_name, req.project_id)
    created_labels = github.ensure_labels(labels)
    if created_labels:
        reporter.tool(
            f"Created label(s) {', '.join(created_labels)}", "create_label", "rest",
            f"POST /repos/{req.repo_full_name}/labels", ", ".join(created_labels),
        )

    # One gap in one group is one issue, whoever files it and however the runs overlap.
    number = _group_issue_number(req)
    if not number:
        number = _wait_for_group_issue(req)
    # The group already knows its issue; a run without one falls back to matching the title.
    existing = github.get_issue(number) if number else github.find_open_issue_by_title(req.title)
    if existing:
        number = int(existing["number"])
        # The same request arriving again is signal, so the issue counts it and quotes the new user.
        current = github.get_issue(number).get("body") or ""
        if req.group_id:
            updated = issue_text.set_priority(
                issue_text.set_request_counts(current, req.report_count, req.user_report_count),
                priority,
            )
            count = req.report_count
        else:
            updated, count = issue_text.bump_request_count(current)
        github.update_issue_body(number, updated)
        if req.group_id:
            # The group decides the labels now, and its weight may have moved since it was filed.
            github.set_labels(number, labels)
        comment = github.comment(number, issue_text.build_group_comment(req) if req.group_id else issue_text.build_duplicate_comment(req, count))
        reporter.tool(
            f"Issue #{number} already open, requested {count} times now",
            "add_issue_comment", "rest",
            f"POST /repos/{req.repo_full_name}/issues/{number}/comments",
            comment.get("html_url", ""),
        )
        ref = IssueRef(
            number=number, url=existing["html_url"], title=existing["title"], body=updated,
            deduplicated=True, transport="rest", priority=priority, request_count=count,
            user_request_count=req.user_report_count,
        )
    else:
        result = mcp_github.file_issue_with_model(req.repo_full_name, req.title, body, labels, rest=github)
        reporter.tool(
            f"Created issue #{result['number']} through {result['transport'].upper()}",
            "create_issue", result["transport"], result["args_summary"], result["result_summary"],
        )
        ref = IssueRef(
            number=result["number"], url=result["url"], title=req.title, body=body,
            transport=result["transport"], priority=priority,
            request_count=req.report_count, user_request_count=req.user_report_count,
        )
    trace.issue(req.project_id, req.trace_id(), ref.url, ref.number, ref.deduplicated)
    db.update_escalation(req.escalation_id, issue_url=ref.url, issue_number=ref.number)
    # The number is now on the group, so the slot this run may have been holding is done with.
    group_fields: dict[str, object] = {
        "issue_url": ref.url,
        "issue_number": ref.number,
        "priority": priority,
        "issue_claim": None,
    }
    # A full run is already past this; only the issue-only run leaves the group at "filed".
    if req.file_only:
        group_fields["status"] = "filed"
    _set_group(req, **group_fields)
    # An issue-only run has done everything it was asked to do.
    if req.file_only:
        db.update_escalation(req.escalation_id, status="filed")
        trace.status(req.project_id, req.trace_id(), "Status: filed", detail={"status": "filed"})
    slack.notify(
        f"Lantern filed {ref.url} ({priority} priority) for \"{req.title}\"."
        if not ref.deduplicated
        else f"Lantern saw \"{req.title}\" again and commented on {ref.url} (requested {ref.request_count} times)."
    )
    return ref


# ---- 2. inspect_repository ----------------------------------------------------

def inspect_repository(req: FeatureRequestInput, issue: IssueRef) -> Plan:
    _set_status(req, "inspecting")
    _set_group(req, status="drafting")
    reporter = Reporter(req.project_id, req.escalation_id)
    workdir = Path(tempfile.mkdtemp(prefix="lantern-inspect-"))
    try:
        sha = repo.clone(req.repo_full_name, req.default_branch, workdir, token=project_token(req.project_id))
        reporter.tool(
            f"Cloned {req.repo_full_name}@{req.default_branch}", "git clone", "git",
            f"--depth 1 --branch {req.default_branch}", f"HEAD {sha[:7]}",
        )
        plan, input_summary = codegen.plan_changes(workdir, req, issue.title, issue.body)
        reporter.model(
            f"Chose {len(plan.files)} file(s) to change",
            llm.ARCHITECT_MODEL,
            "choose the smallest set of files and write acceptance criteria",
            input_summary=input_summary,
            output_summary=plan.summary,
            files=[{"path": f.path, "reason": f.reason, "action": f.action} for f in plan.files],
        )
        return plan
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---- 3. draft_implementation --------------------------------------------------

def draft_implementation(req: FeatureRequestInput, issue: IssueRef, plan: Plan) -> Draft:
    _set_status(req, "drafting")
    reporter = Reporter(req.project_id, req.escalation_id)
    workdir = Path(tempfile.mkdtemp(prefix="lantern-draft-"))
    try:
        repo.clone(req.repo_full_name, req.default_branch, workdir, token=project_token(req.project_id))
        draft = drafting.draft_with_gates(workdir, req, issue.title, issue.body, plan, reporter, repo.repo_slug(req.repo_full_name))
        reporter.diff([{"path": d.path, "patch": d.patch} for d in draft.diffs])
        return draft
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


# ---- 4. open_draft_pr ---------------------------------------------------------

def open_draft_pr(req: FeatureRequestInput, issue: IssueRef, plan: Plan, draft: Draft) -> PrRef:
    _set_status(req, "pr_open")
    reporter = Reporter(req.project_id, req.escalation_id)
    github = GitHubClient.for_project(req.repo_full_name, req.project_id)
    branch = f"lantern/{issue.number}-{_slug(req.title)}"
    parent = draft.base_sha or github.get_branch_sha(req.default_branch)
    title = req.title[0].lower() + req.title[1:] if req.title else "change"
    message = f"feat: {title}\n\nCloses #{issue.number}"
    head_sha = github.push_files(branch, parent, draft.files, message, draft.deletions)
    pushed = f"{len(draft.files)} file(s)" + (f" and removed {len(draft.deletions)}" if draft.deletions else "")
    reporter.tool(
        f"Pushed {pushed} to {branch}", "push_files", "rest",
        f"blob/tree/commit/ref on top of {parent[:7]}", f"commit {head_sha[:7]}",
    )

    body = issue_text.build_pr_body(
        req, issue.number, list(draft.files), plan.acceptance_criteria, draft.summary, draft.deletions
    )
    pr_title = f"feat: {title}"
    existing = github.find_open_pr_for_branch(branch)
    if existing:
        pr = existing
        transport = "rest"
        result_summary = f"reused open PR #{pr['number']}"
    else:
        pr, transport, result_summary = mcp_github.open_draft_pr_with_fallback(
            req.repo_full_name, pr_title, body, branch, req.default_branch, rest=github
        )
    reporter.tool(
        f"Opened draft PR #{pr['number']} through {transport.upper()}", "create_pull_request", transport,
        f"head={branch} base={req.default_branch} draft=true", result_summary,
    )
    ref = PrRef(number=int(pr["number"]), url=pr["html_url"], branch=branch, head_sha=head_sha, node_id=pr.get("node_id", ""))
    db.update_escalation(req.escalation_id, pr_url=ref.url, pr_number=ref.number, branch=branch)
    _set_group(req, pr_url=ref.url, status="pr_open")

    # The gates already passed on this branch, so say so on the pull request itself.
    if draft.gates:
        gate_comment = issue_text.build_gate_comment(
            [(gate.name, gate.ok, gate.duration_s) for gate in draft.gates], config.activity_url()
        )
        github.comment(ref.number, gate_comment)
        reporter.tool(
            f"Reported the gate results on PR #{ref.number}", "add_issue_comment", "rest",
            f"POST /repos/{req.repo_full_name}/issues/{ref.number}/comments",
            ", ".join(f"{gate.name} {'passed' if gate.ok else 'failed'} in {gate.duration_s:.0f}s" for gate in draft.gates),
        )

    slack.notify(f"Lantern drafted {ref.url} for \"{req.title}\" and it is waiting for approval in the console.")
    _set_status(req, "awaiting_approval")
    _set_group(req, status="awaiting_approval")
    # The last two rows a reader sees: the pull request itself, then the card that asks them to
    # decide. Everything this run did to get there is already above them.
    trace.pr(req.project_id, req.escalation_id, ref.url, ref.number, branch)
    trace.pause(req.project_id, req.escalation_id, PAUSE_LABEL)
    return ref


# ---- 5. merge_and_deploy ------------------------------------------------------

def merge_and_deploy(req: FeatureRequestInput, issue: IssueRef, pr: PrRef, decision: Approval) -> Outcome:
    reporter = Reporter(req.project_id, req.escalation_id)
    github = GitHubClient.for_project(req.repo_full_name, req.project_id)
    approval = {"approved": decision.approved, "note": decision.note, "decidedAt": datetime.now(timezone.utc).isoformat()}
    if not decision.approved:
        note = decision.note.strip() or "Closed without merging."
        github.close_pr(pr.number, f"Rejected from the Lantern console: {note}")
        reporter.tool(f"Closed PR #{pr.number}", "close_pull_request", "rest", f"PATCH /pulls/{pr.number} state=closed", note)
        db.update_escalation(req.escalation_id, status="rejected", approval=approval)
        _set_group(req, status="rejected")
        trace.status(req.project_id, req.escalation_id, "Status: rejected", detail={"status": "rejected"})
        return Outcome(status="rejected", issue_url=issue.url, pr_url=pr.url, note=note)

    db.update_escalation(req.escalation_id, status="approved", approval=approval)
    trace.status(req.project_id, req.escalation_id, "Approved in the console", detail={"status": "approved", "note": decision.note})
    _set_status(req, "merging")
    node_id = pr.node_id or github.get_pr(pr.number)["node_id"]
    github.mark_ready_for_review(node_id)
    reporter.tool(f"Marked PR #{pr.number} ready for review", "markPullRequestReadyForReview", "rest", f"pullRequestId={node_id}", "isDraft=false")
    github.wait_until_mergeable(pr.number)
    merge_sha = github.merge_squash(pr.number, f"feat: {req.title[0].lower() + req.title[1:]} (#{pr.number})", f"Closes #{issue.number}")
    reporter.tool(f"Merged PR #{pr.number} (squash)", "merge_pull_request", "rest", f"PUT /pulls/{pr.number}/merge squash", f"merge commit {merge_sha[:7]}")

    _set_status(req, "deploying")
    reporter.status(f"Waiting for the Vercel deployment of {merge_sha[:7]}", "running", {"sha": merge_sha})
    try:
        url = deploy.wait_for_deployment(
            merge_sha,
            report=lambda title, state: reporter.status(title, "running", {"sha": merge_sha, "readyState": state}),
        )
    except deploy.DeploymentTimeout as timeout:
        # The change is merged and on the production branch; only the watch ran out. Saying that
        # plainly is honest, and calling the whole run failed would not be.
        minutes = deploy.TIMEOUT_S // 60
        reporter.status(
            f"Stopped watching for the deployment of {merge_sha[:7]} after {minutes} minutes",
            "failed",
            {"sha": merge_sha, "project": config.target_vercel_project(), "reason": str(timeout)},
        )
        db.update_escalation(req.escalation_id, status="deploying", error=str(timeout)[:2000])
        return Outcome(status="merged", issue_url=issue.url, pr_url=pr.url, merge_sha=merge_sha, note=str(timeout))
    trace.deployment(req.project_id, req.escalation_id, url)
    db.update_escalation(req.escalation_id, status="shipped", deployment_url=url)
    _set_group(req, status="shipped")
    trace.status(req.project_id, req.escalation_id, "Status: shipped", detail={"status": "shipped", "url": url})
    return Outcome(status="shipped", issue_url=issue.url, pr_url=pr.url, deployment_url=url, merge_sha=merge_sha)


# ---- 6. update_group ----------------------------------------------------------

def _pull_number(req: FeatureRequestInput, group: dict[str, object] | None) -> int:
    if req.pr_number:
        return req.pr_number
    url = str((group or {}).get("pr_url") or "")
    match = re.search(r"/pull/(\d+)", url)
    return int(match.group(1)) if match else 0


def update_group(req: FeatureRequestInput) -> Outcome:
    """Carry one more report of an already-filed request to GitHub.

    The developers do not need a second issue or a second pull request: they need to know this
    keeps happening. So the count line and the labels are brought up to date and the new words are
    quoted, on the issue and, when one exists, on the pull request people are reviewing.
    """
    group = db.get_group(req.group_id) if req.group_id else None
    issue_number = req.issue_number or int((group or {}).get("issue_number") or 0)
    if not issue_number:
        # The first run has not landed yet, so there is nothing to update. File it instead.
        issue = file_issue(req)
        db.update_escalation(req.escalation_id, status="updated")
        return Outcome(status="updated", issue_url=issue.url)

    reporter = Reporter(req.project_id, req.trace_id())
    github = GitHubClient.for_project(req.repo_full_name, req.project_id)
    labels = issue_text.labels_for(req.priority, auto_detected=req.auto_detected())
    github.ensure_labels(labels)

    issue = github.get_issue(issue_number)
    body = issue_text.set_priority(
        issue_text.set_request_counts(issue.get("body") or "", req.report_count, req.user_report_count),
        req.priority,
    )
    github.update_issue_body(issue_number, body)
    github.set_labels(issue_number, labels)
    comment = issue_text.build_group_comment(req)
    github.comment(issue_number, comment)
    reporter.tool(
        f"Issue #{issue_number} is now {issue_text.count_line(req.report_count, req.user_report_count).lower()}",
        "update_issue", "rest",
        f"PATCH /repos/{req.repo_full_name}/issues/{issue_number} labels={','.join(labels)}",
        issue.get("html_url", ""),
    )

    pr_number = _pull_number(req, group)
    if pr_number:
        github.comment(pr_number, comment)
        reporter.tool(
            f"Told PR #{pr_number} this was asked for again",
            "add_issue_comment", "rest",
            f"POST /repos/{req.repo_full_name}/issues/{pr_number}/comments",
            issue_text.count_line(req.report_count, req.user_report_count),
        )

    db.update_escalation(
        req.escalation_id,
        status="updated",
        issue_url=issue.get("html_url"),
        issue_number=issue_number,
    )
    slack.notify(
        f"Lantern saw \"{req.title}\" again: {issue_text.count_line(req.report_count, req.user_report_count).lower()}."
    )
    return Outcome(
        status="updated",
        issue_url=str(issue.get("html_url") or ""),
        pr_url=str((group or {}).get("pr_url") or ""),
    )

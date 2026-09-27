"""Trace detail builders. The console renders these shapes specially, so keep the keys exact."""

from __future__ import annotations

from typing import Any

from steps import db


def issue_draft(project_id: str, escalation_id: str, title: str, body: str) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "artifact", "Drafted the GitHub issue",
        detail={"artifact": "issue_draft", "title": title, "body": body},
    )


def issue(project_id: str, escalation_id: str, url: str, number: int, deduplicated: bool = False) -> int | None:
    title = f"Commented on existing issue #{number}" if deduplicated else f"Filed issue #{number}"
    return db.emit_trace(
        project_id, escalation_id, "artifact", title,
        detail={"artifact": "issue", "url": url, "number": number},
    )


def pr(project_id: str, escalation_id: str, url: str, number: int, branch: str) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "artifact", f"Opened draft pull request #{number}",
        detail={"artifact": "pr", "url": url, "number": number, "branch": branch},
    )


def diff(project_id: str, escalation_id: str, files: list[dict[str, str]]) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "artifact", f"Drafted changes to {len(files)} file(s)",
        detail={"artifact": "diff", "files": files},
    )


def deployment(project_id: str, escalation_id: str, url: str) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "artifact", "Deployment is live",
        detail={"artifact": "deployment", "url": url},
    )


def model(
    project_id: str,
    escalation_id: str,
    title: str,
    model_id: str,
    purpose: str,
    input_summary: str | None = None,
    output_summary: str | None = None,
    files: list[dict[str, str]] | None = None,
    status: str = "ok",
) -> int | None:
    detail: dict[str, Any] = {"model": model_id, "purpose": purpose}
    if input_summary is not None:
        detail["input_summary"] = input_summary
    if output_summary is not None:
        detail["output_summary"] = output_summary
    if files is not None:
        detail["files"] = files
    return db.emit_trace(project_id, escalation_id, "model", title, status=status, detail=detail)


def pause(project_id: str, escalation_id: str, label: str, task_id: str | None = None) -> int | None:
    detail: dict[str, Any] = {"label": label}
    if task_id:
        detail["taskId"] = task_id
    return db.emit_trace(project_id, escalation_id, "pause", label, status="running", detail=detail)


def tool(
    project_id: str,
    escalation_id: str,
    title: str,
    tool_name: str,
    transport: str,
    args_summary: str,
    result_summary: str,
    status: str = "ok",
) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "tool", title, status=status,
        detail={
            "tool": tool_name,
            "transport": transport,
            "args_summary": args_summary,
            "result_summary": result_summary,
        },
    )


def status(project_id: str, escalation_id: str, title: str, state: str = "ok", detail: Any = None) -> int | None:
    return db.emit_trace(project_id, escalation_id, "status", title, status=state, detail=detail)


def error(project_id: str, escalation_id: str, title: str, message: str) -> int | None:
    return db.emit_trace(
        project_id, escalation_id, "error", title, status="failed", detail={"message": message[:4000]},
    )

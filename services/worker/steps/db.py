"""PostgREST helpers. Every write the worker makes to Supabase goes through here.

Every call goes out through `steps.retry.send`, so a dropped connection to Supabase costs a moment
rather than the whole escalation. The note in `retry.py` says what is retried and what is not.
Two writes are made one time and never repeated, the claim of a person who asked for a text and
the release of that claim; the note on each says why.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

import config
from steps import retry

TIMEOUT = 20


def _headers(prefer: str | None = None) -> dict[str, str]:
    key = config.supabase_service_role_key()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def _url(table: str) -> str:
    return f"{config.supabase_url()}/rest/v1/{table}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check(response: requests.Response) -> Any:
    if response.status_code >= 400:
        raise RuntimeError(f"PostgREST {response.status_code}: {response.text[:500]}")
    if not response.content:
        return None
    return response.json()


def update_escalation(escalation_id: str, **fields: Any) -> dict[str, Any] | None:
    """Patch an escalation row. `updated_at` is always bumped so the dashboard sees activity."""
    payload = dict(fields)
    payload["updated_at"] = _now()
    response = retry.send(
        "PATCH",
        _url("escalation"),
        params={"id": f"eq.{escalation_id}"},
        headers=_headers("return=representation"),
        json=payload,
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0] if rows else None


def get_escalation(escalation_id: str) -> dict[str, Any] | None:
    response = retry.send(
        "GET",
        _url("escalation"),
        params={"id": f"eq.{escalation_id}", "select": "*"},
        headers=_headers(),
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0] if rows else None


def get_project(project_id: str) -> dict[str, Any] | None:
    response = retry.send(
        "GET",
        _url("project"),
        params={"id": f"eq.{project_id}", "select": "*"},
        headers=_headers(),
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0] if rows else None


def get_group(group_id: str) -> dict[str, Any] | None:
    response = retry.send(
        "GET",
        _url("feature_request_group"),
        params={"id": f"eq.{group_id}", "select": "*"},
        headers=_headers(),
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0] if rows else None


def update_group(group_id: str, **fields: Any) -> dict[str, Any] | None:
    """Patch a request group. The group is what the console lists, so this is what a reader sees."""
    response = retry.send(
        "PATCH",
        _url("feature_request_group"),
        params={"id": f"eq.{group_id}"},
        headers=_headers("return=representation"),
        json=dict(fields),
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0] if rows else None


def claim_issue_slot(group_id: str, escalation_id: str) -> bool:
    """Take this group's issue slot, if nobody holds it. True when this run won it.

    One conditional update: PostgREST turns the `issue_claim=is.null` filter into the UPDATE's own
    WHERE clause, so exactly one of two runs racing for the same group gets a row back. The loser
    waits for the number the winner writes rather than filing a second issue for the same gap.
    """
    response = retry.send(
        "PATCH",
        _url("feature_request_group"),
        params={"id": f"eq.{group_id}", "issue_claim": "is.null", "issue_number": "is.null"},
        headers=_headers("return=representation"),
        json={"issue_claim": escalation_id},
        timeout=TIMEOUT,
    )
    return bool(_check(response))


def release_issue_slot(group_id: str, escalation_id: str) -> None:
    """Hand the slot back after a run that held it could not file, so the next report can."""
    retry.send(
        "PATCH",
        _url("feature_request_group"),
        params={"id": f"eq.{group_id}", "issue_claim": f"eq.{escalation_id}"},
        headers=_headers("return=minimal"),
        json={"issue_claim": None},
        timeout=TIMEOUT,
    )


# The calls below are about `gap_subscriber`, the people who asked for one text about a gap. A run
# waits for the text notice, so each of them has a shorter limit than the rest. Every query is
# scoped to the project, and every query about a person is scoped to the gap too.
SUBSCRIBER_TIMEOUT = 10


def _subscriber(project_id: str, group_id: str, subscriber_id: str) -> dict[str, str]:
    """One person's row, and only if it belongs to this project and this gap."""
    return {"id": f"eq.{subscriber_id}", "project_id": f"eq.{project_id}", "group_id": f"eq.{group_id}"}


def notice_names(project_id: str, group_id: str) -> tuple[str, str]:
    """What a text names: the company the person knows, and the gap's title."""
    project = _check(
        retry.send(
            "GET",
            _url("project"),
            params={"id": f"eq.{project_id}", "select": "name"},
            headers=_headers(),
            timeout=SUBSCRIBER_TIMEOUT,
        )
    )
    group = _check(
        retry.send(
            "GET",
            _url("feature_request_group"),
            params={"id": f"eq.{group_id}", "project_id": f"eq.{project_id}", "select": "title"},
            headers=_headers(),
            timeout=SUBSCRIBER_TIMEOUT,
        )
    )
    company = (project[0].get("name") if project else None) or ""
    title = (group[0].get("title") if group else None) or ""
    return str(company), str(title)


def owed_subscribers(project_id: str, group_id: str, limit: int) -> list[dict[str, Any]]:
    """The people who agreed to a text about this gap and have not had it, oldest first."""
    response = retry.send(
        "GET",
        _url("gap_subscriber"),
        params={
            "project_id": f"eq.{project_id}",
            "group_id": f"eq.{group_id}",
            "notified_at": "is.null",
            "phone_sealed": "not.is.null",
            "select": "id,phone_sealed",
            "order": "created_at.asc",
            "limit": str(limit),
        },
        headers=_headers(),
        timeout=SUBSCRIBER_TIMEOUT,
    )
    return _check(response) or []


def claim_subscriber(project_id: str, group_id: str, subscriber_id: str) -> bool:
    """Take one person for this run. False when a different run already took them.

    One conditional update on `notified_at`, the same shape as `claim_issue_slot`. It is made one
    time: an update that is repeated after a lost answer comes back empty when the first one
    landed, and then nobody can say who holds the claim.
    """
    response = retry.send(
        "PATCH",
        _url("gap_subscriber"),
        params={**_subscriber(project_id, group_id, subscriber_id), "notified_at": "is.null", "select": "id"},
        headers=_headers("return=representation"),
        json={"notified_at": _now()},
        timeout=SUBSCRIBER_TIMEOUT,
        attempts=1,
    )
    return bool(_check(response))


def release_subscriber(project_id: str, group_id: str, subscriber_id: str) -> None:
    """Give the claim back after a text that was refused, so the text is still owed.

    It is made one time. A release that is repeated after a lost answer can free a claim that a
    different run took in between, and that run's person would then get a second text.
    """
    response = retry.send(
        "PATCH",
        _url("gap_subscriber"),
        params=_subscriber(project_id, group_id, subscriber_id),
        headers=_headers("return=minimal"),
        json={"notified_at": None},
        timeout=SUBSCRIBER_TIMEOUT,
        attempts=1,
    )
    _check(response)


def erase_subscriber_phone(project_id: str, group_id: str, subscriber_id: str) -> None:
    """Erase the number after a text was sent, or may have gone. The claim stays."""
    response = retry.send(
        "PATCH",
        _url("gap_subscriber"),
        params=_subscriber(project_id, group_id, subscriber_id),
        headers=_headers("return=minimal"),
        json={"phone_sealed": None},
        timeout=SUBSCRIBER_TIMEOUT,
    )
    _check(response)


def forget_stale_subscribers(project_id: str, claimed_before: datetime) -> None:
    """Erase the numbers of the project's claims that are older than any send can be."""
    response = retry.send(
        "PATCH",
        _url("gap_subscriber"),
        params={
            "project_id": f"eq.{project_id}",
            "notified_at": f"lt.{claimed_before.isoformat()}",
            "phone_sealed": "not.is.null",
        },
        headers=_headers("return=minimal"),
        json={"phone_sealed": None},
        timeout=SUBSCRIBER_TIMEOUT,
    )
    _check(response)


def emit_trace(
    project_id: str,
    escalation_id: str | None,
    kind: str,
    title: str,
    status: str = "ok",
    detail: Any = None,
    source: str = "workflow",
    conversation_id: str | None = None,
) -> int | None:
    """Insert one trace_event row and return its id."""
    payload = {
        "project_id": project_id,
        "escalation_id": escalation_id,
        "conversation_id": conversation_id,
        "source": source,
        "kind": kind,
        "status": status,
        "title": title,
        "detail": detail,
    }
    response = retry.send(
        "POST",
        _url("trace_event"),
        headers=_headers("return=representation"),
        json=payload,
        timeout=TIMEOUT,
    )
    rows = _check(response)
    return rows[0]["id"] if rows else None


def claim_queued_local() -> dict[str, Any] | None:
    """Pick the oldest queued local escalation and mark it `filing` so no other runner takes it."""
    response = retry.send(
        "GET",
        _url("escalation"),
        params={
            "status": "eq.queued",
            "engine": "eq.local",
            "select": "*",
            "order": "created_at.asc",
            "limit": "1",
        },
        headers=_headers(),
        timeout=TIMEOUT,
    )
    rows = _check(response)
    if not rows:
        return None
    candidate = rows[0]
    response = retry.send(
        "PATCH",
        _url("escalation"),
        params={"id": f"eq.{candidate['id']}", "status": "eq.queued"},
        headers=_headers("return=representation"),
        json={"status": "filing", "updated_at": _now()},
        timeout=TIMEOUT,
    )
    claimed = _check(response)
    return claimed[0] if claimed else None


def heartbeat(project_id: str, engine: str = "local", sms: bool = False) -> int | None:
    """The console shows the worker as online when one of these arrived in the last two minutes.

    `sms` says if this worker can send a text message. The web app offers the one text about a gap
    only when the last heartbeat says so (`apps/web/lib/sms/offer.ts`), because this process sends
    that text and the web app cannot see its environment.
    """
    return emit_trace(
        project_id,
        None,
        "status",
        "worker online",
        detail={"engine": engine, "at": _now(), "sms": sms},
    )


def list_projects() -> list[dict[str, Any]]:
    response = retry.send(
        "GET",
        _url("project"),
        params={"select": "id,slug,repo_full_name,repo_default_branch,site_url"},
        headers=_headers(),
        timeout=TIMEOUT,
    )
    return _check(response) or []

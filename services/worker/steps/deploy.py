"""Waits for the Vercel deployment that corresponds to a merge commit."""

from __future__ import annotations

import time
from typing import Any, Callable

import requests

import config

API = "https://api.vercel.com"
TIMEOUT_S = 10 * 60
POLL_S = 10
REPORT_EVERY_S = 30
RECENT_LIMIT = 20


class DeployError(RuntimeError):
    pass


class DeploymentTimeout(DeployError):
    """No deployment for the merge commit reached READY in time.

    Its own type because it is not a failure of the change: the pull request is merged and the
    branch is on `main`. Only the watch gave up, so the caller records that and stops rather than
    marking the whole run failed.
    """


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {config.vercel_token()}"}


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    response = requests.get(f"{API}{path}", headers=_headers(), params=params, timeout=30)
    if response.status_code >= 400:
        raise DeployError(f"GET {path} -> {response.status_code}: {response.text[:300]}")
    return response.json()


def resolve_project_id(name: str) -> str:
    return _get(f"/v9/projects/{name}")["id"]


def list_deployments(project_id: str, limit: int = RECENT_LIMIT, sha: str = "") -> list[dict[str, Any]]:
    params: dict[str, Any] = {"projectId": project_id, "limit": limit}
    if sha:
        params["sha"] = sha
    return _get("/v6/deployments", params).get("deployments", [])


def _matches(deployment: dict[str, Any], merge_sha: str) -> bool:
    meta = deployment.get("meta") or {}
    return (meta.get("githubCommitSha") or "").lower() == merge_sha.lower()


def deployments_for_sha(project_id: str, merge_sha: str) -> list[dict[str, Any]]:
    """Every deployment the project built from this commit.

    The Git integration builds a merge to the production branch by itself, so the deployment is
    found by commit rather than by anything the worker started. `sha` narrows it server side; the
    recent list is read as well, because a deployment that is still queued can be missing from the
    filtered answer for a few seconds after the merge.
    """
    found = {
        deployment.get("uid"): deployment
        for deployment in list_deployments(project_id, sha=merge_sha)
        if _matches(deployment, merge_sha)
    }
    for deployment in list_deployments(project_id):
        if _matches(deployment, merge_sha):
            found.setdefault(deployment.get("uid"), deployment)
    return list(found.values())


def deployment_url(deployment: dict[str, Any], production_url: str = "") -> str:
    """The deployment's https url, or the stable production address for a production deployment."""
    if deployment.get("target") == "production" and production_url:
        return production_url
    url = deployment.get("url") or ""
    return url if url.startswith("http") else f"https://{url}"


def wait_for_deployment(
    merge_sha: str,
    project_name: str | None = None,
    report: Callable[[str, str], None] | None = None,
    timeout_s: int = TIMEOUT_S,
) -> str:
    """Poll until a READY deployment for `merge_sha` exists; returns its https url.

    Raises `DeploymentTimeout` after `timeout_s`, which the caller reports as a status rather than
    as the run failing.
    """
    project_name = project_name or config.target_vercel_project()
    project_id = resolve_project_id(project_name)
    started = time.monotonic()
    last_report = started
    last_state = "none yet"
    while True:
        for deployment in deployments_for_sha(project_id, merge_sha):
            state = deployment.get("readyState") or deployment.get("state") or ""
            last_state = state
            if state == "READY":
                return deployment_url(deployment, config.target_production_url())
            if state in {"ERROR", "CANCELED"}:
                raise DeployError(f"deployment {deployment.get('uid')} ended in state {state}")
        elapsed = time.monotonic() - started
        if elapsed > timeout_s:
            raise DeploymentTimeout(
                f"no READY deployment of {merge_sha[:7]} in {project_name} after {int(elapsed)}s "
                f"(last state: {last_state})"
            )
        if report and time.monotonic() - last_report >= REPORT_EVERY_S:
            last_report = time.monotonic()
            report(f"Waiting for the Vercel deployment of {merge_sha[:7]} ({int(elapsed)} s elapsed)", last_state)
        time.sleep(POLL_S)

"""GitHub REST and GraphQL client used by the worker. One small method per API call.

Every call goes out through `steps.retry.send`: a dropped connection or a 502 from GitHub is not a
verdict on the escalation, and one blip must not cost a user their request (see `retry.py`).
"""

from __future__ import annotations

import base64
import time
from collections.abc import Iterable
from typing import Any
from urllib.parse import quote

import config
from steps import retry
from steps.github_token import project_token

API = "https://api.github.com"
GRAPHQL = "https://api.github.com/graphql"
TIMEOUT = 30

DEFAULT_LABEL_COLOUR = "ededed"
LABEL_COLOURS = {
    "lantern": "174633",
    "priority:high": "b42318",
    "priority:medium": "b54708",
    "priority:low": "667085",
    "auto-detected": "5925dc",
}
LABEL_DESCRIPTIONS = {
    "lantern": "Filed by Lantern from a support conversation",
    "priority:high": "Blocks a common flow",
    "priority:medium": "A real gap with a workaround",
    "priority:low": "A nice improvement",
    "auto-detected": "Noticed by the agent, not reported by a user",
}


class GitHubError(RuntimeError):
    pass


class GitHubClient:
    def __init__(self, repo_full_name: str, token: str | None = None) -> None:
        self.owner, self.repo = repo_full_name.split("/", 1)
        self.full_name = repo_full_name
        self._token = token or config.github_token()

    @classmethod
    def for_project(cls, repo_full_name: str, project_id: str) -> "GitHubClient":
        """The project's own linked token when it has one, the server credential otherwise."""
        return cls(repo_full_name, token=project_token(project_id))

    @property
    def token(self) -> str:
        """The credential this client resolved to, so MCP and git clone use the same one."""
        return self._token

    # ---- plumbing -------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = path if path.startswith("http") else f"{API}{path}"
        response = retry.send(method, url, headers=self._headers(), timeout=TIMEOUT, **kwargs)
        if response.status_code >= 400:
            raise GitHubError(f"{method} {path} -> {response.status_code}: {response.text[:500]}")
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    def _repo_path(self, suffix: str) -> str:
        return f"/repos/{self.owner}/{self.repo}{suffix}"

    def graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        response = retry.send(
            "POST", GRAPHQL, headers=self._headers(), json={"query": query, "variables": variables}, timeout=TIMEOUT
        )
        if response.status_code >= 400:
            raise GitHubError(f"GraphQL -> {response.status_code}: {response.text[:500]}")
        body = response.json()
        if body.get("errors"):
            raise GitHubError(f"GraphQL errors: {body['errors']}")
        return body.get("data") or {}

    # ---- issues ---------------------------------------------------------

    def list_open_issues(self) -> list[dict[str, Any]]:
        issues: list[dict[str, Any]] = []
        page = 1
        while True:
            batch = self._request("GET", self._repo_path("/issues"), params={"state": "open", "per_page": 100, "page": page})
            if not batch:
                break
            issues.extend(item for item in batch if "pull_request" not in item)
            if len(batch) < 100:
                break
            page += 1
        return issues

    def find_open_issue_by_title(self, title: str) -> dict[str, Any] | None:
        wanted = title.strip().casefold()
        for issue in self.list_open_issues():
            if issue.get("title", "").strip().casefold() == wanted:
                return issue
        return None

    def create_issue(self, title: str, body: str, labels: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"title": title, "body": body}
        if labels:
            payload["labels"] = labels
        return self._request("POST", self._repo_path("/issues"), json=payload)

    def comment(self, issue_number: int, body: str) -> dict[str, Any]:
        return self._request("POST", self._repo_path(f"/issues/{issue_number}/comments"), json={"body": body})

    def get_issue(self, number: int) -> dict[str, Any]:
        return self._request("GET", self._repo_path(f"/issues/{number}"))

    def update_issue_body(self, number: int, body: str) -> dict[str, Any]:
        return self._request("PATCH", self._repo_path(f"/issues/{number}"), json={"body": body})

    def set_labels(self, number: int, labels: list[str]) -> dict[str, Any]:
        """Replaces the whole label set, so a promoted request stops reading as low priority."""
        return self._request("PUT", self._repo_path(f"/issues/{number}/labels"), json={"labels": labels})

    # ---- labels ---------------------------------------------------------

    def ensure_labels(self, names: list[str]) -> list[str]:
        """Create any label the repository does not have yet. Returns the ones this call created."""
        created: list[str] = []
        for name in names:
            try:
                self._request("GET", self._repo_path(f"/labels/{quote(name, safe='')}"))
                continue
            except GitHubError as error:
                if "404" not in str(error):
                    raise
            payload = {"name": name, "color": LABEL_COLOURS.get(name, DEFAULT_LABEL_COLOUR), "description": LABEL_DESCRIPTIONS.get(name, "")}
            try:
                self._request("POST", self._repo_path("/labels"), json=payload)
                created.append(name)
            except GitHubError as error:
                # A parallel run may have created it between the check and the write.
                if "422" not in str(error):
                    raise
        return created

    # ---- git data -------------------------------------------------------

    def get_branch_sha(self, branch: str) -> str:
        ref = self._request("GET", self._repo_path(f"/git/ref/heads/{branch}"))
        return ref["object"]["sha"]

    def get_commit_tree_sha(self, commit_sha: str) -> str:
        commit = self._request("GET", self._repo_path(f"/git/commits/{commit_sha}"))
        return commit["tree"]["sha"]

    def branch_exists(self, branch: str) -> bool:
        try:
            self.get_branch_sha(branch)
            return True
        except GitHubError as error:
            if "404" in str(error):
                return False
            raise

    def create_branch(self, branch: str, sha: str) -> dict[str, Any]:
        return self._request("POST", self._repo_path("/git/refs"), json={"ref": f"refs/heads/{branch}", "sha": sha})

    def update_branch(self, branch: str, sha: str, force: bool = True) -> dict[str, Any]:
        return self._request("PATCH", self._repo_path(f"/git/refs/heads/{branch}"), json={"sha": sha, "force": force})

    def delete_branch(self, branch: str) -> None:
        self._request("DELETE", self._repo_path(f"/git/refs/heads/{branch}"))

    def create_blob(self, content: str) -> str:
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        blob = self._request("POST", self._repo_path("/git/blobs"), json={"content": encoded, "encoding": "base64"})
        return blob["sha"]

    def push_files(
        self,
        branch: str,
        parent_sha: str,
        files: dict[str, str],
        message: str,
        deletions: Iterable[str] = (),
    ) -> str:
        """Create blobs, a tree on top of the parent's tree, a commit with the parent set, then move the ref.

        A path with a null `sha` removes that file from the tree, which is how a commit deletes one
        through the Git data API.
        """
        base_tree = self.get_commit_tree_sha(parent_sha)
        tree_entries: list[dict[str, Any]] = [
            {"path": path, "mode": "100644", "type": "blob", "sha": self.create_blob(content)}
            for path, content in sorted(files.items())
        ]
        tree_entries += [
            {"path": path, "mode": "100644", "type": "blob", "sha": None}
            for path in sorted(set(deletions) - set(files))
        ]
        tree = self._request("POST", self._repo_path("/git/trees"), json={"base_tree": base_tree, "tree": tree_entries})
        commit = self._request(
            "POST",
            self._repo_path("/git/commits"),
            json={"message": message, "tree": tree["sha"], "parents": [parent_sha]},
        )
        if self.branch_exists(branch):
            self.update_branch(branch, commit["sha"], force=True)
        else:
            self.create_branch(branch, commit["sha"])
        return commit["sha"]

    # ---- pull requests --------------------------------------------------

    def find_open_pr_for_branch(self, branch: str) -> dict[str, Any] | None:
        pulls = self._request("GET", self._repo_path("/pulls"), params={"state": "open", "head": f"{self.owner}:{branch}"})
        return pulls[0] if pulls else None

    def open_draft_pr(self, title: str, body: str, head: str, base: str) -> dict[str, Any]:
        return self._request(
            "POST",
            self._repo_path("/pulls"),
            json={"title": title, "body": body, "head": head, "base": base, "draft": True},
        )

    def get_pr(self, number: int) -> dict[str, Any]:
        return self._request("GET", self._repo_path(f"/pulls/{number}"))

    def mark_ready_for_review(self, pr_node_id: str) -> bool:
        data = self.graphql(
            """
            mutation($id: ID!) {
              markPullRequestReadyForReview(input: {pullRequestId: $id}) {
                pullRequest { isDraft }
              }
            }
            """,
            {"id": pr_node_id},
        )
        return not data["markPullRequestReadyForReview"]["pullRequest"]["isDraft"]

    def wait_until_mergeable(self, number: int, timeout_s: float = 120, interval_s: float = 3) -> dict[str, Any]:
        """GitHub computes `mergeable` lazily; poll until it stops being null."""
        deadline = time.monotonic() + timeout_s
        pr = self.get_pr(number)
        while pr.get("mergeable") is None and time.monotonic() < deadline:
            time.sleep(interval_s)
            pr = self.get_pr(number)
        if pr.get("mergeable") is False:
            raise GitHubError(f"pull request #{number} is not mergeable ({pr.get('mergeable_state')})")
        return pr

    def merge_squash(self, number: int, title: str, message: str = "") -> str:
        result = self._request(
            "PUT",
            self._repo_path(f"/pulls/{number}/merge"),
            json={"merge_method": "squash", "commit_title": title, "commit_message": message},
        )
        return result["sha"]

    def close_pr(self, number: int, comment: str | None = None) -> None:
        if comment:
            self.comment(number, comment)
        self._request("PATCH", self._repo_path(f"/pulls/{number}"), json={"state": "closed"})

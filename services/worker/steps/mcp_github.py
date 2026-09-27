"""GitHub remote MCP over streamable HTTP (raw JSON-RPC) and the model-driven issue filing."""

from __future__ import annotations

import json
import re
from typing import Any

import requests

import config
from steps import llm
from steps.github import GitHubClient

MCP_URL = "https://api.githubcopilot.com/mcp/"
PROTOCOL_VERSION = "2025-03-26"
TIMEOUT = 60


class McpError(RuntimeError):
    pass


class GitHubMcpClient:
    """Minimal streamable-HTTP MCP client: initialize, list tools, call tools."""

    def __init__(self, token: str | None = None, url: str = MCP_URL) -> None:
        self._token = token or config.github_token()
        self._url = url
        self._session_id: str | None = None
        self._next_id = 1

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        return headers

    @staticmethod
    def _parse(response: requests.Response) -> dict[str, Any] | None:
        """The server answers with plain JSON or with an SSE body whose last `data:` line is the result."""
        text = response.text.strip()
        if not text:
            return None
        if text.startswith(("event:", "data:", ":")):
            data_lines = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
            if not data_lines:
                return None
            return json.loads(data_lines[-1])
        return json.loads(text)

    def _rpc(self, method: str, params: dict[str, Any] | None = None, notification: bool = False) -> Any:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notification:
            payload["id"] = self._next_id
            self._next_id += 1
        response = requests.post(self._url, headers=self._headers(), json=payload, timeout=TIMEOUT)
        if response.status_code >= 400:
            raise McpError(f"{method} -> {response.status_code}: {response.text[:300]}")
        session = response.headers.get("Mcp-Session-Id")
        if session:
            self._session_id = session
        if notification:
            return None
        message = self._parse(response)
        if message is None:
            raise McpError(f"{method}: empty response")
        if "error" in message:
            raise McpError(f"{method}: {message['error']}")
        return message.get("result")

    def initialize(self) -> dict[str, Any]:
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "lantern-worker", "version": "0.1.0"},
            },
        )
        self._rpc("notifications/initialized", notification=True)
        return result

    def list_tools(self) -> list[dict[str, Any]]:
        if self._session_id is None:
            self.initialize()
        return self._rpc("tools/list", {}).get("tools", [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if self._session_id is None:
            self.initialize()
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise McpError(f"{name}: {_content_text(result)[:500]}")
        return result


def _content_text(result: dict[str, Any]) -> str:
    parts = []
    for item in result.get("content", []):
        if item.get("type") == "text":
            parts.append(item.get("text", ""))
    return "\n".join(parts)


NUMBER_IN_URL = re.compile(r"/(?:issues|pull|pulls)/(\d+)")


def _issue_from_tool_result(result: dict[str, Any]) -> tuple[int, str]:
    """Find the issue or PR number and html url in whatever the MCP tool returned.

    The GitHub MCP server returns a trimmed object ({id, url, ...}) without `number`, so the
    number is taken from the url when it is not given.
    """
    structured = result.get("structuredContent")
    candidates: list[Any] = [structured] if structured else []
    text = _content_text(result)
    if text:
        try:
            candidates.append(json.loads(text))
        except json.JSONDecodeError:
            pass
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        url = candidate.get("html_url") or candidate.get("url") or ""
        number = candidate.get("number")
        if not number and url:
            match = NUMBER_IN_URL.search(str(url))
            number = int(match.group(1)) if match else None
        if number and url:
            return int(number), str(url)
    raise McpError(f"could not find issue number and url in tool result: {text[:300]}")


# The Responses API takes a function tool flat: name, description and parameters on the tool itself.
CREATE_ISSUE_FUNCTION = {
    "type": "function",
    "name": "create_issue",
    "description": "Create a GitHub issue in the repository. Call it exactly once with the drafted title and body.",
    "parameters": {
        "type": "object",
        "properties": {
            "owner": {"type": "string"},
            "repo": {"type": "string"},
            "title": {"type": "string"},
            "body": {"type": "string"},
            "labels": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["owner", "repo", "title", "body"],
    },
}


def _resolve_create_tool(tools: list[dict[str, Any]]) -> str:
    names = {tool["name"] for tool in tools}
    if "create_issue" in names:
        return "create_issue"
    if "issue_write" in names:
        return "issue_write"
    raise McpError("the MCP server exposes no issue creation tool")


def _mcp_arguments(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    arguments = {key: args[key] for key in ("owner", "repo", "title", "body", "labels") if key in args}
    if tool_name == "issue_write":
        arguments["method"] = "create"
    return arguments


def file_issue_with_model(
    repo_full_name: str,
    title: str,
    body: str,
    labels: list[str],
    mcp: GitHubMcpClient | None = None,
    rest: GitHubClient | None = None,
) -> dict[str, Any]:
    """Let the model call `create_issue`, execute that call through MCP, fall back to REST on any failure.

    Returns {number, url, transport, args_summary, result_summary}.
    """
    owner, repo = repo_full_name.split("/", 1)
    try:
        client = mcp or GitHubMcpClient(token=rest.token if rest else None)
        tool_name = _resolve_create_tool(client.list_tools())
        call = llm.function_call(
            llm.ARCHITECT_MODEL,
            system=(
                "You file GitHub issues for a product team. You are given a drafted issue. "
                "Call the create_issue tool exactly once with the title and body unchanged "
                f"(owner {owner!r}, repo {repo!r}, labels {labels!r}). Do not reply with text."
            ),
            user=f"Title:\n{title}\n\nBody:\n{body}",
            tools=[CREATE_ISSUE_FUNCTION],
            tool_name="create_issue",
        )
        args = dict(call)
        args.setdefault("owner", owner)
        args.setdefault("repo", repo)
        args.setdefault("labels", labels)
        # The model may lightly rephrase; the drafted text is the contract the trace shows.
        args["title"] = title
        args["body"] = body
        result = client.call_tool(tool_name, _mcp_arguments(tool_name, args))
        number, url = _issue_from_tool_result(result)
        return {
            "number": number,
            "url": url,
            "transport": "mcp",
            "args_summary": f"{tool_name}({owner}/{repo}, title={title!r})",
            "result_summary": f"issue #{number} created through MCP",
        }
    except Exception as error:  # noqa: BLE001 - any MCP or model failure must fall back to REST
        fallback = rest or GitHubClient(repo_full_name)
        # MCP may have created the issue before failing to report it; never file a second one.
        existing = fallback.find_open_issue_by_title(title)
        if existing:
            return {
                "number": int(existing["number"]),
                "url": existing["html_url"],
                "transport": "mcp",
                "args_summary": f"create_issue({owner}/{repo}, title={title!r})",
                "result_summary": f"issue #{existing['number']} created through MCP (found by title after {str(error)[:120]})",
            }
        issue = fallback.create_issue(title, body, labels)
        return {
            "number": int(issue["number"]),
            "url": issue["html_url"],
            "transport": "rest",
            "args_summary": f"POST /repos/{repo_full_name}/issues title={title!r}",
            "result_summary": f"MCP failed ({str(error)[:160]}); issue #{issue['number']} created through REST",
        }


def open_draft_pr_with_fallback(
    repo_full_name: str,
    title: str,
    body: str,
    head: str,
    base: str,
    mcp: GitHubMcpClient | None = None,
    rest: GitHubClient | None = None,
) -> tuple[dict[str, Any], str, str]:
    """Create the draft PR through the MCP `create_pull_request` tool, or REST when MCP fails.

    Returns (pr as returned by the REST API, transport, result summary).
    """
    owner, repo = repo_full_name.split("/", 1)
    fallback = rest or GitHubClient(repo_full_name)
    try:
        client = mcp or GitHubMcpClient(token=fallback.token)
        result = client.call_tool(
            "create_pull_request",
            {"owner": owner, "repo": repo, "title": title, "body": body, "head": head, "base": base, "draft": True},
        )
        number, _url = _issue_from_tool_result(result)
        return fallback.get_pr(number), "mcp", f"draft PR #{number} created through MCP"
    except Exception as error:  # noqa: BLE001 - REST is the fallback for any MCP failure
        # MCP may have created the PR before failing to report it; never open a second one.
        existing = fallback.find_open_pr_for_branch(head)
        if existing:
            return existing, "mcp", f"draft PR #{existing['number']} created through MCP (result parsed from the PR list)"
        pr = fallback.open_draft_pr(title, body, head, base)
        return pr, "rest", f"MCP failed ({str(error)[:160]}); draft PR #{pr['number']} created through REST"

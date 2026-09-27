import responses

from steps import mcp_github
from steps.github import GitHubClient

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"


def test_parse_sse_and_json_bodies() -> None:
    class Fake:
        def __init__(self, text: str) -> None:
            self.text = text

    sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    assert mcp_github.GitHubMcpClient._parse(Fake(sse)) == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}
    assert mcp_github.GitHubMcpClient._parse(Fake('{"result": 1}')) == {"result": 1}
    assert mcp_github.GitHubMcpClient._parse(Fake("")) is None


def test_issue_write_arguments_get_the_create_method() -> None:
    args = mcp_github._mcp_arguments("issue_write", {"owner": "o", "repo": "r", "title": "t", "body": "b", "labels": ["lantern"], "extra": 1})
    assert args == {"owner": "o", "repo": "r", "title": "t", "body": "b", "labels": ["lantern"], "method": "create"}
    assert "method" not in mcp_github._mcp_arguments("create_issue", {"owner": "o", "repo": "r"})


@responses.activate
def test_file_issue_falls_back_to_rest_when_mcp_fails() -> None:
    responses.post(mcp_github.MCP_URL, status=500, body="boom")
    responses.get(f"{API}/issues", json=[])
    responses.post(f"{API}/issues", json={"number": 9, "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/9"})
    rest = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    result = mcp_github.file_issue_with_model("AadiDahake/novaair-own-your-intelligence", "Add dark mode", "body", ["lantern"], rest=rest)
    assert result["number"] == 9
    assert result["transport"] == "rest"
    assert "MCP failed" in result["result_summary"]


def test_number_is_taken_from_the_url_when_missing() -> None:
    result = {"content": [{"type": "text", "text": '{"id":"5224554017","url":"https://github.com/AadiDahake/novaair-own-your-intelligence/issues/4"}'}]}
    assert mcp_github._issue_from_tool_result(result) == (4, "https://github.com/AadiDahake/novaair-own-your-intelligence/issues/4")
    pr = {"structuredContent": {"number": 7, "html_url": "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/7"}}
    assert mcp_github._issue_from_tool_result(pr) == (7, "https://github.com/AadiDahake/novaair-own-your-intelligence/pull/7")

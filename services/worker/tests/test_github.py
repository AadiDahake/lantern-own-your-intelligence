import json

import responses

from steps.github import GitHubClient

API = "https://api.github.com/repos/AadiDahake/novaair-own-your-intelligence"


@responses.activate
def test_push_files_builds_blob_tree_commit_and_ref() -> None:
    client = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    responses.get(f"{API}/git/commits/parent1", json={"tree": {"sha": "tree0"}})
    responses.post(f"{API}/git/blobs", json={"sha": "blob1"})
    responses.post(f"{API}/git/trees", json={"sha": "tree1"})
    responses.post(f"{API}/git/commits", json={"sha": "commit1"})
    responses.get(f"{API}/git/ref/heads/lantern/1-x", status=404, json={"message": "Not Found"})
    responses.post(f"{API}/git/refs", json={"ref": "refs/heads/lantern/1-x"})

    sha = client.push_files("lantern/1-x", "parent1", {"a.ts": "x\n"}, "feat: x\n\nCloses #1")

    assert sha == "commit1"
    tree_call = next(c for c in responses.calls if c.request.url.endswith("/git/trees"))
    tree_body = json.loads(tree_call.request.body)
    assert tree_body["base_tree"] == "tree0"
    assert tree_body["tree"] == [{"path": "a.ts", "mode": "100644", "type": "blob", "sha": "blob1"}]
    commit_body = json.loads(next(c for c in responses.calls if c.request.url.endswith("/git/commits")).request.body)
    assert commit_body["parents"] == ["parent1"]
    assert commit_body["tree"] == "tree1"
    ref_body = json.loads(next(c for c in responses.calls if c.request.url.endswith("/git/refs")).request.body)
    assert ref_body == {"ref": "refs/heads/lantern/1-x", "sha": "commit1"}


@responses.activate
def test_push_files_force_updates_existing_branch() -> None:
    client = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    responses.get(f"{API}/git/commits/parent1", json={"tree": {"sha": "tree0"}})
    responses.post(f"{API}/git/blobs", json={"sha": "blob1"})
    responses.post(f"{API}/git/trees", json={"sha": "tree1"})
    responses.post(f"{API}/git/commits", json={"sha": "commit2"})
    responses.get(f"{API}/git/ref/heads/lantern/1-x", json={"object": {"sha": "old"}})
    responses.patch(f"{API}/git/refs/heads/lantern/1-x", json={"object": {"sha": "commit2"}})
    assert client.push_files("lantern/1-x", "parent1", {"a.ts": "x\n"}, "m") == "commit2"
    patch = json.loads(responses.calls[-1].request.body)
    assert patch == {"sha": "commit2", "force": True}


@responses.activate
def test_open_draft_pr_and_dedupe_issue() -> None:
    client = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    responses.post(f"{API}/pulls", json={"number": 7, "html_url": "https://github.com/x/pull/7", "node_id": "PR_1"})
    pr = client.open_draft_pr("feat: x", "body", "lantern/1-x", "main")
    assert pr["number"] == 7
    assert json.loads(responses.calls[-1].request.body)["draft"] is True

    responses.get(
        f"{API}/issues",
        json=[{"number": 3, "title": "Add Dark Mode", "html_url": "u"}, {"number": 4, "title": "pr", "pull_request": {}}],
    )
    found = client.find_open_issue_by_title("add dark mode")
    assert found and found["number"] == 3
    assert client.find_open_issue_by_title("something else") is None


@responses.activate
def test_mark_ready_merge_and_close() -> None:
    client = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    responses.post(
        "https://api.github.com/graphql",
        json={"data": {"markPullRequestReadyForReview": {"pullRequest": {"isDraft": False}}}},
    )
    assert client.mark_ready_for_review("PR_1") is True
    assert "markPullRequestReadyForReview" in json.loads(responses.calls[-1].request.body)["query"]

    responses.get(f"{API}/pulls/7", json={"number": 7, "mergeable": True})
    assert client.wait_until_mergeable(7)["mergeable"] is True
    responses.put(f"{API}/pulls/7/merge", json={"sha": "merge1", "merged": True})
    assert client.merge_squash(7, "feat: x (#7)") == "merge1"
    assert json.loads(responses.calls[-1].request.body)["merge_method"] == "squash"

    responses.post(f"{API}/issues/7/comments", json={"id": 1})
    responses.patch(f"{API}/pulls/7", json={"state": "closed"})
    client.close_pr(7, "no thanks")
    assert json.loads(responses.calls[-1].request.body) == {"state": "closed"}


@responses.activate
def test_push_files_removes_a_deleted_path_from_the_tree() -> None:
    """A null blob sha is how the Git data API takes a file out of the tree."""
    client = GitHubClient("AadiDahake/novaair-own-your-intelligence", token="t")
    responses.get(f"{API}/git/commits/parent1", json={"tree": {"sha": "tree0"}})
    responses.post(f"{API}/git/blobs", json={"sha": "blob1"})
    responses.post(f"{API}/git/trees", json={"sha": "tree1"})
    responses.post(f"{API}/git/commits", json={"sha": "commit1"})
    responses.get(f"{API}/git/ref/heads/lantern/7-seats", status=404, json={"message": "Not Found"})
    responses.post(f"{API}/git/refs", json={"ref": "refs/heads/lantern/7-seats"})

    client.push_files(
        "lantern/7-seats", "parent1", {"lib/seats/together.ts": "x\n"}, "feat: x",
        deletions=["tests/no-group-seating.test.ts"],
    )

    tree_body = json.loads(next(c for c in responses.calls if c.request.url.endswith("/git/trees")).request.body)
    assert tree_body["tree"] == [
        {"path": "lib/seats/together.ts", "mode": "100644", "type": "blob", "sha": "blob1"},
        {"path": "tests/no-group-seating.test.ts", "mode": "100644", "type": "blob", "sha": None},
    ]

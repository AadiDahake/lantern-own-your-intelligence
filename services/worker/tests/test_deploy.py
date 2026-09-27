import pytest
import responses

from steps import deploy


@responses.activate
def test_wait_for_deployment_returns_the_configured_production_address(monkeypatch) -> None:
    monkeypatch.setattr(deploy, "POLL_S", 0)
    monkeypatch.setenv("TARGET_PRODUCTION_URL", "https://novaair.example.com")
    responses.get("https://api.vercel.com/v9/projects/novaair", json={"id": "prj_1"})
    responses.get(
        "https://api.vercel.com/v6/deployments",
        json={"deployments": [{"uid": "d1", "meta": {"githubCommitSha": "abc"}, "readyState": "BUILDING", "url": "x.vercel.app", "target": "production"}]},
    )
    responses.get(
        "https://api.vercel.com/v6/deployments",
        json={"deployments": [{"uid": "d1", "meta": {"githubCommitSha": "abc"}, "readyState": "READY", "url": "x-abc.vercel.app", "target": "production"}]},
    )
    assert deploy.wait_for_deployment("abc", "novaair") == "https://novaair.example.com"


def test_deployment_url_for_preview() -> None:
    assert deploy.deployment_url({"url": "x-abc.vercel.app", "target": None}, "https://novaair.example.com") == "https://x-abc.vercel.app"


@responses.activate
def test_wait_for_deployment_finds_the_commit_by_sha(monkeypatch) -> None:
    """The git integration builds the merge itself, so the commit is how the watch finds it."""
    monkeypatch.setattr(deploy, "POLL_S", 0)
    monkeypatch.setenv("TARGET_PRODUCTION_URL", "https://novaair.example.com")
    responses.get("https://api.vercel.com/v9/projects/novaair", json={"id": "prj_1"})
    responses.get(
        "https://api.vercel.com/v6/deployments",
        json={"deployments": [{"uid": "d1", "meta": {"githubCommitSha": "ABC123"}, "readyState": "READY", "url": "x.vercel.app", "target": "production"}]},
    )
    assert deploy.wait_for_deployment("abc123", "novaair") == "https://novaair.example.com"
    asked = [call.request.url for call in responses.calls if "/v6/deployments" in call.request.url]
    assert any("sha=abc123" in url for url in asked)


@responses.activate
def test_wait_for_deployment_times_out_cleanly(monkeypatch) -> None:
    """Ten minutes and then a clean stop, so a run never hangs on a deployment that never lands."""
    monkeypatch.setattr(deploy, "POLL_S", 0)
    responses.get("https://api.vercel.com/v9/projects/novaair", json={"id": "prj_1"})
    responses.get("https://api.vercel.com/v6/deployments", json={"deployments": []})
    with pytest.raises(deploy.DeploymentTimeout) as error:
        deploy.wait_for_deployment("abc123", "novaair", timeout_s=0)
    assert "abc123"[:7] in str(error.value)
    assert "novaair" in str(error.value)
    assert issubclass(deploy.DeploymentTimeout, deploy.DeployError)


def test_the_watch_gives_up_after_ten_minutes() -> None:
    assert deploy.TIMEOUT_S == 10 * 60

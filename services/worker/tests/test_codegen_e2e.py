"""End-to-end drafting against the fixture app with the real model API. Skipped without OPENAI_API_KEY."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from models import FeatureRequestInput
from steps import applier, codegen, drafting
from steps.reporter import NullReporter

pytestmark = pytest.mark.skipif(not os.environ.get("OPENAI_API_KEY"), reason="OPENAI_API_KEY is not set")

FIXTURE = Path(__file__).parent / "fixtures" / "mini-next-app"


def _request() -> FeatureRequestInput:
    return FeatureRequestInput(
        escalation_id="test-escalation",
        project_id="test-project",
        repo_full_name="AadiDahake/novaair-own-your-intelligence",
        title="Add a dark mode toggle",
        description="Add a dark theme and a toggle in the header that switches it on and off. The choice must survive a reload.",
        area="Header / appearance",
        quote="How do I turn on dark mode?",
        rationale="Users working at night asked for it.",
        site_url="https://novaair.example.com",
    )


def test_dark_mode_draft_passes_gates(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE, root)
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "add", "-A"], cwd=root, check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "init"], cwd=root, check=True)

    req = _request()
    issue_body = "Users cannot switch the console to a dark theme. Add a theme toggle in the header."
    plan, _summary = codegen.plan_changes(root, req, req.title, issue_body)
    paths = {f.path for f in plan.files}
    assert "styles/tokens.css" in paths
    assert any(p.startswith("components/") for p in paths)
    assert plan.acceptance_criteria

    reporter = NullReporter()
    print("plan:", [(f.path, f.reason) for f in plan.files])
    try:
        draft = drafting.draft_with_gates(root, req, req.title, issue_body, plan, reporter, "fixture-mini-next-app")
    finally:
        for kind, event in reporter.events:
            print(kind, event.get("title"), event.get("status", ""), (event.get("result_summary") or "")[:300])
    assert draft.files
    assert any(".dark" in content for content in draft.files.values())
    for d in draft.diffs:
        print(d.patch)
        assert d.patch
    gates = [e for kind, e in reporter.events if kind == "tool" and e["tool"] == "npm run build"]
    assert gates and gates[-1]["status"] == "ok"
    for path in draft.files:
        applier.safe_join(root, path)

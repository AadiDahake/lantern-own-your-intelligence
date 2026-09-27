"""The architect's plan: the retry that answers a refusal, and the deletion of a guard."""

from pathlib import Path

import pytest

from models import FeatureRequestInput
from steps import codegen


def _repo(tmp_path: Path) -> Path:
    (tmp_path / "lib" / "seats").mkdir(parents=True)
    (tmp_path / "app" / "api").mkdir(parents=True)
    (tmp_path / "tests").mkdir()
    (tmp_path / "lib" / "seats" / "index.ts").write_text("export async function assignSeat() {}\n")
    (tmp_path / "app" / "api" / "route.ts").write_text("export async function POST() {}\n")
    (tmp_path / "tests" / "no-group-seating.test.ts").write_text("it('has no group seating', () => {})\n")
    (tmp_path / "package.json").write_text('{"dependencies": {"next": "15"}}\n')
    (tmp_path / "AGENTS.md").write_text(
        "The primitives are in `lib/seats/index.ts`. `tests/no-group-seating.test.ts` guards their absence.\n"
    )
    return tmp_path


def _request() -> FeatureRequestInput:
    return FeatureRequestInput(
        escalation_id="e", project_id="p", repo_full_name="owner/repo",
        title="Enable seat selection for families traveling",
        description="Find three seats together and move the whole party.",
        area="Seat selection",
    )


def _stub_plan(files: list[dict[str, str]], summary: str = "a plan") -> dict[str, object]:
    return {"summary": summary, "files": files, "acceptance_criteria": ["it works"]}


def test_plan_changes_retries_once_when_the_architect_refuses(monkeypatch, tmp_path: Path) -> None:
    """A refusal is not a plan. The second call is told so, and its answer is the plan."""
    root = _repo(tmp_path)
    prompts: list[str] = []
    answers = [
        _stub_plan([], "AGENTS.md requires raising this rather than implementing it."),
        _stub_plan([
            {"path": "lib/seats/together.ts", "reason": "find the group", "action": "create"},
            {"path": "tests/no-group-seating.test.ts", "reason": "asserts the absence", "action": "delete"},
        ]),
    ]

    def fake_complete_json(model, system, user, name, schema):  # noqa: ANN001, ANN202
        prompts.append(user)
        return answers[len(prompts) - 1]

    monkeypatch.setattr(codegen.llm, "complete_json", fake_complete_json)
    monkeypatch.setattr(codegen.repo, "head_sha", lambda _root: "deadbee")

    plan, input_summary = codegen.plan_changes(root, _request(), "Seats together", "body")

    assert len(prompts) == 2
    assert codegen.RETRY_INSTRUCTION in prompts[1]
    assert "AGENTS.md requires raising this" in prompts[1]
    assert [f.path for f in plan.files] == ["lib/seats/together.ts", "tests/no-group-seating.test.ts"]
    assert plan.files[0].action == "create" and plan.files[0].is_new
    assert plan.files[1].action == "delete" and plan.files[1].is_delete
    assert "2 attempts" in input_summary


def test_plan_changes_raises_with_the_model_text_after_two_empty_answers(monkeypatch, tmp_path: Path) -> None:
    """Never zero files silently: the trace has to carry the model's reason."""
    root = _repo(tmp_path)
    monkeypatch.setattr(
        codegen.llm, "complete_json",
        lambda *_args, **_kwargs: _stub_plan([], "This change is out of scope for the repository."),
    )
    with pytest.raises(RuntimeError) as error:
        codegen.plan_changes(root, _request(), "Seats together", "body")
    assert "This change is out of scope for the repository." in str(error.value)
    assert "two attempts" in str(error.value)


def test_plan_changes_reconciles_the_action_with_the_clone(monkeypatch, tmp_path: Path) -> None:
    """The model's action is a claim about the clone, so the clone settles it."""
    root = _repo(tmp_path)
    monkeypatch.setattr(
        codegen.llm, "complete_json",
        lambda *_args, **_kwargs: _stub_plan([
            {"path": "lib/seats/index.ts", "reason": "already there", "action": "create"},
            {"path": "lib/seats/new.ts", "reason": "not there yet", "action": "edit"},
            {"path": "lib/seats/gone.ts", "reason": "never existed", "action": "delete"},
        ]),
    )
    monkeypatch.setattr(codegen.repo, "head_sha", lambda _root: "deadbee")
    plan, _ = codegen.plan_changes(root, _request(), "Seats together", "body")
    actions = {f.path: f.action for f in plan.files}
    assert actions == {"lib/seats/index.ts": "edit", "lib/seats/new.ts": "create"}


def test_the_plan_schema_refuses_an_empty_file_list() -> None:
    """The strict schema itself is the first guard against a plan with nothing in it."""
    assert codegen.PLAN_SCHEMA["properties"]["files"]["minItems"] == 1
    assert codegen.PLAN_SCHEMA["properties"]["files"]["items"]["properties"]["action"]["enum"] == [
        "edit", "create", "delete",
    ]


def test_the_architect_is_told_the_decision_supersedes_a_guard() -> None:
    """The prompt has to say this, because the repository it reads says the opposite."""
    assert "APPROVED PRODUCT DECISION" in codegen.ARCHITECT_SYSTEM
    assert 'action: "delete"' in codegen.ARCHITECT_SYSTEM
    assert "Never answer with an empty file list" in codegen.ARCHITECT_SYSTEM


def test_relevant_files_sends_whole_files_and_lifts_what_agents_md_names(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    agents_md = (root / "AGENTS.md").read_text()
    tree = codegen.repo.list_source_files(root)
    terms = codegen.repo.keywords("seat selection for families")
    chosen = codegen.relevant_files(root, tree, terms, agents_md)
    paths = [path for path, _ in chosen]
    assert "lib/seats/index.ts" in paths
    assert "tests/no-group-seating.test.ts" in paths
    assert "AGENTS.md" not in paths  # it has its own block in the prompt
    body = dict(chosen)["lib/seats/index.ts"]
    assert body == "export async function assignSeat() {}\n"


def test_relevant_files_respects_the_character_budget(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    tree = codegen.repo.list_source_files(root)
    terms = codegen.repo.keywords("seat")
    assert codegen.relevant_files(root, tree, terms, "", budget=10) == []


def test_the_prompt_asks_about_every_file_the_conventions_name(tmp_path: Path) -> None:
    """Naming the guard is what stops a plan shipping the feature and leaving the test that bans it."""
    root = _repo(tmp_path)
    agents_md = (root / "AGENTS.md").read_text()
    tree = codegen.repo.list_source_files(root)
    referenced = codegen.repo.referenced_paths(tree, agents_md)
    prompt = codegen.build_architect_prompt(
        _request(), "Seats together", "body", agents_md, tree, [], "", referenced,
    )
    assert "# Files the conventions name" in prompt
    assert "- tests/no-group-seating.test.ts" in prompt
    assert "- lib/seats/index.ts" in prompt
    assert "a delete when asserting the absence is the file's only purpose" in prompt


def test_the_prompt_omits_the_block_when_the_conventions_name_nothing(tmp_path: Path) -> None:
    root = _repo(tmp_path)
    prompt = codegen.build_architect_prompt(_request(), "t", "b", "no paths here", [], [], "", set())
    assert "# Files the conventions name" not in prompt


def test_the_file_cap_never_drops_a_deletion() -> None:
    """The cap makes the architect prioritise; a guard must not lose that contest."""
    planned = [
        codegen.PlannedFile(path=f"lib/f{i}.ts", reason="r", action="edit")
        for i in range(codegen.MAX_FILES)
    ] + [codegen.PlannedFile(path="tests/guard.test.ts", reason="asserts the absence", action="delete")]

    capped = codegen._cap(planned, codegen.MAX_FILES)

    assert len(capped) == codegen.MAX_FILES
    assert [f.path for f in capped if f.is_delete] == ["tests/guard.test.ts"]
    # The tail is what gives way, and the model's own order survives.
    assert [f.path for f in capped][:-1] == [f"lib/f{i}.ts" for i in range(codegen.MAX_FILES - 1)]


def test_the_file_cap_leaves_a_plan_that_fits_alone() -> None:
    planned = [codegen.PlannedFile(path=f"lib/f{i}.ts", reason="r", action="edit") for i in range(3)]
    assert codegen._cap(planned, codegen.MAX_FILES) == planned


def test_plan_changes_drops_a_path_that_escapes_the_clone(monkeypatch, tmp_path: Path) -> None:
    """A path is model output, and the commit builder writes it into the tree unchecked."""
    root = _repo(tmp_path)
    monkeypatch.setattr(
        codegen.llm, "complete_json",
        lambda *_args, **_kwargs: _stub_plan([
            {"path": "../../etc/passwd", "reason": "no", "action": "edit"},
            {"path": ".git/config", "reason": "no", "action": "edit"},
            {"path": "lib/seats/together.ts", "reason": "yes", "action": "create"},
        ]),
    )
    monkeypatch.setattr(codegen.repo, "head_sha", lambda _root: "deadbee")
    plan, _ = codegen.plan_changes(root, _request(), "Seats together", "body")
    assert [f.path for f in plan.files] == ["lib/seats/together.ts"]


def test_relative_strips_only_a_leading_dot_slash() -> None:
    """`lstrip("./")` rewrote a traversal into a plausible path instead of leaving it rejectable."""
    assert codegen._relative("./lib/seats/index.ts") == "lib/seats/index.ts"
    assert codegen._relative("  ././app/page.tsx ") == "app/page.tsx"
    assert codegen._relative("../../etc/passwd") == "../../etc/passwd"
    assert codegen._relative(".git/config") == ".git/config"
    assert codegen._relative("lib/seats/index.ts") == "lib/seats/index.ts"

from pathlib import Path

from steps import repo
from steps.codegen import strip_fences


def _fixture() -> Path:
    return Path(__file__).parent / "fixtures" / "mini-next-app"


def test_keywords_expand_synonyms_and_drop_stopwords() -> None:
    terms = repo.keywords("Add dark mode", "Users want a dark theme")
    assert "dark" in terms and "theme" in terms and "tokens" in terms
    assert "the" not in terms and "add" not in terms


def test_rank_files_puts_tokens_and_header_first_for_dark_mode() -> None:
    root = _fixture()
    paths = repo.list_source_files(root)
    assert "package-lock.json" not in paths
    assert "styles/tokens.css" in paths
    ranked = repo.rank_files(root, paths, repo.keywords("Add dark mode", "a dark theme toggle in the header"), limit=5)
    top = [path for path, _ in ranked]
    # The two files a dark mode change has to touch lead, in either order: the request names the
    # toggle and the header, and the tokens are where a theme lives.
    assert set(top[:2]) == {"styles/tokens.css", "components/HeaderActions.tsx"}
    assert "AGENTS.md" in top


def test_a_long_document_does_not_outrank_the_module_it_describes(tmp_path: Path) -> None:
    """The regression that made the architect read the wrong repository.

    Body hits used to dominate, so a document mentioning every word of the request outranked the
    module the request is about. The path is the signal now, and the body only breaks ties.
    """
    (tmp_path / "lib" / "seats").mkdir(parents=True)
    (tmp_path / "docs").mkdir()
    (tmp_path / "lib" / "seats" / "index.ts").write_text("export async function assignSeat() {}\n")
    (tmp_path / "docs" / "analytics.md").write_text(("seat family together adjacent children " * 200) + "\n")
    paths = repo.list_source_files(tmp_path)
    terms = repo.keywords("Enable family seat changes to keep parents and children together")
    ranked = [path for path, _ in repo.rank_files(tmp_path, paths, terms)]
    assert ranked[0] == "lib/seats/index.ts"


def test_referenced_paths_lifts_what_the_conventions_name(tmp_path: Path) -> None:
    """A file AGENTS.md names carries the contract, so it is read even when the words do not match."""
    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "contract.ts").write_text("export const seven = 7\n")
    (tmp_path / "lib" / "unrelated.ts").write_text("export const other = 1\n")
    agents_md = "The primitives live in `lib/contract.ts` and `docs/missing.md` does not exist.\n"
    (tmp_path / "AGENTS.md").write_text(agents_md)
    paths = repo.list_source_files(tmp_path)

    referenced = repo.referenced_paths(paths, agents_md)
    assert referenced == {"lib/contract.ts"}

    terms = repo.keywords("add a way to group things")
    ranked = [path for path, _ in repo.rank_files(tmp_path, paths, terms, referenced=referenced)]
    assert ranked[0] == "lib/contract.ts"


def test_read_bounded_truncates_on_a_line_boundary(tmp_path: Path) -> None:
    target = tmp_path / "long.ts"
    target.write_text("const a = 1\nconst b = 2\nconst c = 3\n")
    assert repo.read_bounded(tmp_path, "long.ts", 1000) == "const a = 1\nconst b = 2\nconst c = 3\n"
    bounded = repo.read_bounded(tmp_path, "long.ts", 20)
    assert bounded.startswith("const a = 1\n")
    assert "truncated" in bounded
    assert "const c" not in bounded


def test_rank_files_is_deterministic() -> None:
    root = _fixture()
    paths = repo.list_source_files(root)
    terms = repo.keywords("keyboard shortcut to open search")
    assert repo.rank_files(root, paths, terms) == repo.rank_files(root, paths, terms)


def test_strip_fences() -> None:
    assert strip_fences("```tsx\nconst a = 1;\n```") == "const a = 1;\n"
    assert strip_fences("```\nx\n```\n") == "x\n"
    assert strip_fences("plain\n") == "plain\n"
    assert strip_fences("no newline") == "no newline\n"

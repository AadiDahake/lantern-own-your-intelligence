"""Local clone of the target repository: clone, list files, rank them, read them."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import config

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".md", ".json", ".mdx"}
IGNORED_DIRS = {"node_modules", ".next", ".git", "dist", "out", "build", "coverage", ".vercel"}
IGNORED_FILES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "next-env.d.ts"}

# Where a change to a product's behaviour lives, and where it does not. The architect is choosing
# files to edit, so the source tree outranks the material that only describes or checks it.
SOURCE_PRIORS: tuple[tuple[str, float], ...] = (
    ("components/", 1.0),
    ("app/", 1.0),
    ("lib/", 1.0),
    ("src/", 1.0),
    ("styles/", 0.75),
    ("pages/", 1.0),
    ("server/", 0.75),
    ("docs/", -1.5),
    ("scripts/", -1.5),
    ("e2e/", -1.0),
    ("tests/", -1.0),
    ("test/", -1.0),
    ("__tests__/", -1.0),
)
# A path a convention document points at is a file the repository considers load-bearing.
REFERENCE_BONUS = 2.5
# Body matches break ties between paths that score the same. They never outweigh the path itself:
# a long document that mentions every word must not outrank the module the words are about.
BODY_WEIGHT = 0.15
BODY_HITS_PER_TERM = 3
BODY_SCORE_CAP = 4.0
STOPWORDS = {
    "the", "a", "an", "to", "of", "for", "and", "or", "in", "on", "is", "it", "be", "add", "with",
    "this", "that", "user", "users", "can", "should", "so", "as", "at", "by", "from", "into", "i",
    "want", "would", "like", "there", "no", "not", "have", "has", "page", "app", "feature",
}
SYNONYMS = {
    "dark": ["theme", "dark", "light", "appearance", "color", "colour", "tokens"],
    "theme": ["theme", "dark", "light", "appearance", "tokens"],
    "mode": ["theme", "mode"],
    "shortcut": ["shortcut", "keyboard", "hotkey", "key"],
    "keyboard": ["shortcut", "keyboard", "hotkey", "key"],
    "search": ["search", "command", "palette", "find"],
    "header": ["header", "headeractions", "nav", "topbar"],
    "toggle": ["toggle", "switch", "button"],
    "username": ["username", "profile", "account", "user"],
}


def clone(repo_full_name: str, branch: str, dest: Path, token: str | None = None) -> str:
    """Shallow clone over https with the token in the URL; the URL never leaves this process."""
    token = token or config.github_token()
    url = f"https://x-access-token:{token}@github.com/{repo_full_name}.git"
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    result = subprocess.run(
        ["git", "clone", "--quiet", "--depth", "1", "--branch", branch, url, str(dest)],
        capture_output=True, text=True, env=env, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError("git clone failed: " + result.stderr.replace(token, "***")[:400])
    return head_sha(dest)


def head_sha(root: Path) -> str:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True)
    return result.stdout.strip()


def list_source_files(root: Path) -> list[str]:
    paths: list[str] = []
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS and not d.startswith("."))
        rel_dir = Path(current).relative_to(root)
        for name in sorted(files):
            if name in IGNORED_FILES or Path(name).suffix not in SOURCE_SUFFIXES:
                continue
            paths.append(str(rel_dir / name) if str(rel_dir) != "." else name)
    return paths


def keywords(*texts: str) -> list[str]:
    """Lowercase content words, expanded with a small synonym list so 'dark mode' finds tokens.css."""
    tokens: list[str] = []
    for text in texts:
        for word in re.findall(r"[a-zA-Z][a-zA-Z0-9]+", text.lower()):
            if word in STOPWORDS or len(word) < 3:
                continue
            tokens.append(word)
            tokens.extend(SYNONYMS.get(word, []))
    seen: set[str] = set()
    ordered = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            ordered.append(token)
    return ordered


BACKTICK_PATH_RE = re.compile(r"`([A-Za-z0-9_./\[\]-]+\.[A-Za-z0-9]+)`")


def referenced_paths(paths: list[str], *documents: str) -> set[str]:
    """The files a convention document names in backticks, which exist in the tree.

    A repository that documents itself says which files carry its contract: NovaAir's AGENTS.md
    names `lib/seats/index.ts`, `docs/api.md` and the test that guards them. Those are the files an
    architect has to read before it plans anything, whatever the request's own words happen to be.
    """
    known = set(paths)
    found: set[str] = set()
    for document in documents:
        for match in BACKTICK_PATH_RE.findall(document or ""):
            candidate = match.strip().lstrip("./")
            if candidate in known:
                found.add(candidate)
    return found


def _path_score(path: str, terms: list[str]) -> float:
    """How much this path's own name says it is about the request. The dominant signal, as in the
    web app's repository probe, which ranks on the path alone."""
    lowered = path.lower()
    name = Path(lowered).name
    score = 0.0
    for term in terms:
        if term in lowered:
            score += 3.0 if term in name else 1.5
    if name in {"agents.md", "readme.md", "claude.md"}:
        score += 0.5
    for prefix, prior in SOURCE_PRIORS:
        if lowered.startswith(prefix):
            score += prior
            break
    return score


def _body_score(root: Path, path: str, terms: list[str]) -> float:
    try:
        body = (root / path).read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return 0.0
    hits = sum(min(body.count(term), BODY_HITS_PER_TERM) for term in terms)
    return min(BODY_WEIGHT * hits, BODY_SCORE_CAP)


def rank_files(
    root: Path,
    paths: list[str],
    terms: list[str],
    limit: int = 12,
    referenced: set[str] | None = None,
) -> list[tuple[str, float]]:
    """Rank by what the path says, then by keyword hits in the body as a bounded tie-breaker.

    `referenced` are paths a convention document names; they carry the repository's contract, so
    they are lifted whether or not the request happens to use their words.
    """
    lifted = referenced or set()
    scored: list[tuple[str, float]] = []
    for path in paths:
        score = _path_score(path, terms) + _body_score(root, path, terms)
        if path in lifted:
            score += REFERENCE_BONUS
        scored.append((path, score))
    scored.sort(key=lambda item: (-item[1], item[0]))
    return scored[:limit]


def read_head(root: Path, path: str, lines: int = 40) -> str:
    try:
        text = (root / path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    return "\n".join(text.splitlines()[:lines])


def read_bounded(root: Path, path: str, max_chars: int) -> str:
    """A file's contents, truncated at a line boundary so the model never reads half a statement."""
    try:
        text = (root / path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    if len(text) <= max_chars:
        return text
    kept = text[:max_chars].rsplit("\n", 1)[0]
    return f"{kept}\n... (truncated, the file is {len(text)} characters)\n"


def read_file(root: Path, path: str) -> str | None:
    try:
        return (root / path).read_text(encoding="utf-8")
    except OSError:
        return None


def repo_slug(repo_full_name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]", "-", repo_full_name)

"""The GitHub token a project linked, decrypted.

The dashboard encrypts it in `apps/web/lib/github/secret.ts`, in the sealed format that
`steps/seal.py` reads. `tests/test_github_token.py` decrypts a value the TypeScript side produced,
which is what keeps this honest.
"""

from __future__ import annotations

from typing import Any

from steps import db, seal

PURPOSE = "github-token"


def decrypt_token(stored: str, service_role_key: str | None = None) -> str | None:
    """Returns None for anything that does not decrypt cleanly, so a stale row reads as unlinked."""
    return seal.unseal(PURPOSE, stored, service_role_key)


def project_token(project_id: str) -> str | None:
    """The token the project's owner linked, or None when nobody linked an account.

    A lookup that fails is not worth failing the run over: the caller falls back to the server
    credential, which is what a project without a linked account uses anyway.
    """
    try:
        project: dict[str, Any] | None = db.get_project(project_id)
    except Exception:  # noqa: BLE001 - any transport or database failure means "no linked token"
        return None
    stored = (project or {}).get("github_token")
    return decrypt_token(stored) if stored else None

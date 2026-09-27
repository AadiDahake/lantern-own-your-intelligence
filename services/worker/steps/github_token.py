"""The GitHub token a project linked, decrypted.

The dashboard encrypts it in `apps/web/lib/github/secret.ts` and this reads exactly that format,
so the two must stay in step:

  * AES-256-GCM.
  * The key is scrypt(service role key, "lantern:github-token", 32) with Node's defaults,
    N=16384, r=8, p=1, which are also OpenSSL's.
  * The stored value is `iv.ciphertext.tag`, each part base64url without padding.

`tests/test_github_token.py` decrypts a value the TypeScript side produced, which is what keeps
this honest.
"""

from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import config
from steps import db

PURPOSE = "lantern:github-token"
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
KEY_BYTES = 32


def _b64url(value: str) -> bytes:
    """base64url without padding, which is what Node writes."""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def derive_key(service_role_key: str) -> bytes:
    return hashlib.scrypt(
        service_role_key.encode("utf-8"),
        salt=PURPOSE.encode("utf-8"),
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_BYTES,
        maxmem=64 * 1024 * 1024,
    )


def decrypt_token(stored: str, service_role_key: str | None = None) -> str | None:
    """Returns None for anything that does not decrypt cleanly, so a stale row reads as unlinked."""
    parts = stored.split(".")
    if len(parts) != 3:
        return None
    try:
        iv, body, tag = (_b64url(part) for part in parts)
        key = derive_key(service_role_key or config.supabase_service_role_key())
        return AESGCM(key).decrypt(iv, body + tag, None).decode("utf-8")
    except (InvalidTag, ValueError, UnicodeDecodeError):
        return None


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

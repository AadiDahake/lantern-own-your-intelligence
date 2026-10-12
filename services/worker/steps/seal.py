"""Values the dashboard stores encrypted, opened.

The dashboard seals a value in `apps/web/lib/seal.ts` and this reads exactly that format, so the
two must stay in step:

  * AES-256-GCM.
  * The key is scrypt(service role key, "lantern:<purpose>", 32) with Node's defaults,
    N=16384, r=8, p=1, which are also OpenSSL's.
  * The stored value is `iv.ciphertext.tag`, each part base64url without padding.

Each kind of value has its own purpose, so a value sealed for one purpose does not open under
another. `tests/test_github_token.py` and `tests/test_seal.py` open values the TypeScript side
produced, which is what keeps this honest.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import config

SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
KEY_BYTES = 32

# The derived keys, one for each purpose, with the secret each one was derived from.
_derived: dict[str, tuple[str, bytes]] = {}


def _b64url(value: str) -> bytes:
    """base64url without padding, which is what Node writes."""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def derive_key(purpose: str, service_role_key: str) -> bytes:
    return hashlib.scrypt(
        service_role_key.encode("utf-8"),
        salt=f"lantern:{purpose}".encode("utf-8"),
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_BYTES,
        maxmem=64 * 1024 * 1024,
    )


def _key(purpose: str, service_role_key: str) -> bytes:
    """The key for a purpose, derived one time and kept.

    scrypt is slow on purpose (tens of milliseconds), and a list of sealed values is opened in
    one loop. A changed service role key gives a new key on the next call.
    """
    kept = _derived.get(purpose)
    if kept and kept[0] == service_role_key:
        return kept[1]
    fresh = derive_key(purpose, service_role_key)
    _derived[purpose] = (service_role_key, fresh)
    return fresh


def unseal(purpose: str, stored: str, service_role_key: str | None = None) -> str | None:
    """Returns None for anything that does not decrypt cleanly, so a stale row reads as empty."""
    parts = stored.split(".")
    if len(parts) != 3:
        return None
    try:
        iv, body, tag = (_b64url(part) for part in parts)
        key = _key(purpose, service_role_key or config.supabase_service_role_key())
        return AESGCM(key).decrypt(iv, body + tag, None).decode("utf-8")
    except (InvalidTag, ValueError, UnicodeDecodeError):
        return None

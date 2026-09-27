"""The worker must read exactly what the dashboard writes.

FIXTURE is the output of

    npx tsx apps/web/scripts/github-token-fixture.ts \\
      sbp_test_service_role_key_for_fixtures_only ghu_fixture_token_value_not_real

so it was produced by `apps/web/lib/github/secret.ts` itself. The key and the token in it are
throwaway strings, never a real credential. Regenerate it if that file's format ever changes.
"""

from __future__ import annotations

import pytest

from steps import github_token

FIXTURE = {
    "serviceRoleKey": "sbp_test_service_role_key_for_fixtures_only",
    "plain": "ghu_fixture_token_value_not_real",
    "stored": "hZH2Jqqzs08HHllO.u7Lsq0-00kxhVVcT4l8EgSSfcJD38yPb2yfItNMyZqU.4jDNBEbsOczjI4RiB-u4_g",
}


def test_decrypts_a_value_the_typescript_side_encrypted() -> None:
    assert (
        github_token.decrypt_token(FIXTURE["stored"], FIXTURE["serviceRoleKey"]) == FIXTURE["plain"]
    )


def test_the_wrong_service_role_key_does_not_decrypt() -> None:
    assert github_token.decrypt_token(FIXTURE["stored"], "some-other-key") is None


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "not-a-blob",
        "only.two",
        "a.b.c.d",
        # A flipped byte in the ciphertext: GCM authenticates, so this must not come back as text.
        "hZH2Jqqzs08HHllO.v7Lsq0-00kxhVVcT4l8EgSSfcJD38yPb2yfItNMyZqU.4jDNBEbsOczjI4RiB-u4_g",
    ],
)
def test_a_value_that_does_not_decrypt_reads_as_unlinked(stored: str) -> None:
    assert github_token.decrypt_token(stored, FIXTURE["serviceRoleKey"]) is None


def test_the_key_matches_the_node_scrypt_parameters() -> None:
    # Node's scryptSync defaults are N=16384, r=8, p=1, and the salt is the purpose string.
    assert github_token.derive_key(FIXTURE["serviceRoleKey"]) == github_token.hashlib.scrypt(
        FIXTURE["serviceRoleKey"].encode("utf-8"),
        salt=b"lantern:github-token",
        n=16384,
        r=8,
        p=1,
        dklen=32,
        maxmem=64 * 1024 * 1024,
    )


def test_project_token_prefers_the_linked_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        github_token.db, "get_project", lambda _id: {"github_token": FIXTURE["stored"]}
    )
    monkeypatch.setattr(
        github_token.config, "supabase_service_role_key", lambda: FIXTURE["serviceRoleKey"]
    )
    assert github_token.project_token("some-project") == FIXTURE["plain"]


def test_project_token_is_none_when_no_account_is_linked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(github_token.db, "get_project", lambda _id: {"github_token": None})
    assert github_token.project_token("some-project") is None


def test_a_failed_lookup_falls_back_to_the_server_credential(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(_id: str) -> dict[str, str]:
        raise RuntimeError("PostgREST is unreachable")

    monkeypatch.setattr(github_token.db, "get_project", explode)
    assert github_token.project_token("some-project") is None

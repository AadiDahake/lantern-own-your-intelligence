"""Environment access in one place so every step reads the same names."""

from __future__ import annotations

import os
from pathlib import Path


class MissingEnv(RuntimeError):
    pass


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise MissingEnv(f"{name} is not set")
    return value


def optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip() or default


def supabase_url() -> str:
    return require("SUPABASE_URL").rstrip("/")


def supabase_service_role_key() -> str:
    return require("SUPABASE_SERVICE_ROLE_KEY")


def github_token() -> str:
    return require("GITHUB_TOKEN")


def openai_api_key() -> str:
    return require("OPENAI_API_KEY")


def vercel_token() -> str:
    return require("VERCEL_TOKEN")


def target_vercel_project() -> str:
    return optional("TARGET_VERCEL_PROJECT", "novaair")


def target_production_url() -> str:
    """Stable address of the target project's production deployments; blank returns each deployment's own url."""
    return optional("TARGET_PRODUCTION_URL").rstrip("/")


def slack_webhook_url() -> str:
    return optional("SLACK_WEBHOOK_URL")


def app_url() -> str:
    """Public origin of the dashboard, so the worker can link back to it from GitHub."""
    return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


def activity_url() -> str:
    return f"{app_url()}/console/activity"


def cache_root() -> Path:
    return Path(optional("LANTERN_CACHE_DIR", str(Path.home() / ".cache" / "lantern")))

"""Environment access in one place so every step reads the same names."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
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


@dataclass(frozen=True)
class SmsSender:
    """What one call to the text message provider needs. The key is never in a `repr`."""

    api_key: str = field(repr=False)
    from_number: str
    api_url: str


def sms_sender() -> tuple[SmsSender | None, str]:
    """The text message provider, Dial: the sender, or None and the reason text messages are off.

    The key (`sk_live_...`) and the sender number travel together, so text messages are off unless
    both are set. The reason names the first variable that is missing, and the trace repeats it.
    `DIAL_FROM_NUMBER` is a number of the account in E.164 form, its id, or its nickname.
    """
    api_key = optional("DIAL_API_KEY")
    from_number = optional("DIAL_FROM_NUMBER")
    if not api_key:
        return None, "DIAL_API_KEY is not set"
    if not from_number:
        return None, "DIAL_FROM_NUMBER is not set"
    api_url = optional("DIAL_API_URL", "https://api.getdial.ai").rstrip("/")
    return SmsSender(api_key=api_key, from_number=from_number, api_url=api_url), ""


def app_url() -> str:
    """Public origin of the dashboard, so the worker can link back to it from GitHub."""
    return optional("NEXT_PUBLIC_APP_URL", "http://localhost:3000").rstrip("/")


def activity_url() -> str:
    return f"{app_url()}/console/activity"


def cache_root() -> Path:
    return Path(optional("LANTERN_CACHE_DIR", str(Path.home() / ".cache" / "lantern")))

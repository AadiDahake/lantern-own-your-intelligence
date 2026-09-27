"""Optional Slack notification when an issue and a draft PR exist."""

from __future__ import annotations

import requests

import config


def notify(text: str) -> bool:
    url = config.slack_webhook_url()
    if not url:
        return False
    try:
        requests.post(url, json={"text": text}, timeout=10)
        return True
    except requests.RequestException:
        return False

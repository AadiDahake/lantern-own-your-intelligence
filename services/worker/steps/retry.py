"""One HTTP call, retried while the failure is about the network rather than about the request.

A dropped connection to Supabase or a 502 from GitHub says nothing about the escalation: the same
call a second later usually works. Before this, one such blip anywhere in a run - a status update,
a comment, the call that records a pull request that had already been opened - failed the whole
escalation and the user was told their request could not be built.

So every call the worker makes to Supabase and GitHub goes through `send`. It retries the failures
that are worth retrying (a connection error, a timeout, and the status codes a server uses to say
"not now") a few times with a widening gap, and returns everything else to the caller untouched:
a 404 or a 422 is an answer, not a blip, and hiding it behind retries would only slow a real
failure down.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import requests

# Four attempts over roughly three and a half seconds. Long enough to ride out a reconnect, short
# enough that a run holding a person's attention does not stall on a service that is really down.
ATTEMPTS = 4
BASE_DELAY_S = 0.5

# What a server says when the answer is "not now": ask again rather than fail the escalation.
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})

TRANSIENT: tuple[type[Exception], ...] = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
)


def send(
    method: str,
    url: str,
    *,
    attempts: int | None = None,
    base_delay_s: float | None = None,
    sleep: Callable[[float], None] = time.sleep,
    **kwargs: Any,
) -> requests.Response:
    """Make the call, retrying only what a retry can fix. Raises the last error if none succeeds.

    The two budgets are read from the module on every call rather than bound as defaults, so a
    test can set them without reaching inside the signature.
    """
    attempts = ATTEMPTS if attempts is None else attempts
    base_delay_s = BASE_DELAY_S if base_delay_s is None else base_delay_s
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.request(method, url, **kwargs)
        except TRANSIENT as error:
            last = error
        else:
            if response.status_code not in RETRYABLE_STATUS:
                return response
            last = None
            if attempt == attempts:
                return response
        if attempt < attempts:
            sleep(base_delay_s * (2 ** (attempt - 1)))
    raise last if last else RuntimeError(f"{method} {url} could not be completed")

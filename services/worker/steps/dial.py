"""The one module in the worker that calls Dial, the text message provider.

Documented at https://docs.getdial.ai (`POST /api/v1/messages`, bearer key). It follows the same
three rules as `apps/web/lib/dial.ts`:

- One attempt. The send call has no idempotency key, so a second attempt can be a second text on
  a person's phone. This is the one call in the worker that does not go through `steps/retry.py`,
  because that module repeats a call. A caller must not repeat it either.
- A phone number never leaves this module except in the request body. A result carries a short
  reason code and never the provider's own words or the text of an exception, because an error
  text can quote the number or the key.
- The body is folded into the basic SMS alphabet before it goes out (`sms_text`), so no caller can
  send a text in the wider encoding by accident.

The call has two parts, and the part a failure comes from decides what it means. A request that
could not be built was not sent. A request that was handed to the connection may have gone,
unless the failure itself says that no connection opened. The response is untrusted input and is
read defensively.
"""

from __future__ import annotations

import json
import re
import ssl
import threading
from dataclasses import dataclass
from typing import Any, Literal

import requests
from urllib3.exceptions import ConnectTimeoutError, LocationValueError

from config import SmsSender
from steps.sms_text import SEND_PATH, is_e164, sms_text

# How long the connection may take to open, how long each read of the answer's first lines may
# take, and how long the whole body may take after them. A text that is not confirmed in this time
# is `unconfirmed`.
TIMEOUT_S = 10

# The provider's answer is a few hundred bytes. A body longer than this is a page from a
# different server, and it is not read to the end.
MAX_ANSWER_BYTES = 64 * 1024

# A code is lower-case letters and underscores. Anything else could be free text, or a phone
# number, and is not used.
_CODE = re.compile(r"[a-z][a-z_]{0,39}")

# A message id is a short token. Anything else is the provider's free text, and is not kept.
_MESSAGE_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


@dataclass(frozen=True)
class SmsResult:
    """How one send ended.

    - `sent`: the provider took the message. `id` is the provider's message id, when it gave one.
    - `refused`: nothing was sent, because the provider said no or the request could not leave.
      `for_all` is true when the cause is not this recipient (the key, the credit, the provider's
      address): the next send fails the same way, so a caller with a list stops there.
    - `unconfirmed`: no answer, a server error, or an answer that is not the provider's. The text
      may or may not have gone, so nobody sends it again.
    """

    state: Literal["sent", "refused", "unconfirmed"]
    reason: str = ""
    for_all: bool = False
    id: str | None = None


def _reason_for(status: int, body: Any) -> str:
    """The provider's error code when it gave one (`insufficient_credit`), else the status."""
    candidates: list[Any] = []
    if isinstance(body, dict):
        error = body.get("error")
        candidates = [body.get("code"), error.get("code") if isinstance(error, dict) else None]
    for code in candidates:
        if isinstance(code, str) and _CODE.fullmatch(code):
            return code
    return f"http_{status}"


def _led_to_by(error: BaseException, kind: type[BaseException]) -> bool:
    """True when an error of `kind` is what `error` wraps, at any depth.

    `requests` wraps what `urllib3` raised, and `urllib3` wraps what the socket raised. Only what
    an error names as its cause, its reason or its argument is followed, never the error that
    happened to be in flight when it was raised.
    """
    todo: list[Any] = [error]
    seen = 0
    while todo and seen < 24:
        item = todo.pop()
        if not isinstance(item, BaseException):
            continue
        seen += 1
        if isinstance(item, kind):
            return True
        todo.extend([item.__cause__, getattr(item, "reason", None), *item.args])
    return False


def _failure(error: Exception) -> tuple[str, bool]:
    """Why a request that was handed to the connection got no answer.

    Returns a short code, and whether the request can have left. A few failures say by themselves
    that it did not: no connection opened in time, no connection opened at all (refused, or no
    such host, for the provider or for a proxy in front of it), the server's certificate was not
    trusted (the request is written only after that check), and an address or a proxy setting
    that no connection could be made for. Every other failure can come after the provider read
    the request. That includes an answer with headers that cannot be read, and it includes a
    failure that neither library names.
    """
    # urllib3 raises this error, and the two that extend it (refused, no such host), only while it
    # opens a socket.
    if isinstance(error, requests.exceptions.ConnectTimeout) or _led_to_by(error, ConnectTimeoutError):
        return "unreachable", False
    if _led_to_by(error, ssl.SSLCertVerificationError):
        return "untrusted_certificate", False
    # A host name that cannot be one, and a proxy address that cannot be used.
    if isinstance(error, (requests.exceptions.InvalidURL, LocationValueError)):
        return "bad_api_url", False
    if isinstance(error, requests.exceptions.InvalidSchema):
        return "bad_proxy", False
    if isinstance(error, requests.exceptions.Timeout):
        return "timeout", True
    if isinstance(error, requests.RequestException):
        return "network", True
    return "send_failed", True


def _read_answer(response: requests.Response, limit_s: float) -> Any:
    """The JSON of the answer, or None when it is not JSON, is too long or does not come in time.

    The limit is held by a second thread that shuts the read side of the socket. A test between
    two reads is not enough: one read can stay inside the library for as long as the server sends
    chunk sizes, trailers or empty compressed blocks.
    """
    late = threading.Event()

    def give_up() -> None:
        late.set()
        try:
            response.raw.shutdown()
        except Exception:  # noqa: BLE001 - an answer that is already closed has nothing to end
            pass

    watchdog = threading.Timer(limit_s, give_up)
    watchdog.daemon = True
    watchdog.start()
    body = bytearray()
    try:
        while True:
            chunk = response.raw.read1(8192, decode_content=True)
            if not chunk:
                break
            body += chunk
            if len(body) > MAX_ANSWER_BYTES:
                return None
        # What came before the limit is not the whole answer, even when it can be parsed.
        return None if late.is_set() else json.loads(bytes(body))
    except Exception:  # noqa: BLE001 - a body that cannot be read is not the provider's answer
        return None
    finally:
        watchdog.cancel()


def send_sms(sender: SmsSender, to: str, body: str, timeout_s: float = TIMEOUT_S) -> SmsResult:
    """Sends one text. Never raises and never repeats the call."""
    if not is_e164(to):
        return SmsResult("refused", "invalid_number")
    text = sms_text(body)
    if not text:
        return SmsResult("refused", "empty_body")

    with requests.Session() as session:
        # Part one: build the request. No connection is open yet, so a failure here is "nothing
        # was sent", and it is not about this recipient.
        try:
            authorization = f"Bearer {sender.api_key}"
            # A header goes on the wire as Latin-1, and the connection finds out too late.
            authorization.encode("latin-1")
            request = session.prepare_request(
                requests.Request(
                    "POST",
                    f"{sender.api_url}{SEND_PATH}",
                    headers={"Authorization": authorization},
                    # No `channel`: the number's own default applies, so a standard number sends an SMS.
                    json={"to": to, "fromNumber": sender.from_number, "body": text},
                )
            )
            adapter = session.get_adapter(str(request.url))
            # The proxy and the certificates of the environment, as for every other call here.
            settings = session.merge_environment_settings(request.url, {}, True, None, None)
        except (requests.exceptions.InvalidHeader, UnicodeError):
            return SmsResult("refused", "bad_api_key", for_all=True)
        except Exception:  # noqa: BLE001 - no scheme, an unknown scheme, no host
            return SmsResult("refused", "bad_api_url", for_all=True)

        # Part two: hand it to the connection, one time. The adapter is called directly: it does
        # not follow a redirect, and it does not read where a redirect points. A redirect would
        # repeat the request as a GET, and the page it lands on can answer 200.
        try:
            response = adapter.send(request, timeout=timeout_s, **settings)
        except Exception as error:  # noqa: BLE001 - each failure of the call is a result
            reason, left = _failure(error)
            if left:
                return SmsResult("unconfirmed", reason)
            return SmsResult("refused", reason, for_all=True)

        with response:
            status = response.status_code
            answer = _read_answer(response, timeout_s)

    if 200 <= status < 300:
        # Only the provider's own answer counts as sent. A 200 from a different server (a wrong
        # base address, a proxy's page) must not erase a person's number as if the text had gone.
        message = answer.get("message") if isinstance(answer, dict) else None
        if not isinstance(message, dict):
            return SmsResult("unconfirmed", "unreadable_answer")
        message_id = message.get("id")
        kept = isinstance(message_id, str) and _MESSAGE_ID.fullmatch(message_id) is not None
        return SmsResult("sent", id=message_id if kept else None)
    reason = _reason_for(status, answer)
    # Three kinds of status say nothing about whether the message was queued: a 5xx, a status
    # under 200 (an interim answer that the library took for the last one, so the provider has
    # the request), and a 303, which says "done, see there".
    if status >= 500 or status < 200 or status == 303:
        return SmsResult("unconfirmed", reason)
    # Every 4xx and every other redirect are "nothing was sent". A redirect, the key and the
    # credit are not about this recipient.
    return SmsResult("refused", reason, for_all=status < 400 or status in (401, 402))

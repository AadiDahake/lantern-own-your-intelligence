"""The worker's text message client: one attempt, three results, and nothing of the person in them.

The provider is mocked with `responses`, so each test here is about how an answer is read. What a
real connection raises when it fails is in `test_dial_connection.py`. The read-only question that
the sweep asks (`provider_answers`) is at the end.
"""

from __future__ import annotations

import gzip
import json
from typing import Any

import pytest
import requests
import responses
from urllib3.exceptions import LocationParseError

from config import SmsSender
from steps import dial
from steps.dial import SmsResult

SEND = "https://api.getdial.ai/api/v1/messages"
SENDER = SmsSender(api_key="test-dial-key", from_number="+14155550100", api_url="https://api.getdial.ai")
ANA = "+14155550101"


def _send(body: str = "Your change is drafted.", to: str = ANA) -> SmsResult:
    return dial.send_sms(SENDER, to, body)


@responses.activate
def test_posts_one_message_with_the_key_the_sender_number_and_the_body() -> None:
    responses.post(SEND, status=201, json={"message": {"id": "msg_1", "status": "sent"}})

    assert _send() == SmsResult("sent", id="msg_1")

    assert len(responses.calls) == 1
    request = responses.calls[0].request
    assert request.headers["Authorization"] == "Bearer test-dial-key"
    assert request.headers["Content-Type"] == "application/json"
    # No `channel`: the number's own default applies.
    assert json.loads(request.body) == {"to": ANA, "fromNumber": "+14155550100", "body": "Your change is drafted."}


@responses.activate
def test_folds_the_body_so_the_provider_never_switches_to_the_wide_encoding() -> None:
    responses.post(SEND, status=201, json={"message": {"id": "msg_1"}})

    _send("Your \u201cseat\u201d change \u2014 drafted \U0001f680")

    assert json.loads(responses.calls[0].request.body)["body"] == 'Your "seat" change - drafted'


@responses.activate
def test_a_message_with_no_id_is_sent_because_the_provider_took_it() -> None:
    responses.post(SEND, status=200, json={"message": {"status": "unknown"}})
    assert _send() == SmsResult("sent", id=None)


@pytest.mark.parametrize("message_id", ["msg_1", "a-b_C9", "0" * 64])
@responses.activate
def test_a_message_id_that_is_a_short_token_is_kept(message_id: str) -> None:
    responses.post(SEND, status=201, json={"message": {"id": message_id}})
    assert _send() == SmsResult("sent", id=message_id)


@pytest.mark.parametrize("message_id", [f"sent to {ANA}", ANA, "test-dial-key leaked", "0" * 65, "", "a b", 7, None, ["msg_1"]])
@responses.activate
def test_a_message_id_that_is_free_text_is_not_kept_and_the_text_is_still_sent(message_id: Any) -> None:
    responses.post(SEND, status=201, json={"message": {"id": message_id}})
    result = _send()
    assert result == SmsResult("sent", id=None)
    assert "4155550101" not in repr(result)


@pytest.mark.parametrize(
    "answer",
    [
        {"body": "<html>Welcome</html>", "content_type": "text/html"},
        {"json": {"ok": True}},
        {"json": {"message": "queued"}},
        {"json": [{"message": {"id": "msg_1"}}]},
        {"body": ""},
    ],
)
@responses.activate
def test_a_2xx_that_is_not_the_providers_answer_is_not_counted_as_sent(answer: dict[str, Any]) -> None:
    """A wrong base address that lands on a page must not erase a number as if the text had gone."""
    responses.post(SEND, status=200, **answer)
    assert _send() == SmsResult("unconfirmed", "unreadable_answer")
    assert len(responses.calls) == 1


@pytest.mark.parametrize(
    ("status", "answer", "reason", "for_all"),
    [
        (400, {"error": {"fieldErrors": {"to": ["Invalid"]}}}, "http_400", False),
        (403, {"error": "Forbidden"}, "http_403", False),
        (404, {"error": "Not found"}, "http_404", False),
        (413, {"error": "Too large"}, "http_413", False),
        (429, {"error": "The recipient is rate-limited.", "code": "rate_limited"}, "rate_limited", False),
        (400, {"error": {"code": "unsupported_region", "message": "No"}}, "unsupported_region", False),
        # The key and the credit are not about this person: the next send fails the same way.
        (401, {"error": "Missing or invalid API key."}, "http_401", True),
        (402, {"error": "Insufficient Dial credit.", "code": "insufficient_credit"}, "insufficient_credit", True),
    ],
)
@responses.activate
def test_a_4xx_is_refused_and_nothing_was_sent(status: int, answer: Any, reason: str, for_all: bool) -> None:
    responses.post(SEND, status=status, json=answer)
    assert _send() == SmsResult("refused", reason, for_all=for_all)
    assert len(responses.calls) == 1


@pytest.mark.parametrize("status", [500, 502, 503, 504])
@responses.activate
def test_a_5xx_is_unconfirmed_and_is_not_tried_again(status: int) -> None:
    """A 5xx says nothing about whether the message was queued, and a retry can be a second text."""
    responses.post(SEND, status=status, json={"error": "upstream"})
    assert _send() == SmsResult("unconfirmed", f"http_{status}")
    assert len(responses.calls) == 1


@pytest.mark.parametrize("status", [101, 102, 103, 199])
@responses.activate
def test_an_interim_status_is_unconfirmed_because_the_provider_has_the_request(status: int) -> None:
    """The library skips a 100 only. Any other 1xx comes back as if it were the last answer."""
    responses.post(SEND, status=status)
    assert _send() == SmsResult("unconfirmed", f"http_{status}")
    assert len(responses.calls) == 1


@responses.activate
def test_a_303_says_done_see_there_so_it_is_unconfirmed_and_not_followed() -> None:
    responses.post(SEND, status=303, headers={"Location": "https://elsewhere.example/landing"})
    landing = responses.add(responses.GET, "https://elsewhere.example/landing", json={"message": {"id": "x"}})

    assert _send() == SmsResult("unconfirmed", "http_303")
    assert len(responses.calls) == 1 and landing.call_count == 0


@pytest.mark.parametrize("status", [301, 302, 307, 308])
@responses.activate
def test_a_redirect_is_refused_for_everyone_and_is_never_followed(status: int) -> None:
    responses.post(SEND, status=status, headers={"Location": "https://elsewhere.example/landing"})
    landing = responses.add(responses.GET, "https://elsewhere.example/landing", body="<html>Welcome</html>")
    relanding = responses.add(responses.POST, "https://elsewhere.example/landing", json={"message": {"id": "x"}})

    assert _send() == SmsResult("refused", f"http_{status}", for_all=True)
    assert len(responses.calls) == 1
    assert landing.call_count == 0 and relanding.call_count == 0


@pytest.mark.parametrize(
    ("to", "body", "reason"),
    [
        ("4155550101", "hello", "invalid_number"),
        ("+1 415 555 0101", "hello", "invalid_number"),
        (f"{ANA}\n", "hello", "invalid_number"),
        ("", "hello", "invalid_number"),
        (ANA, "", "empty_body"),
        (ANA, " \n\t ", "empty_body"),
        (ANA, "\u5ea7\u5e2d\u3092\u9078\u3076", "empty_body"),
    ],
)
@responses.activate
def test_the_provider_is_not_called_for_a_bad_number_or_an_empty_body(to: str, body: str, reason: str) -> None:
    assert dial.send_sms(SENDER, to, body) == SmsResult("refused", reason)
    assert len(responses.calls) == 0


@pytest.mark.parametrize(
    ("raised", "expected"),
    [
        (requests.exceptions.ReadTimeout("read timed out"), SmsResult("unconfirmed", "timeout")),
        (requests.exceptions.ConnectionError("Connection aborted."), SmsResult("unconfirmed", "network")),
        (requests.exceptions.ChunkedEncodingError("broken body"), SmsResult("unconfirmed", "network")),
        (requests.exceptions.SSLError("bad record"), SmsResult("unconfirmed", "network")),
        (requests.exceptions.ProxyError("Unable to connect to proxy"), SmsResult("unconfirmed", "network")),
        # The library also raises this one for an answer whose headers it cannot read. The
        # provider took that request, so it is never "nothing was sent".
        (requests.exceptions.InvalidHeader("Content-Length contained multiple unmatching values"), SmsResult("unconfirmed", "network")),
        # Not a failure the libraries name. It came after the request was handed over.
        (ValueError(f"something broke while {ANA} was sent"), SmsResult("unconfirmed", "send_failed")),
        # The connection did not open, so nothing was sent and the text is still owed.
        (requests.exceptions.ConnectTimeout("connect timed out"), SmsResult("refused", "unreachable", for_all=True)),
        # No connection can be made for these: a host name that cannot be one, a proxy that
        # needs a library the worker does not have.
        (LocationParseError("api..getdial.ai, label empty or too long"), SmsResult("refused", "bad_api_url", for_all=True)),
        (requests.exceptions.InvalidSchema("Missing dependencies for SOCKS support."), SmsResult("refused", "bad_proxy", for_all=True)),
    ],
)
@responses.activate
def test_a_call_with_no_answer_is_made_one_time(raised: Exception, expected: SmsResult) -> None:
    responses.post(SEND, body=raised)
    assert _send() == expected
    assert len(responses.calls) == 1


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (201, SmsResult("unconfirmed", "unreadable_answer")),
        (400, SmsResult("refused", "http_400")),
        (401, SmsResult("refused", "http_401", for_all=True)),
        (503, SmsResult("unconfirmed", "http_503")),
    ],
)
@pytest.mark.parametrize(
    "broken",
    [
        {"body": b"\x1f\x8b this is not gzip", "headers": {"Content-Encoding": "gzip"}},
        {"body": b'{"message": {"id": "msg_1"}, "padding": "' + b"x" * dial.MAX_ANSWER_BYTES + b'"}'},
        {"body": b"\xff\xfe not text"},
    ],
)
@responses.activate
def test_an_answer_with_a_body_that_cannot_be_read_is_judged_by_its_status(
    status: int, expected: SmsResult, broken: dict[str, Any]
) -> None:
    """The status came from the provider. A body that is broken or too long does not change it."""
    responses.post(SEND, status=status, **broken)
    assert _send() == expected
    assert len(responses.calls) == 1


@responses.activate
def test_a_compressed_answer_is_read() -> None:
    answer = gzip.compress(json.dumps({"message": {"id": "msg_zipped"}}).encode())
    responses.post(SEND, status=201, body=answer, headers={"Content-Encoding": "gzip"})
    assert _send() == SmsResult("sent", id="msg_zipped")


@responses.activate
def test_the_result_never_carries_the_number_the_key_or_the_providers_words() -> None:
    responses.post(SEND, status=400, json={"error": f"Cannot text {ANA}", "code": f"blocked {ANA}"})
    responses.post(SEND, status=429, json={"error": {"code": "+14155550101", "message": ANA}})
    responses.post(SEND, status=400, json={"code": "Has Capitals And Spaces"})
    responses.post(SEND, status=400, json={"code": "a" * 41})
    responses.post(SEND, status=400, json={"code": 12})
    responses.post(SEND, status=503, body=f"upstream failed for {ANA}")
    responses.post(SEND, body=requests.exceptions.ConnectionError(f"reset while sending to {ANA} with test-dial-key"))

    results = [_send() for _ in range(7)]

    assert [result.reason for result in results] == [
        "http_400", "http_429", "http_400", "http_400", "http_400", "http_503", "network",
    ]
    for result in results:
        assert ANA not in repr(result) and "4155550101" not in repr(result)
        assert "test-dial-key" not in repr(result)
        assert "Cannot" not in repr(result) and "upstream" not in repr(result)


def test_the_key_is_not_in_the_repr_of_the_sender() -> None:
    assert "test-dial-key" not in repr(SENDER)
    assert "test-dial-key" not in str(SENDER)


# From here: the read-only question that the sweep asks before it claims a person.

NUMBERS = "https://api.getdial.ai/api/v1/numbers"


@responses.activate
def test_the_question_is_one_get_with_the_key_and_no_body() -> None:
    responses.get(NUMBERS, json={"numbers": [{"id": "num_1", "number": "+14155550100", "capabilities": ["sms"]}]})

    assert dial.provider_answers(SENDER) == (True, "")

    assert len(responses.calls) == 1
    request = responses.calls[0].request
    assert request.method == "GET"
    assert request.url == NUMBERS
    assert request.headers["Authorization"] == "Bearer test-dial-key"
    assert request.body is None
    assert "Content-Type" not in request.headers


@responses.activate
def test_an_account_with_no_numbers_is_still_the_provider_that_answers() -> None:
    responses.get(NUMBERS, json={"numbers": []})
    assert dial.provider_answers(SENDER) == (True, "")


@responses.activate
def test_a_list_of_numbers_that_is_longer_than_the_answer_to_a_send_is_still_an_answer() -> None:
    """The list has a few hundred bytes for each number, so the question has a limit of its own."""
    numbers = [{"id": f"num_{index}", "number": f"+1415555{index:04d}", "nickname": "x" * 200} for index in range(600)]
    body = json.dumps({"numbers": numbers}).encode()
    assert dial.MAX_ANSWER_BYTES < len(body) < dial.MAX_NUMBERS_BYTES
    responses.get(NUMBERS, status=200, body=body, content_type="application/json")
    assert dial.provider_answers(SENDER) == (True, "")


@pytest.mark.parametrize(
    ("status", "answer", "reason"),
    [
        (401, {"error": "Missing or invalid API key."}, "http_401"),
        (402, {"error": "Insufficient Dial credit.", "code": "insufficient_credit"}, "insufficient_credit"),
        (403, {"error": "Forbidden"}, "http_403"),
        (404, {"error": "Not found"}, "http_404"),
        (429, {"error": {"code": "rate_limited", "message": "Slow down"}}, "rate_limited"),
        (500, {"error": "upstream"}, "http_500"),
        (503, {"error": "upstream"}, "http_503"),
        # A status that is not 2xx is "no", whatever the body holds.
        (500, {"numbers": []}, "http_500"),
    ],
)
@responses.activate
def test_a_status_that_is_not_2xx_is_no_answer_and_the_question_is_not_asked_again(
    status: int, answer: Any, reason: str
) -> None:
    responses.get(NUMBERS, status=status, json=answer)
    assert dial.provider_answers(SENDER) == (False, reason)
    assert len(responses.calls) == 1


@pytest.mark.parametrize(
    "answer",
    [
        {"body": "<html>Welcome</html>", "content_type": "text/html"},
        {"json": {"ok": True}},
        {"json": {"numbers": "none"}},
        {"json": {"numbers": {"id": "num_1"}}},
        {"json": [{"id": "num_1"}]},
        {"body": ""},
        {"body": b"\x1f\x8b this is not gzip", "headers": {"Content-Encoding": "gzip"}},
        {"body": b'{"numbers": [], "padding": "' + b"x" * dial.MAX_NUMBERS_BYTES + b'"}'},
    ],
)
@responses.activate
def test_a_2xx_that_is_not_the_providers_answer_is_no_answer(answer: dict[str, Any]) -> None:
    """A wrong base address that lands on a page is not a provider that takes a text."""
    responses.get(NUMBERS, status=200, **answer)
    assert dial.provider_answers(SENDER) == (False, "unreadable_answer")
    assert len(responses.calls) == 1


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
@responses.activate
def test_a_redirect_of_the_question_is_no_answer_and_is_never_followed(status: int) -> None:
    responses.get(NUMBERS, status=status, headers={"Location": "https://elsewhere.example/landing"})
    landing = responses.get("https://elsewhere.example/landing", json={"numbers": []})

    assert dial.provider_answers(SENDER) == (False, f"http_{status}")
    assert len(responses.calls) == 1 and landing.call_count == 0


@pytest.mark.parametrize(
    ("raised", "reason"),
    [
        (requests.exceptions.ReadTimeout("read timed out"), "timeout"),
        (requests.exceptions.ConnectTimeout("connect timed out"), "unreachable"),
        (requests.exceptions.ConnectionError("Connection aborted."), "network"),
        (requests.exceptions.SSLError("bad record"), "network"),
        (LocationParseError("api..getdial.ai, label empty or too long"), "bad_api_url"),
        (requests.exceptions.InvalidSchema("Missing dependencies for SOCKS support."), "bad_proxy"),
        # Not a failure the libraries name, and no text was sent, so it is not `send_failed`.
        (ValueError(f"something broke with test-dial-key near {ANA}"), "check_failed"),
    ],
)
@responses.activate
def test_a_question_with_no_answer_is_asked_one_time_and_does_not_raise(raised: Exception, reason: str) -> None:
    responses.get(NUMBERS, body=raised)
    assert dial.provider_answers(SENDER) == (False, reason)
    assert len(responses.calls) == 1


@pytest.mark.parametrize("api_url", ["api.getdial.ai", "ftp://api.getdial.ai", "http://", "://nothing"])
@responses.activate
def test_a_base_address_that_is_not_a_url_is_no_answer(api_url: str) -> None:
    sender = SmsSender(api_key="test-dial-key", from_number="+14155550100", api_url=api_url)
    assert dial.provider_answers(sender) == (False, "bad_api_url")
    assert len(responses.calls) == 0


@pytest.mark.parametrize("api_key", ["test-dial\nkey", "test-dial-key\u200b"])
@responses.activate
def test_a_key_that_cannot_be_a_header_is_no_answer_and_nothing_is_asked(api_key: str) -> None:
    responses.get(NUMBERS, json={"numbers": []})
    sender = SmsSender(api_key=api_key, from_number="+14155550100", api_url="https://api.getdial.ai")
    assert dial.provider_answers(sender) == (False, "bad_api_key")
    assert len(responses.calls) == 0


@responses.activate
def test_the_reason_of_the_question_never_carries_a_number_the_key_or_the_providers_words() -> None:
    responses.get(NUMBERS, status=400, json={"error": f"No such number {ANA}", "code": f"blocked {ANA}"})
    responses.get(NUMBERS, status=429, json={"error": {"code": "+14155550101", "message": ANA}})
    responses.get(NUMBERS, status=400, json={"code": "Has Capitals And Spaces"})
    responses.get(NUMBERS, status=503, body=f"upstream failed for {ANA}")
    responses.get(NUMBERS, status=200, json={"numbers": f"none for {ANA}"})
    responses.get(NUMBERS, body=requests.exceptions.ConnectionError(f"reset for {ANA} with test-dial-key"))

    answers = [dial.provider_answers(SENDER) for _ in range(6)]

    assert answers == [
        (False, "http_400"),
        (False, "http_429"),
        (False, "http_400"),
        (False, "http_503"),
        (False, "unreadable_answer"),
        (False, "network"),
    ]
    for _ok, reason in answers:
        assert "4155550101" not in reason and "test-dial-key" not in reason
        assert "No such" not in reason and "upstream" not in reason

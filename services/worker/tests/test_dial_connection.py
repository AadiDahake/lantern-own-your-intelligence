"""What a failed connection to the text message provider means for the person.

What `requests` raises for a closed port, a dropped connection or a bad certificate decides if a
person keeps their text or can get a second one, and a hand-made exception can drift from the
real one. So these cases run on a real connection, against a server on the loopback interface.
Nothing leaves the machine.

The rule each test holds: `refused` only when nothing can have been sent, because a refused text
is sent again later.

The read-only question that the sweep asks (`provider_answers`) is at the end. Its rule: "yes"
only for the provider's own answer, because a "yes" is followed by a claim and a text.
"""

from __future__ import annotations

import json
import socket
import ssl
import threading
import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from config import SmsSender
from steps import dial
from steps.dial import SmsResult

ANA = "+14155550101"

# The first bytes of a gzip stream, and one block of it that holds nothing and is not the last.
# A stream of such blocks is valid for ever and never gives the reader a byte.
GZIP_START = bytes.fromhex("1f8b0800000000000003")
EMPTY_BLOCK = bytes.fromhex("000000ffff")

# What the provider answers to the read-only question: the numbers of the account.
NUMBERS = b'{"numbers": [{"id": "num_local", "number": "+14155550100", "capabilities": ["sms"]}]}'


class _Provider(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.mode = "ok"
        self.seen: list[tuple[str, str, str]] = []

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"

    def handle_error(self, request: Any, client_address: Any) -> None:
        # A client that hangs up early is the subject of some tests, not a fault to print.
        return


class _Handler(BaseHTTPRequestHandler):
    server: _Provider

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - the base class's name
        return

    def _answer(self, status: int, body: bytes, content_type: str = "application/json", **headers: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - the base class's name
        self.server.seen.append(("GET", self.path, ""))
        mode = self.server.mode
        if self.path != "/api/v1/numbers":
            # The page that a redirect points to. A client must not come here.
            self._answer(200, b"<html>Welcome</html>", "text/html")
        elif mode == "redirect":
            self._answer(302, b"", Location="/landing")
        elif mode == "drop":
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
        elif mode == "hang":
            time.sleep(1.0)
            self._answer(200, NUMBERS)
        else:
            self._answer(200, NUMBERS)

    def do_POST(self) -> None:  # noqa: N802 - the base class's name
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode("utf-8")
        self.server.seen.append(("POST", self.path, raw))
        taken = b'{"message": {"id": "msg_local", "status": "sent"}}'
        mode = self.server.mode
        if mode == "redirect":
            self._answer(302, b"", Location="/landing")
        elif mode == "redirect to nowhere":
            # An address that cannot be parsed. The client must not read it at all.
            self._answer(302, b"", Location="http://[not-an-address")
        elif mode == "drop":
            # The provider read the request and the connection broke before an answer.
            self.close_connection = True
            self.connection.shutdown(socket.SHUT_RDWR)
        elif mode == "hang":
            time.sleep(1.0)
            self._answer(201, taken)
        elif mode == "two lengths":
            # The provider took the message, and a faulty hop in front of it broke the headers.
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(taken)))
            self.send_header("Content-Length", str(len(taken) + 1))
            self.end_headers()
            self.wfile.write(taken)
        elif mode == "drip":
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(taken)))
            self.end_headers()
            for index in range(len(taken)):
                self.wfile.write(taken[index : index + 1])
                self.wfile.flush()
                time.sleep(0.05)
        elif mode == "long page":
            self._answer(200, b"<p>Welcome</p>" * 20_000, "text/html")
        elif mode == "interim":
            # "I am on it", then the real answer. The provider has the request in both.
            self.wfile.write(b"HTTP/1.1 102 Processing\r\n\r\n")
            self.wfile.flush()
            self._answer(201, taken)
        elif mode == "see other":
            self._answer(303, b"", Location="/landing")
        elif mode == "late first lines":
            # Each read is in time, and the whole answer is there before the body's own limit.
            self.wfile.write(b"HTTP/1.1 201 Created\r\n")
            self.wfile.flush()
            time.sleep(0.35)
            self.wfile.write(b"Content-Type: application/json\r\nContent-Length: %d\r\n\r\n" % len(taken) + taken)
        elif mode in ("slow chunk size", "endless trailers", "empty compressed blocks"):
            self._never_ends(mode, taken)
        else:
            self._answer(201, taken)

    def _never_ends(self, mode: str, taken: bytes) -> None:
        """Three bodies that keep one read inside the library. Each one stops after 3 seconds."""
        self.send_response(201)
        self.send_header("Content-Type", "application/json")
        self.send_header("Transfer-Encoding", "chunked")
        if mode == "empty compressed blocks":
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        if mode == "endless trailers":
            self.wfile.write(b"%x\r\n" % len(taken) + taken + b"\r\n0\r\n")
        elif mode == "empty compressed blocks":
            self.wfile.write(b"%x\r\n" % len(GZIP_START) + GZIP_START + b"\r\n")
        until = time.monotonic() + 3.0
        while time.monotonic() < until:
            if mode == "slow chunk size":
                piece = b"0"
            elif mode == "endless trailers":
                piece = b"X-Still-Here: 1\r\n"
            else:
                piece = b"%x\r\n" % len(EMPTY_BLOCK) + EMPTY_BLOCK + b"\r\n"
            self.wfile.write(piece)
            self.wfile.flush()
            time.sleep(0.02)


def _serve(server: ThreadingHTTPServer) -> Iterator[Any]:
    # A short poll, so the shutdown at the end of each test does not wait half a second.
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()


@pytest.fixture
def provider() -> Iterator[_Provider]:
    yield from _serve(_Provider())


@pytest.fixture(autouse=True)
def no_proxy_from_the_shell(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"):
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name.lower(), raising=False)


def _closed_port() -> int:
    """A loopback port that nothing listens on."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _sender(api_url: str, api_key: str = "test-dial-key") -> SmsSender:
    return SmsSender(api_key=api_key, from_number="+14155550100", api_url=api_url)


def _requests(provider: _Provider) -> list[tuple[str, str]]:
    return [(method, path) for method, path, _raw in provider.seen]


def test_a_real_send_is_one_request_and_reads_the_message_id(provider: _Provider) -> None:
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("sent", id="msg_local")
    assert _requests(provider) == [("POST", "/api/v1/messages")]
    assert json.loads(provider.seen[0][2]) == {"to": ANA, "fromNumber": "+14155550100", "body": "hello"}


@pytest.mark.parametrize("mode", ["redirect", "redirect to nowhere"])
def test_a_real_redirect_is_refused_and_is_not_followed(provider: _Provider, mode: str) -> None:
    provider.mode = mode
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("refused", "http_302", for_all=True)
    assert _requests(provider) == [("POST", "/api/v1/messages")]


def test_a_connection_that_breaks_after_the_request_is_unconfirmed(provider: _Provider) -> None:
    provider.mode = "drop"
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("unconfirmed", "network")
    # One request reached the provider, and the client did not send it a second time.
    assert len(provider.seen) == 1


def test_an_answer_that_does_not_start_in_time_is_unconfirmed(provider: _Provider) -> None:
    provider.mode = "hang"
    assert dial.send_sms(_sender(provider.url), ANA, "hello", timeout_s=0.2) == SmsResult("unconfirmed", "timeout")
    assert len(provider.seen) == 1


def test_an_answer_with_headers_that_cannot_be_read_is_never_refused(provider: _Provider) -> None:
    """The provider took the message. Refused would give the claim back, and a second text."""
    provider.mode = "two lengths"

    result = dial.send_sms(_sender(provider.url), ANA, "hello")

    assert result == SmsResult("unconfirmed", "network")
    assert len(provider.seen) == 1


def test_an_answer_that_comes_one_byte_at_a_time_does_not_hold_the_run(provider: _Provider) -> None:
    provider.mode = "drip"
    started = time.monotonic()

    result = dial.send_sms(_sender(provider.url), ANA, "hello", timeout_s=0.3)

    # The whole answer would take 2.5 seconds. It is given up at the limit, and it is not "sent".
    assert result == SmsResult("unconfirmed", "unreadable_answer")
    assert time.monotonic() - started < 1.5


@pytest.mark.parametrize("mode", ["slow chunk size", "endless trailers", "empty compressed blocks"])
def test_a_body_that_never_ends_inside_one_read_does_not_hold_the_run(provider: _Provider, mode: str) -> None:
    """A test between two reads does not see these. The limit must end the read itself."""
    provider.mode = mode
    started = time.monotonic()

    result = dial.send_sms(_sender(provider.url), ANA, "hello", timeout_s=0.3)

    assert result == SmsResult("unconfirmed", "unreadable_answer")
    assert time.monotonic() - started < 1.5


def test_a_whole_answer_whose_first_lines_are_slow_is_still_sent(provider: _Provider) -> None:
    """The body has its own limit. A complete answer is not thrown away for a slow start."""
    provider.mode = "late first lines"
    result = dial.send_sms(_sender(provider.url), ANA, "hello", timeout_s=0.5)
    assert result == SmsResult("sent", id="msg_local")


def test_an_interim_answer_is_never_refused(provider: _Provider) -> None:
    """The provider has the request. Refused would give the claim back, and a second text."""
    provider.mode = "interim"
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("unconfirmed", "http_102")
    assert len(provider.seen) == 1


def test_a_real_303_is_unconfirmed_and_is_not_followed(provider: _Provider) -> None:
    provider.mode = "see other"
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("unconfirmed", "http_303")
    assert _requests(provider) == [("POST", "/api/v1/messages")]


def test_a_long_page_is_not_read_to_the_end_and_is_not_sent(provider: _Provider) -> None:
    provider.mode = "long page"
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("unconfirmed", "unreadable_answer")


def test_a_closed_port_is_refused_for_everyone_because_nothing_was_sent() -> None:
    sender = _sender(f"http://127.0.0.1:{_closed_port()}")
    assert dial.send_sms(sender, ANA, "hello") == SmsResult("refused", "unreachable", for_all=True)


@pytest.mark.parametrize("api_url", ["api.getdial.ai", "ftp://api.getdial.ai", "http://", "://nothing"])
def test_a_base_address_that_is_not_a_url_is_refused_for_everyone(api_url: str) -> None:
    assert dial.send_sms(_sender(api_url), ANA, "hello") == SmsResult("refused", "bad_api_url", for_all=True)


@pytest.mark.parametrize("api_key", ["test-dial\nkey", "test-dial-key\u200b", "cl\u00e9 \u2014 \u5ea7"])
def test_a_key_that_cannot_be_a_header_is_refused_and_nothing_is_sent(provider: _Provider, api_key: str) -> None:
    """A pasted key can carry a line break or a character that no header can hold."""
    result = dial.send_sms(_sender(provider.url, api_key), ANA, "hello")
    assert result == SmsResult("refused", "bad_api_key", for_all=True)
    assert provider.seen == []


def test_a_host_name_that_cannot_be_one_is_refused_before_any_connection() -> None:
    sender = _sender("http://api..getdial.invalid")
    assert dial.send_sms(sender, ANA, "hello") == SmsResult("refused", "bad_api_url", for_all=True)


def test_a_proxy_that_the_worker_cannot_speak_to_is_refused_and_nothing_is_sent(
    provider: _Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ALL_PROXY", f"socks5://127.0.0.1:{_closed_port()}")

    result = dial.send_sms(_sender(provider.url), ANA, "hello")

    # Without the SOCKS library no connection is tried. With it, the closed port refuses.
    assert result in (
        SmsResult("refused", "bad_proxy", for_all=True),
        SmsResult("refused", "unreachable", for_all=True),
    )
    assert provider.seen == []


def test_a_proxy_that_is_down_is_refused_because_nothing_reached_it(
    provider: _Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HTTP_PROXY", f"http://127.0.0.1:{_closed_port()}")
    assert dial.send_sms(_sender(provider.url), ANA, "hello") == SmsResult("refused", "unreachable", for_all=True)
    assert provider.seen == []


def test_a_proxy_that_takes_the_request_and_drops_it_is_unconfirmed(
    provider: _Provider, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The library can name this failure "unable to connect to proxy" although the request left."""
    provider.mode = "drop"
    # The same server stands in for the proxy: it reads the request, then breaks the connection.
    monkeypatch.setenv("HTTP_PROXY", provider.url)

    result = dial.send_sms(_sender("http://dial.invalid"), ANA, "hello")

    assert result == SmsResult("unconfirmed", "network")
    assert [method for method, _path, _raw in provider.seen] == ["POST"]


def _self_signed(folder: Path) -> tuple[Path, Path]:
    """A certificate for 127.0.0.1 that no client trusts, made for one test and then gone."""
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "127.0.0.1")])
    now = datetime.now(timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(hours=1))
        .sign(key, hashes.SHA256())
    )
    key_file, certificate_file = folder / "key.pem", folder / "certificate.pem"
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    return key_file, certificate_file


def test_a_certificate_that_is_not_trusted_is_refused_because_no_request_was_written(tmp_path: Path) -> None:
    """A company network that inspects TLS gives every send this failure. Nobody must lose a text."""
    key_file, certificate_file = _self_signed(tmp_path)
    server = _Provider()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    for running in _serve(server):
        sender = _sender(f"https://127.0.0.1:{running.server_address[1]}")
        result = dial.send_sms(sender, ANA, "hello")

    assert result == SmsResult("refused", "untrusted_certificate", for_all=True)
    assert server.seen == []


def test_a_real_question_is_one_get_and_sends_no_text(provider: _Provider) -> None:
    assert dial.provider_answers(_sender(provider.url)) == (True, "")
    assert provider.seen == [("GET", "/api/v1/numbers", "")]


def test_a_real_redirect_of_the_question_is_no_answer_and_is_not_followed(provider: _Provider) -> None:
    provider.mode = "redirect"
    assert dial.provider_answers(_sender(provider.url)) == (False, "http_302")
    assert _requests(provider) == [("GET", "/api/v1/numbers")]


def test_a_closed_port_is_a_provider_that_does_not_answer() -> None:
    sender = _sender(f"http://127.0.0.1:{_closed_port()}")
    assert dial.provider_answers(sender) == (False, "unreachable")


def test_a_question_whose_answer_does_not_start_in_time_is_no_answer(provider: _Provider) -> None:
    provider.mode = "hang"
    assert dial.provider_answers(_sender(provider.url), timeout_s=0.2) == (False, "timeout")
    # One attempt: the provider saw one request.
    assert _requests(provider) == [("GET", "/api/v1/numbers")]


def test_a_connection_that_breaks_before_the_answer_to_the_question_is_no_answer(provider: _Provider) -> None:
    provider.mode = "drop"
    assert dial.provider_answers(_sender(provider.url)) == (False, "network")
    assert len(provider.seen) == 1


@pytest.mark.parametrize("api_key", ["test-dial\nkey", "test-dial-key\u200b"])
def test_a_key_that_cannot_be_a_header_asks_nothing(provider: _Provider, api_key: str) -> None:
    assert dial.provider_answers(_sender(provider.url, api_key)) == (False, "bad_api_key")
    assert provider.seen == []


def test_a_certificate_that_is_not_trusted_is_a_provider_that_does_not_answer(tmp_path: Path) -> None:
    key_file, certificate_file = _self_signed(tmp_path)
    server = _Provider()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate_file, key_file)
    server.socket = context.wrap_socket(server.socket, server_side=True)

    for running in _serve(server):
        answer = dial.provider_answers(_sender(f"https://127.0.0.1:{running.server_address[1]}"))

    assert answer == (False, "untrusted_certificate")
    assert server.seen == []

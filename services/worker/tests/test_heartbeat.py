"""The heartbeat says if this worker can send a text message.

The web app offers the one text about a gap only when the last heartbeat says `sms: true`. The
worker sends that text, and the web app cannot see the worker's environment, so the heartbeat is
the only place this fact is told. PostgREST is mocked with `responses`.
"""

from __future__ import annotations

import json

import pytest
import responses

import heartbeat

REST = "https://example.supabase.co/rest/v1"


def beats() -> list[dict]:
    return [json.loads(call.request.body) for call in responses.calls if call.request.method == "POST"]


def projects(*ids: str) -> None:
    responses.get(f"{REST}/project", json=[{"id": project_id} for project_id in ids])
    responses.post(f"{REST}/trace_event", json=[{"id": 1}])


@responses.activate
def test_a_worker_with_no_provider_says_that_it_cannot_text() -> None:
    projects("p1")
    assert heartbeat.beat_once("local") == 1
    (beat,) = beats()
    assert beat["title"] == "worker online"
    assert beat["kind"] == "status"
    assert beat["project_id"] == "p1"
    assert beat["detail"]["engine"] == "local"
    assert beat["detail"]["sms"] is False


@responses.activate
def test_a_worker_with_both_variables_says_that_it_can_text(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIAL_API_KEY", "test-key")
    monkeypatch.setenv("DIAL_FROM_NUMBER", "+14155550100")
    projects("p1", "p2")
    assert heartbeat.beat_once("local") == 2
    assert [beat["detail"]["sms"] for beat in beats()] == [True, True]
    assert [beat["project_id"] for beat in beats()] == ["p1", "p2"]


@responses.activate
@pytest.mark.parametrize("name", ["DIAL_API_KEY", "DIAL_FROM_NUMBER"])
def test_one_variable_alone_is_not_enough(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "+14155550100")
    projects("p1")
    heartbeat.beat_once("local")
    assert beats()[0]["detail"]["sms"] is False


@responses.activate
def test_the_heartbeat_never_holds_the_key_or_the_sender_number(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DIAL_API_KEY", "test-key-not-for-a-trace")
    monkeypatch.setenv("DIAL_FROM_NUMBER", "+14155550100")
    projects("p1")
    heartbeat.beat_once("local")
    said = json.dumps(beats())
    assert "test-key-not-for-a-trace" not in said
    assert "4155550100" not in said


@responses.activate
def test_the_variables_are_read_on_each_beat(monkeypatch: pytest.MonkeyPatch) -> None:
    projects("p1")
    heartbeat.beat_once("local")
    monkeypatch.setenv("DIAL_API_KEY", "test-key")
    monkeypatch.setenv("DIAL_FROM_NUMBER", "+14155550100")
    heartbeat.beat_once("local")
    assert [beat["detail"]["sms"] for beat in beats()] == [False, True]

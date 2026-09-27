"""The one place the worker talks to a model provider.

Model ids live here and nowhere else, so a model change is one edit. The calls go through the
Responses API, which is what the OpenAI documentation presents as the primary API for structured
output and for tool calls. See `docs/contracts.md` section 5 for each choice and its reason.
"""

from __future__ import annotations

import json
from typing import Any

from openai import OpenAI

import config

# Priority judgements, issue text and the change plan: the strongest general model, because the
# writing and the file choice both stand on their own in a pull request a human reads.
ARCHITECT_MODEL = "gpt-5.6-sol"
# Writing a whole file. Same model: this is the work the pull request is made of.
EDITOR_MODEL = "gpt-5.6-sol"

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=config.openai_api_key())
    return _client


def _text(response: Any) -> str:
    """Reasoning models put thinking items beside the text, so every reader takes the flat form."""
    return getattr(response, "output_text", None) or ""


def _input(system: str, user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def complete(model: str, system: str, user: str, effort: str = "medium", max_tokens: int = 32000) -> str:
    response = client().responses.create(
        model=model,
        input=_input(system, user),
        max_output_tokens=max_tokens,
        reasoning={"effort": effort},
    )
    return _text(response)


def complete_json(model: str, system: str, user: str, schema_name: str, schema: dict[str, Any]) -> dict[str, Any]:
    response = client().responses.create(
        model=model,
        input=_input(system, user),
        text={
            "format": {
                "type": "json_schema",
                "name": schema_name,
                "schema": schema,
                "strict": True,
            }
        },
    )
    return json.loads(_text(response))


def function_call(model: str, system: str, user: str, tools: list[dict[str, Any]], tool_name: str) -> dict[str, Any]:
    """Ask the model to call one function tool and return the arguments it chose."""
    response = client().responses.create(
        model=model,
        input=_input(system, user),
        tools=tools,
        tool_choice="required",
    )
    for item in getattr(response, "output", None) or []:
        if getattr(item, "type", "") == "function_call" and getattr(item, "name", "") == tool_name:
            arguments = getattr(item, "arguments", "")
            return json.loads(arguments) if isinstance(arguments, str) else dict(arguments)
    raise RuntimeError(f"model did not call {tool_name}")

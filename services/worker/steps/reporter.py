"""A reporter binds trace writes to one escalation so the steps do not carry ids around."""

from __future__ import annotations

from typing import Any

from steps import trace


class Reporter:
    def __init__(self, project_id: str, escalation_id: str) -> None:
        self.project_id = project_id
        self.escalation_id = escalation_id

    def model(self, title: str, model_id: str, purpose: str, **kwargs: Any) -> None:
        trace.model(self.project_id, self.escalation_id, title, model_id, purpose, **kwargs)

    def tool(self, title: str, tool_name: str, transport: str, args_summary: str, result_summary: str, status: str = "ok") -> None:
        trace.tool(self.project_id, self.escalation_id, title, tool_name, transport, args_summary, result_summary, status)

    def status(self, title: str, state: str = "ok", detail: Any = None) -> None:
        trace.status(self.project_id, self.escalation_id, title, state, detail)

    def diff(self, files: list[dict[str, str]]) -> None:
        trace.diff(self.project_id, self.escalation_id, files)


class NullReporter(Reporter):
    """Collects events in memory; used by tests and by dry runs."""

    def __init__(self) -> None:
        super().__init__("", "")
        self.events: list[tuple[str, dict[str, Any]]] = []

    def model(self, title: str, model_id: str, purpose: str, **kwargs: Any) -> None:
        self.events.append(("model", {"title": title, "model": model_id, "purpose": purpose, **kwargs}))

    def tool(self, title: str, tool_name: str, transport: str, args_summary: str, result_summary: str, status: str = "ok") -> None:
        self.events.append(("tool", {"title": title, "tool": tool_name, "transport": transport, "status": status, "result_summary": result_summary}))

    def status(self, title: str, state: str = "ok", detail: Any = None) -> None:
        self.events.append(("status", {"title": title, "status": state, "detail": detail}))

    def diff(self, files: list[dict[str, str]]) -> None:
        self.events.append(("diff", {"files": files}))

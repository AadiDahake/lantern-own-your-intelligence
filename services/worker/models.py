"""Pydantic models shared by the workflow, the activities and the local runner."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FeatureRequestInput(BaseModel):
    """Workflow input, exactly the fields the dashboard sends when it starts an escalation."""

    escalation_id: str
    project_id: str
    repo_full_name: str
    default_branch: str = "main"
    title: str
    description: str
    area: str = ""
    quote: str = ""
    rationale: str = ""
    conversation_excerpt: str = ""
    site_url: str = ""

    # The request group this run belongs to. Reports of the same gap share one group, one issue
    # and one pull request, so the counts below are the group's, not this conversation's.
    group_id: str = ""
    report_count: int = 1
    user_report_count: int = 0
    priority: str = ""
    issue_number: int = 0
    pr_number: int = 0

    # What this run is for. A group is filed as soon as it is seen, and only drafts code once
    # enough people have run into it; after that every further report only updates GitHub.
    file_only: bool = False
    update_only: bool = False
    # An update speaks into the trace of the run that owns the group, where a reader is looking.
    trace_escalation_id: str = ""

    def trace_id(self) -> str:
        return self.trace_escalation_id or self.escalation_id

    def auto_detected(self) -> bool:
        """Nobody asked for this to be filed: the agent noticed it and recorded it anyway."""
        return bool(self.group_id) and self.user_report_count == 0


class IssueRef(BaseModel):
    number: int
    url: str
    title: str
    body: str = ""
    deduplicated: bool = False
    transport: str = "mcp"
    priority: str = "medium"
    request_count: int = 1
    user_request_count: int = 0


PlannedAction = Literal["edit", "create", "delete"]


class PlannedFile(BaseModel):
    """One file the architect decided the change touches, and what it does to it.

    `delete` exists because a repository can hold a test or a document whose only content is the
    claim that the requested feature is absent. Shipping the feature makes that claim false, so the
    guard is part of the change rather than an obstacle to it.
    """

    path: str
    reason: str
    action: PlannedAction = "edit"

    @property
    def is_new(self) -> bool:
        return self.action == "create"

    @property
    def is_delete(self) -> bool:
        return self.action == "delete"


class Plan(BaseModel):
    files: list[PlannedFile]
    acceptance_criteria: list[str] = Field(default_factory=list)
    summary: str = ""
    base_sha: str = ""


class FileDiff(BaseModel):
    path: str
    patch: str


class GateOutcome(BaseModel):
    """One gate run, reported back on the pull request."""

    name: str
    ok: bool
    duration_s: float = 0.0


class Draft(BaseModel):
    files: dict[str, str]
    deletions: list[str] = Field(default_factory=list)
    diffs: list[FileDiff] = Field(default_factory=list)
    summary: str = ""
    base_sha: str = ""
    candidates_tried: int = 1
    repairs: int = 0
    gates: list[GateOutcome] = Field(default_factory=list)


class PrRef(BaseModel):
    number: int
    url: str
    branch: str
    head_sha: str = ""
    node_id: str = ""


class Approval(BaseModel):
    approved: bool
    note: str = ""


class Outcome(BaseModel):
    status: str
    issue_url: str = ""
    pr_url: str = ""
    deployment_url: str = ""
    merge_sha: str = ""
    note: str = ""

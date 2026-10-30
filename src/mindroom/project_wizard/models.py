# ruff: noqa: RUF001
"""Validated project proposals and durable wizard state."""

from __future__ import annotations

from typing import Annotated, Literal, Self
from uuid import UUID  # noqa: TC003

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

_MAX_MESSAGES = 20
_MAX_MESSAGE_CHARS = 4_000
_MAX_CONVERSATION_CHARS = 20_000
_MAX_REPLY_CHARS = _MAX_MESSAGE_CHARS
_MAX_DRAFT_CHARS = 16_000
_DraftItem = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=400)]

_ProjectMode = Literal["parallel", "hierarchical", "needs_clarification"]


class ProjectWizardAgentDraft(BaseModel):
    """One proposed role in the current project plan."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    name: str = Field(min_length=1, max_length=80)
    responsibility: str = Field(min_length=1, max_length=240)
    behavior: str = Field(min_length=1, max_length=240)
    # LEGACY_COMPAT: Project wizard proposals without selectable teammate profiles.
    # Legacy format: Agents with only name, responsibility and behavior.
    # Last legacy release: Unreleased native writer c1e57045c; no tagged release contains it.
    # Handling: Keep old members selected and their existing avatars; new inference supplies profiles.
    # Coverage: tests/api/test_project_teammates.py::test_old_draft_preserves_members
    recommendation: str = Field(default="", max_length=240)
    avatar_id: int | None = Field(default=None, ge=0, lt=12, strict=True)
    selected: bool = True


class ProjectWizardProjectDraft(BaseModel):
    """Project goals and planning context shown in the preview."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    name: str = Field(min_length=1, max_length=120)
    goal: str = Field(min_length=1, max_length=400)
    expected_outcomes: list[_DraftItem] = Field(default_factory=list, max_length=6)
    constraints: list[_DraftItem] = Field(default_factory=list, max_length=6)
    open_questions: list[_DraftItem] = Field(default_factory=list, max_length=6)


class ProjectWizardCollaborationDraft(BaseModel):
    """Recommended team organization and rationale."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    mode: _ProjectMode
    rationale: str = Field(min_length=1, max_length=400)


class ProjectWizardDraftContent(BaseModel):
    """Validated model output for the visible project plan."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    project: ProjectWizardProjectDraft
    collaboration: ProjectWizardCollaborationDraft
    agents: list[ProjectWizardAgentDraft] = Field(default_factory=list, max_length=8)

    @property
    def selected_agents(self) -> list[ProjectWizardAgentDraft]:
        """Return only the members the user selected for provisioning."""
        return [agent for agent in self.agents if agent.selected]

    @model_validator(mode="after")
    def validate_recommended_team(self) -> Self:
        """Require a useful-sized team for recommendations ready to review."""
        if self.collaboration.mode != "needs_clarification" and not self.agents:
            msg = "Ready project proposals must contain at least one agent"
            raise ValueError(msg)
        if len({agent.name.casefold() for agent in self.agents}) != len(self.agents):
            msg = "Agent names must be unique"
            raise ValueError(msg)
        if len(self.model_dump_json()) > _MAX_DRAFT_CHARS:
            msg = "Project draft is too long"
            raise ValueError(msg)
        return self


class ProjectWizardDraft(ProjectWizardDraftContent):
    """One versioned proposal inside a persisted creation draft."""

    draft_id: str = Field(min_length=1, max_length=80)
    revision: int = Field(ge=1, strict=True)
    status: Literal["proposal_ready", "needs_clarification"]


class ProjectWizardAssistantTurn(BaseModel):
    """Natural-language guidance plus a schema-validated full plan when available."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    message: str = Field(min_length=1, max_length=_MAX_REPLY_CHARS)
    draft: ProjectWizardDraftContent | None = None


class ProjectWizardRevisionTurn(ProjectWizardAssistantTurn):
    """A revision must include the whole proposal, never just a claim that it changed."""

    draft: ProjectWizardDraftContent


class ProjectWizardMessage(BaseModel):
    """One plain-text user or assistant turn supplied by the browser."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=_MAX_MESSAGE_CHARS)


class ProjectWizardChatRequest(BaseModel):
    """An in-memory conversation window; it is not persisted by this endpoint."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    messages: list[ProjectWizardMessage] = Field(min_length=1, max_length=_MAX_MESSAGES)
    draft: ProjectWizardDraft | None = None
    base_revision: int = Field(default=0, ge=0, strict=True)

    @model_validator(mode="after")
    def validate_conversation(self) -> Self:
        """Keep the client-provided history bounded and in user/assistant order."""
        expected_revision = self.draft.revision if self.draft else 0
        if self.base_revision != expected_revision:
            raise HTTPException(status_code=409, detail="方案版本已变化，请使用当前方案重试。")
        if self.draft is not None:
            expected_status = (
                "needs_clarification" if self.draft.collaboration.mode == "needs_clarification" else "proposal_ready"
            )
            if self.draft.status != expected_status:
                msg = "Draft status does not match its collaboration mode"
                raise ValueError(msg)
        if self.messages[0].role != "user" or self.messages[-1].role != "user":
            msg = "Conversation must start and end with a user message"
            raise ValueError(msg)
        if any(left.role == right.role for left, right in zip(self.messages, self.messages[1:], strict=False)):
            msg = "Conversation messages must alternate between user and assistant"
            raise ValueError(msg)
        if sum(len(message.content) for message in self.messages) > _MAX_CONVERSATION_CHARS:
            msg = "Conversation is too long"
            raise ValueError(msg)
        if self.draft is not None and len(self.draft.model_dump_json()) > _MAX_DRAFT_CHARS:
            msg = "Project draft is too long"
            raise ValueError(msg)
        return self


class StoredMessage(ProjectWizardMessage):
    """Durable user or assistant message with a retry identity."""

    id: UUID


class MockResult(BaseModel):
    """Legacy test-only result shape retained for fixtures; production confirmation never emits it."""

    project_id: str
    test_mode: Literal[True] = True
    message: str = "legacy test result"


class ProjectMember(BaseModel):
    """One verified joined bot, distinct from an AI-proposed role."""

    agent_id: str
    user_id: str
    name: str
    responsibility: str


class ProjectResult(BaseModel):
    """A fully provisioned real Matrix room and its verified bot identities."""

    project_id: str
    test_mode: bool = False
    room_id: str
    homeserver_url: str
    team_user_id: str
    sender_user_id: str
    members: list[ProjectMember]


class WizardState(BaseModel):
    """Persisted state owned by one authenticated dashboard user."""

    draft_id: UUID
    revision: int = 0
    status: Literal[
        "empty",
        "discovering",
        "proposal_ready",
        "revising",
        "confirmed",
        "provisioning",
        "created",
        "provision_failed",
    ] = "empty"
    draft: ProjectWizardDraft | None = None
    messages: list[StoredMessage] = Field(default_factory=list)
    pending_message_id: UUID | None = None
    error: str | None = None
    confirmation_key: UUID | None = None
    confirmed_revision: int | None = None
    result: MockResult | ProjectResult | None = None
    progress: str | None = None
    config_installed: bool = False
    owner_user_id: str | None = None
    updated_at: float = 0
    test_mode: bool = False


class DiscussionSummary(BaseModel):
    """Small owner-scoped navigation entry for a draft or its created room."""

    draft_id: UUID
    name: str
    status: str
    updated_at: float


class MessageRequest(BaseModel):
    """One user-authored turn against an exact persisted revision."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)
    revision: int = Field(ge=0, strict=True)
    message_id: UUID
    content: str = Field(min_length=1, max_length=_MAX_MESSAGE_CHARS)


class RenameRequest(BaseModel):
    """Direct edit of the suggested name against an exact revision."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)
    revision: int = Field(ge=0, strict=True)
    name: str = Field(min_length=1, max_length=120)


class SelectMembersRequest(BaseModel):
    """Select candidates from the exact persisted proposal, without accepting new roles."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    revision: int = Field(ge=0, strict=True)
    names: list[Annotated[str, StringConstraints(min_length=1, max_length=80)]] = Field(max_length=8)


class ConfirmRequest(BaseModel):
    """Explicit confirmation of a frozen proposal, never supplied by the model."""

    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    idempotency_key: UUID

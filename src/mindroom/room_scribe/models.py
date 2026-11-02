"""Persisted discussion notes and the model's bounded update contract."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

_Category = Literal["fact", "idea", "decision", "question", "action"]


class Note(BaseModel):
    """One claim and the messages that support it."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: str = Field(default="", max_length=80)
    category: _Category
    text: str = Field(min_length=1, max_length=2000)
    source_event_ids: list[str] = Field(min_length=1, max_length=20)


class NoteUpdate(BaseModel):
    """Only explicit updates replace existing entries; omitted entries survive."""

    model_config = ConfigDict(extra="forbid")

    overview: str | None = Field(default=None, max_length=2000)
    upserts: list[Note] = Field(default_factory=list, max_length=40)
    remove_ids: list[str] = Field(default_factory=list, max_length=40)


class DiscussionNotes(BaseModel):
    """Public snapshot, without a second copy of the room transcript."""

    overview: str = ""
    items: list[Note] = Field(default_factory=list)
    updated_at: float | None = None
    checked_at: float | None = None
    status: Literal["waiting", "running", "ready", "error"] = "waiting"
    error: str | None = None
    pending_messages: int = 0


class MessageProgress(BaseModel):
    """Progress within one long message, invalidated whenever its revision changes."""

    revision: str
    offset: int


class ScribeState(BaseModel):
    """Primary-only progress and current Matrix source revisions."""

    room_id: str
    last_event_id: str | None = None
    sources: list[dict[str, Any]] = Field(default_factory=list)
    processed: dict[str, str] = Field(default_factory=dict)
    partial: dict[str, MessageProgress] = Field(default_factory=dict)
    notes: DiscussionNotes = Field(default_factory=DiscussionNotes)

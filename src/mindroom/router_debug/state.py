"""Expiring in-memory debugger sessions; no conversation data is written to disk."""

from __future__ import annotations

import json
import time
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from string import Formatter
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

if TYPE_CHECKING:
    from collections.abc import Iterator
    from uuid import UUID

    from mindroom.constants import RuntimePaths

SESSION_SECONDS = 60
_MAX_SESSIONS = 32
_MAX_EVENTS = 100
_MAX_DETAIL_CHARS = 24_000


class DebugSettings(BaseModel):
    """Overrides apply only to decisions started during an active session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    strategy: Literal["configured", "llm"] = "configured"
    model: str | None = Field(default=None, min_length=1, max_length=200)
    prompt_template: str | None = Field(default=None, max_length=12_000)
    history_messages: int = Field(default=3, ge=0, le=20, strict=True)
    history_chars: int = Field(default=100, ge=1, le=4000, strict=True)
    timeout_seconds: float | None = Field(default=None, ge=0.1, le=30, allow_inf_nan=False)
    retries: int = Field(default=0, ge=0, le=2, strict=True)

    @field_validator("prompt_template")
    @classmethod
    def validate_template(cls, value: str | None) -> str | None:
        """Allow only the two existing router prompt substitutions."""
        if value is None:
            return None
        fields: set[str] = set()
        for _, name, spec, conversion in Formatter().parse(value):
            if name is not None:
                if name not in {"agents_info", "message"} or spec or conversion:
                    msg = "Use only {agents_info} and {message}, without format specifiers"
                    raise ValueError(msg)
                fields.add(name)
        if fields != {"agents_info", "message"}:
            msg = "The template must contain {agents_info} and {message}"
            raise ValueError(msg)
        return value


@dataclass(frozen=True)
class _DebugEvent:
    """One bounded, text-rendered stage of an actual router turn."""

    sequence: int
    timestamp: float
    event_id: str
    stage: str
    detail: str
    truncated: bool


@dataclass
class DebugSession:
    """A single browser's renewable lease over one room's debug overrides."""

    session_id: UUID
    owner: str
    expires_at: float
    settings: DebugSettings = field(default_factory=DebugSettings)
    revision: int = 0
    events: deque[_DebugEvent] = field(default_factory=lambda: deque(maxlen=_MAX_EVENTS))
    sequence: int = 0

    def record(self, event_id: str, stage: str, detail: object) -> None:
        """Record only while the original session remains open."""
        if self.expires_at <= time.monotonic():
            return
        body = json.dumps(detail, ensure_ascii=False, default=str, indent=2)
        self.sequence += 1
        self.events.append(
            _DebugEvent(
                self.sequence,
                time.time(),
                event_id,
                stage,
                body[:_MAX_DETAIL_CHARS],
                len(body) > _MAX_DETAIL_CHARS,
            ),
        )


_sessions: dict[tuple[str, str], DebugSession] = {}
_selection: ContextVar[tuple[DebugSession, str, DebugSettings] | None] = ContextVar(
    "router_debug_selection", default=None,
)


def session_for(paths: RuntimePaths, room_id: str) -> DebugSession | None:
    """Drop expired leases before consulting this room's session."""
    now = time.monotonic()
    for key, session in list(_sessions.items()):
        if session.expires_at <= now:
            del _sessions[key]
    return _sessions.get((str(paths.storage_root), room_id))


def open_session(paths: RuntimePaths, room_id: str, owner: str, session_id: UUID) -> DebugSession:
    """Renew the same browser lease, rejecting simultaneous editors."""
    session = session_for(paths, room_id)
    if session is not None and (session.owner != owner or session.session_id != session_id):
        msg = "Another debugger is open for this room"
        raise ValueError(msg)
    if session is None:
        if len(_sessions) >= _MAX_SESSIONS:
            msg = "Too many debugger sessions are open"
            raise ValueError(msg)
        session = DebugSession(session_id, owner, time.monotonic() + SESSION_SECONDS)
        _sessions[str(paths.storage_root), room_id] = session
    session.expires_at = time.monotonic() + SESSION_SECONDS
    return session


def close_session(paths: RuntimePaths, room_id: str, session: DebugSession) -> None:
    """Invalidate in-flight observers and erase the closed session's transcript."""
    if session_for(paths, room_id) is session:
        del _sessions[str(paths.storage_root), room_id]
    session.expires_at = 0
    session.events.clear()


def record_event(paths: RuntimePaths, room_id: str, event_id: str, stage: str, detail: object) -> None:
    """Observe a policy or delivery stage without enabling any collection."""
    session = session_for(paths, room_id)
    if session is not None:
        session.record(event_id, stage, detail)


@contextmanager
def selection_scope(paths: RuntimePaths, room_id: str, event_id: str) -> Iterator[None]:
    """Snapshot experiment settings once, preserving task-local correlation."""
    session = session_for(paths, room_id)
    token = _selection.set(None if session is None else (session, event_id, session.settings))
    try:
        yield
    finally:
        _selection.reset(token)


def current_settings() -> DebugSettings | None:
    """Return the immutable settings captured for this selection."""
    current = _selection.get()
    return current[2] if current is not None else None


def record_selection(stage: str, detail: object) -> None:
    """Record model inputs and outputs without retaining them when disabled."""
    current = _selection.get()
    if current is not None:
        current[0].record(current[1], stage, detail)

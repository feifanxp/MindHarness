"""Temporary room-scoped router experiments and observable validation outcomes."""

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from agno.agent import Agent
from agno.run.agent import RunOutput
from pydantic import ValidationError

from mindroom import routing
from mindroom.router_debug import state
from tests.conftest import test_runtime_paths as make_paths


def test_lease_is_scoped_and_close_erases_data(tmp_path: Path) -> None:
    """Rooms and runtime roots cannot see each other's transcripts or settings."""
    paths = make_paths(tmp_path)
    lease = state.open_session(paths, "!room", "owner", uuid4())
    state.record_event(paths, "!room", "$one", "received", "private")
    state.record_event(paths, "!other", "$two", "received", "other")
    assert len(lease.events) == 1
    assert state.session_for(make_paths(tmp_path / "other"), "!room") is None
    with pytest.raises(ValueError, match="Another debugger"):
        state.open_session(paths, "!room", "other", uuid4())
    lease.settings = state.DebugSettings(retries=2)
    with state.selection_scope(paths, "!room", "$one"):
        assert state.current_settings().retries == 2
        state.close_session(paths, "!room", lease)
        state.record_selection("output", "late result")
        assert not lease.events
    assert state.current_settings() is None
    assert state.session_for(paths, "!room") is None


def test_lease_expiry_restores_defaults_and_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Expired leases are removed, and event content cannot grow without a bound."""
    clock = 100.0
    monkeypatch.setattr(state.time, "monotonic", lambda: clock)
    paths = make_paths(tmp_path)
    lease = state.open_session(paths, "!room", "owner", uuid4())
    for _ in range(state._MAX_EVENTS + 3):
        lease.record("$one", "input", "x" * (state._MAX_DETAIL_CHARS + 10))
    assert len(lease.events) == state._MAX_EVENTS
    assert lease.events[-1].truncated
    assert len(lease.events[-1].detail) == state._MAX_DETAIL_CHARS
    clock += state.SESSION_SECONDS + 1
    with state.selection_scope(paths, "!room", "$one"):
        assert state.current_settings() is None
    assert state.session_for(paths, "!room") is None


@pytest.mark.parametrize(
    "template",
    ["hello", "{message}", "{agents_info} {message.__class__}", "{agents_info} {message!r}"],
)
def test_prompt_requires_only_known_placeholders(template: str) -> None:
    """A debug template cannot drop required context or inspect format attributes."""
    with pytest.raises(ValidationError):
        state.DebugSettings(prompt_template=template)


@pytest.mark.asyncio
async def test_retry_observes_invalid_output_and_is_opt_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """One invalid response is terminal normally, but the debug retry can recover."""
    paths = make_paths(tmp_path)
    agent = MagicMock(spec=Agent)
    agent.arun = AsyncMock(
        side_effect=[
            RunOutput(content="not structured"),
            RunOutput(content={"entity_name": "writer", "reasoning": "Fits"}),
        ],
    )
    monkeypatch.setattr(routing, "record_system_usage", AsyncMock())
    assert await routing._select_with_validation(agent, "route", ["writer"], paths) is None
    assert agent.arun.await_count == 1
    agent.arun.reset_mock(side_effect=True)
    agent.arun.side_effect = [
        RunOutput(content="not structured"),
        RunOutput(content={"entity_name": "writer", "reasoning": "Fits"}),
    ]
    lease = state.open_session(paths, "!room", "owner", uuid4())
    lease.settings = state.DebugSettings(retries=1)
    with state.selection_scope(paths, "!room", "$one"):
        result = await routing._select_with_validation(agent, "route", ["writer"], paths)
    assert result.entity_name == "writer"
    assert agent.arun.await_count == 2
    assert "previous answer failed validation" in agent.arun.await_args.args[0]
    assert any(event.stage == "validation_failed" for event in lease.events)
    assert any("not structured" in event.detail for event in lease.events)
    assert lease.events[-1].stage == "selected"
    state.close_session(paths, "!room", lease)


@pytest.mark.asyncio
async def test_timeout_and_settings_snapshot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A setting edit cannot change an in-flight attempt's timeout or retry budget."""
    paths = make_paths(tmp_path)
    agent = MagicMock(spec=Agent)
    entered = asyncio.Event()

    async def block(*_args: object, **_kwargs: object) -> None:
        entered.set()
        await asyncio.Event().wait()

    agent.arun = AsyncMock(side_effect=block)
    monkeypatch.setattr(routing, "record_system_usage", AsyncMock())
    lease = state.open_session(paths, "!room", "owner", uuid4())
    lease.settings = state.DebugSettings(timeout_seconds=0.1)
    with state.selection_scope(paths, "!room", "$one"):
        lease.settings = state.DebugSettings(timeout_seconds=30, retries=2)
        with pytest.raises(TimeoutError):
            await routing._select_with_validation(agent, "route", ["writer"], paths)
    assert entered.is_set()
    assert agent.arun.await_count == 1
    state.close_session(paths, "!room", lease)

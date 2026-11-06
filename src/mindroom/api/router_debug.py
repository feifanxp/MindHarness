# ruff: noqa: RUF001
"""Owner-authenticated debugger leases for a created discussion's router."""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import TYPE_CHECKING, Annotated
from uuid import UUID  # noqa: TC003 - FastAPI and Pydantic resolve these annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from mindroom.api import config_lifecycle
from mindroom.api.project_wizard_auth import require_discussion_user
from mindroom.peer_discussion.policy import room_discussion
from mindroom.project_wizard.models import ProjectResult
from mindroom.project_wizard.store import WizardStore
from mindroom.router_debug.state import (
    SESSION_SECONDS,
    DebugSession,
    DebugSettings,
    close_session,
    open_session,
    session_for,
)

if TYPE_CHECKING:
    from mindroom.config.main import Config
    from mindroom.constants import RuntimePaths

router = APIRouter(prefix="/api/project-wizard/drafts/{draft_id}/router-debug", tags=["project-wizard"])


class LeaseRequest(BaseModel):
    """A tab identity cannot operate another tab's debugger."""

    model_config = ConfigDict(extra="forbid")
    session_id: UUID
    start: bool = False


class SettingsRequest(LeaseRequest):
    """Apply one complete, versioned set of temporary settings."""

    revision: int = Field(ge=0)
    settings: DebugSettings


async def _scope(draft_id: UUID, request: Request, user: dict) -> tuple[Config, RuntimePaths, str]:
    config, paths = config_lifecycle.read_committed_runtime_config(request)
    state = await asyncio.to_thread(WizardStore(paths.storage_root, user["matrix_user_id"]).read, draft_id)
    if not isinstance(state.result, ProjectResult) or state.result.test_mode:
        raise HTTPException(409, "请先创建真实讨论，再打开 Router 调试器。")
    return config, paths, state.result.room_id


def _owned_session(paths: RuntimePaths, room_id: str, owner: str, session_id: UUID) -> DebugSession:
    session = session_for(paths, room_id)
    if session is None or session.owner != owner or session.session_id != session_id:
        raise HTTPException(409, "调试会话已过期或由其他窗口打开，请关闭后重新打开。")
    return session


def _snapshot(session: DebugSession, config: Config, paths: RuntimePaths, room_id: str) -> dict:
    return {
        "session_id": str(session.session_id),
        "revision": session.revision,
        "settings": session.settings.model_dump(),
        "events": [asdict(event) for event in session.events],
        "lease_seconds": SESSION_SECONDS,
        "configured": {
            "model": config.resolve_runtime_model(
                entity_name="router",
                room_id=room_id,
                runtime_paths=paths,
            ).model_name,
            "models": list(config.models),
            "prompt_template": config.get_prompt("ROUTER_AGENT_SELECTION_PROMPT_TEMPLATE"),
            "judgment": config.router.judgment.provider if config.router.judgment is not None else None,
            "peer_discussion": room_discussion(config, paths, room_id) is not None,
        },
    }


@router.post("")
async def renew_debugger(
    draft_id: UUID,
    payload: LeaseRequest,
    request: Request,
    user: Annotated[dict, Depends(require_discussion_user)],
) -> dict:
    """Open or heartbeat an owner-scoped lease; return bounded observations."""
    config, paths, room_id = await _scope(draft_id, request, user)
    if not payload.start:
        _owned_session(paths, room_id, user["matrix_user_id"], payload.session_id)
    try:
        session = open_session(paths, room_id, user["matrix_user_id"], payload.session_id)
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    return _snapshot(session, config, paths, room_id)


@router.put("")
async def update_debugger(
    draft_id: UUID,
    payload: SettingsRequest,
    request: Request,
    user: Annotated[dict, Depends(require_discussion_user)],
) -> dict:
    """Apply only room-local parameters, never config files or credentials."""
    config, paths, room_id = await _scope(draft_id, request, user)
    session = _owned_session(paths, room_id, user["matrix_user_id"], payload.session_id)
    if payload.revision != session.revision:
        raise HTTPException(409, "参数已更新，请重新读取后再应用。")
    if payload.settings.model is not None and payload.settings.model not in config.models:
        raise HTTPException(422, "请选择已配置的模型。")
    session.settings = payload.settings
    session.revision += 1
    session.record("", "settings", {"revision": session.revision, "settings": session.settings.model_dump()})
    return _snapshot(session, config, paths, room_id)


@router.delete("")
async def stop_debugger(
    draft_id: UUID,
    payload: LeaseRequest,
    request: Request,
    user: Annotated[dict, Depends(require_discussion_user)],
) -> dict[str, bool]:
    """Close only the requesting tab's lease; repeated cleanup is harmless."""
    _, paths, room_id = await _scope(draft_id, request, user)
    session = session_for(paths, room_id)
    if session is not None and session.owner == user["matrix_user_id"] and session.session_id == payload.session_id:
        close_session(paths, room_id, session)
    return {"closed": True}

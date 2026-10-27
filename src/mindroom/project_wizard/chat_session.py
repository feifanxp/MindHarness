# ruff: noqa: RUF001
"""Explicit operator-configured login handoff to the existing Matrix web client."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

from mindroom.constants import runtime_matrix_homeserver
from mindroom.credentials.manager import get_runtime_shared_credentials_manager
from mindroom.project_wizard.models import ProjectResult, WizardState

if TYPE_CHECKING:
    from mindroom.constants import RuntimePaths


class ChatSession(BaseModel):
    """A new device login for the confirmed project's owner, never an agent session."""

    base_url: str
    user_id: str
    access_token: str
    device_id: str
    room_id: str


async def create_chat_session(state: WizardState, paths: RuntimePaths, user: dict[str, object]) -> ChatSession:
    """Use only an explicitly configured local owner credential and the saved project owner."""
    if state.status != "created" or not isinstance(state.result, ProjectResult):
        raise HTTPException(409, "聊天室尚未完成创建。")
    credentials = get_runtime_shared_credentials_manager(paths).load_credentials("project_chat_owner")
    if not credentials or credentials.get("user_id") != state.owner_user_id:
        raise HTTPException(503, "请在 MindRoom Chat 登录项目所属 Matrix 账号，再打开此聊天室。")
    standalone = user.get("user_id") == "standalone" and user.get("auth_source") != "trusted_upstream"
    if not standalone and user.get("matrix_user_id") != state.owner_user_id:
        raise HTTPException(403, "当前登录身份不是此项目的所有者。")
    password = credentials.get("password")
    if not isinstance(password, str) or not password:
        raise HTTPException(503, "本地聊天登录未配置，请使用 MindRoom Chat 登录。")
    base_url = runtime_matrix_homeserver(paths)
    async with httpx.AsyncClient(base_url=base_url, timeout=20) as client:
        response = await client.post(
            "/_matrix/client/v3/login",
            json={
                "type": "m.login.password",
                "identifier": {"type": "m.id.user", "user": state.owner_user_id},
                "password": password,
                "initial_device_display_name": "Agent Room Web",
            },
        )
        if response.status_code != 200:
            raise HTTPException(502, "本地 Matrix 登录失败，请重试。")
        data = response.json()
        if data.get("user_id") != state.owner_user_id:
            raise HTTPException(502, "Matrix 返回的登录身份与项目所有者不一致。")
        joined = await client.post(
            f"/_matrix/client/v3/join/{quote(state.result.room_id, safe='')}",
            headers={"Authorization": f"Bearer {data['access_token']}"},
            json={},
        )
        if joined.status_code != 200:
            await client.post(
                "/_matrix/client/v3/logout",
                headers={"Authorization": f"Bearer {data['access_token']}"},
                json={},
            )
            raise HTTPException(502, "本地用户暂时无法加入该聊天室，请检查邀请后重试。")
    return ChatSession(
        base_url=base_url,
        user_id=data["user_id"],
        access_token=data["access_token"],
        device_id=data["device_id"],
        room_id=state.result.room_id,
    )

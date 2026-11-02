# ruff: noqa: RUF001
"""Map a confirmed plan onto managed MindRoom entities and verify live membership."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

import nio
from fastapi import HTTPException

from mindroom.api import config_lifecycle
from mindroom.background_tasks import run_blocking_until_complete
from mindroom.constants import (
    OWNER_MATRIX_USER_ID_ENV,
    ROUTER_AGENT_NAME,
    runtime_matrix_homeserver,
    workspace_avatar_path,
)
from mindroom.matrix.health import get_matrix_sync_health_snapshot
from mindroom.matrix.state import load_rooms
from mindroom.matrix.users import create_agent_http_client, load_agent_user
from mindroom.project_wizard.avatars import avatar_path
from mindroom.project_wizard.models import ProjectMember, ProjectResult, WizardState
from mindroom.runtime_state import get_runtime_state

if TYPE_CHECKING:
    from fastapi import Request

    from mindroom.constants import RuntimePaths
    from mindroom.project_wizard.store import WizardStore


_PROJECT_DISCUSSION_INSTRUCTIONS = """你是项目群聊中的一位 AI 队友，与用户和其他成员平等协作。把项目目标和预期成果放在心里，围绕眼前的话题一起把事情想清楚、向前推进。
先听懂对方这句话真正想说什么，再接着聊。回应具体的问题和观点：可以顺着一个好想法往前走，补上一个关键细节，也可以指出分歧并说清理由。直接和相关成员交流，让讨论在彼此的回应中自然发展。
带着自己的专业判断参与，也对别人的视角保持好奇。赞同时说出你认同的具体之处，有不同判断时坦率说明依据；遇到更有说服力的信息，可以自然地修正自己的看法。让性格体现在关注点、措辞和取舍里。
把每次发言当成对话中的一小步。平常用几句口语化的话讲清一个重点，简单回应可以更短；讲到对方能接话的地方就留出空间。只有简短认同或暂时没有补充时，也可以如实表达。根据话题的分量和对方的需要决定长度。
使用用户的语言，表达自然、具体、有温度，语气贴合当前讨论。日常交流用连贯短句；需要比较、梳理或交付成果时，再选择列表、表格或完整文档。用户对详略和节奏的偏好优先。
信息不足时，先说清已有判断和关键缺口，再向最能回答的人问一个具体问题。专业问题可以和其他成员一起推敲；涉及用户的目标、经历、偏好和资源时，以用户明确提供或确认的信息为准。
清楚区分已知事实、个人判断和待验证的假设。引用别人的观点时忠实于实际发言，举例时让大家知道那是例子；发现前提有误就及时澄清，再继续讨论。
以 AI 队友的身份坦诚交流。谈到自己的经历、能力、掌握的信息以及系统状态时，以当前确实可核实的内容为依据；不确定时直接说不确定。
"""

_PROJECT_TEAM_INSTRUCTIONS = [
    _PROJECT_DISCUSSION_INSTRUCTIONS,
    "协调讨论时，将用户当前问题、已确认事实、相关前文和本轮发言长度要求一起交给成员。明确区分用户事实和成员假设，不把最终交付清单当作本轮任务。",
    "界面会展示成员的回答，收尾不要再复述一遍。普通讨论只用 1–2 句指出关键分歧或下一个待确认点，不强行制造共识；只有用户要求汇总或交付文档时才组织完整总结。",
]


def _project_keys(state: WizardState) -> tuple[str, list[str], str]:
    """Stable names let config and Matrix reconciliation safely resume the same operation."""
    assert state.draft is not None
    prefix = f"project_{state.draft_id.hex}"
    return (
        prefix,
        [f"{prefix}_a{index + 1}" for index, agent in enumerate(state.draft.agents) if agent.selected],
        f"{prefix}_team",
    )


def preflight(request: Request, user: dict[str, object]) -> str | None:
    """Require an actual runtime and a saved user account before creating any config."""
    config, paths = config_lifecycle.read_committed_runtime_config(request)
    if get_runtime_state().phase != "ready" or config_lifecycle.app_state(request.app).config_reload_status is None:
        raise HTTPException(
            503,
            "Bot 运行服务尚未启动。请启动完整 MindRoom 服务后重试；仅 Dashboard API 无法启动 Bot。",
        )
    if config.mindroom_user is None or load_agent_user("user", paths) is None:
        raise HTTPException(503, "项目聊天需要已配置并登录的 MindRoom 内部用户，请先启动完整服务。")
    if config.room_defaults.encrypted:
        raise HTTPException(409, "此版本项目空间暂不支持加密房间，请使用现有 Matrix 客户端创建加密会话。")
    if config.router.model not in config.models:
        raise HTTPException(503, "项目所用模型未配置，请先修正项目助手模型。")
    raw_owner = user.get("matrix_user_id") or paths.env_value(OWNER_MATRIX_USER_ID_ENV)
    if not isinstance(raw_owner, str) or not raw_owner.startswith("@"):
        raise HTTPException(503, "无法确定聊天室的邀请对象。请先完成 Matrix 配对或设置 MINDROOM_OWNER_USER_ID。")
    return raw_owner


def _project_config(
    state: WizardState,
    model: str,
    owner: str | None,
) -> tuple[dict[str, object], dict[str, object], dict[str, object]]:
    """Only role text crosses from the model; capabilities and membership are deterministic."""
    assert state.draft is not None
    draft = state.draft
    room_key, agent_keys, team_key = _project_keys(state)
    context = f"项目：{draft.project.name}\n目标：{draft.project.goal}\n预期成果：{'；'.join(draft.project.expected_outcomes)}\n约束：{'；'.join(draft.project.constraints)}\n待确认：{'；'.join(draft.project.open_questions)}"
    agents = {}
    for key, role in zip(agent_keys, draft.selected_agents, strict=True):
        agents[key] = {
            "display_name": role.name,
            "role": role.responsibility,
            "model": model,
            "instructions": [
                context,
                role.behavior,
                *([f"擅长领域：{role.expertise}"] if role.expertise else []),
                "使用用户的语言回答。区分证据与假设，不冒充真实人类专家。可以直接回应其他成员的观点，但不要假称别人已经同意或回复。",
                _PROJECT_DISCUSSION_INSTRUCTIONS,
            ],
            "rooms": [room_key],
            "thread_mode": "room",
            "include_default_tools": False,
            "tools": [],
            "skills": [],
            "delegate_to": [],
            "automations": [],
            "learning": False,
            "knowledge_graph": False,
            "memory_backend": "none",
            "allow_self_config": False,
            "accept_invites": False,
            "access": {"current_room_members": True, "members_of_rooms": [], "users": []},
        }
    room: dict[str, object] = {
        "display_name": draft.project.name,
        "description": draft.project.goal,
        "join_policy": "invite",
        "listed": False,
        "encrypted": False,
        "invite_users": [owner] if owner else [],
        "admins": [],
    }
    if draft.collaboration.mode == "parallel":
        room["peer_discussion"] = {"max_agent_turns": 6, "max_turns_per_agent": 2}
    team = {
        "display_name": f"{draft.project.name} · 团队",
        "role": context,
        "instructions": _PROJECT_TEAM_INSTRUCTIONS,
        "agents": agent_keys,
        "rooms": [room_key],
        "model": model,
        "mode": "collaborate" if draft.collaboration.mode == "parallel" else "coordinate",
        "access": {"current_room_members": True, "members_of_rooms": [], "users": []},
        "accept_invites": False,
    }
    agents[f"{room_key}_scribe"] = {
        "display_name": "整理员",
        "role": "后台整理讨论中的事实、观点、决定、分歧和行动，保留原文出处。",
        "model": model,
        "room_scribe": True,
        "rooms": [room_key],
        "thread_mode": "room",
        "include_default_tools": False,
        "tools": [],
        "skills": [],
        "delegate_to": [],
        "automations": [],
        "learning": False,
        "knowledge_graph": False,
        "memory_backend": "none",
        "allow_self_config": False,
        "accept_invites": False,
        "access": {"current_room_members": False, "members_of_rooms": [], "users": []},
    }
    return {room_key: room}, agents, {team_key: team}


def _install_project_config(request: Request, state: WizardState, owner: str | None) -> None:
    """Commit room, agents and team together using the existing validated config writer."""
    config, paths = config_lifecycle.read_committed_runtime_config(request)
    rooms, agents, teams = _project_config(state, config.router.model, owner)
    assert state.draft is not None
    _, agent_keys, _ = _project_keys(state)
    for key, role in zip(agent_keys, state.draft.selected_agents, strict=True):
        if role.avatar_id is not None:
            destination = workspace_avatar_path("agents", key, paths)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(avatar_path(role.avatar_id).read_bytes())

    def mutate(candidate: dict[str, Any]) -> None:
        for section, entries in (("rooms", rooms), ("agents", agents), ("teams", teams)):
            target = candidate.setdefault(section, {})
            for key, value in entries.items():
                if key in target and target[key] != value:
                    raise HTTPException(409, "项目配置已被外部修改，请检查现有配置后重试。")
                target[key] = value

    config_lifecycle.write_committed_config(request, mutate, error_prefix="Failed to save project configuration")


def rename_project_config(request: Request, state: WizardState, name: str) -> None:
    """Update the managed room title when a created discussion is renamed."""
    if not state.config_installed:
        return
    room_key, _agent_keys, _team_key = _project_keys(state)

    def mutate(candidate: dict[str, Any]) -> None:
        room = candidate.get("rooms", {}).get(room_key)
        if room is not None:
            room["display_name"] = name

    config_lifecycle.write_committed_config(request, mutate, error_prefix="Failed to rename discussion")


def remove_project_config(request: Request, state: WizardState) -> None:
    """Stop only this project's dedicated entities, retaining Matrix messages and runtime history."""
    if state.draft is None:
        return
    room_key, agent_keys, team_key = _project_keys(state)
    agent_keys = [*agent_keys, f"{room_key}_scribe"]

    def mutate(candidate: dict[str, Any]) -> None:
        for section, keys in (("agents", agent_keys), ("teams", [team_key])):
            entries = candidate.get(section, {})
            for key in keys:
                entry = entries.get(key)
                if entry is not None and set(entry.get("rooms", [])) - {room_key}:
                    raise HTTPException(409, "该讨论的 BOT 已用于其他房间，请先解除关联再删除。")
        for key, team in candidate.get("teams", {}).items():
            if key != team_key and set(team.get("agents", [])).intersection(agent_keys):
                raise HTTPException(409, "该讨论的 BOT 已用于其他团队，请先解除关联再删除。")
        for key in agent_keys:
            candidate.get("agents", {}).pop(key, None)
        candidate.get("teams", {}).pop(team_key, None)
        candidate.get("rooms", {}).pop(room_key, None)
        candidate.get("room_models", {}).pop(room_key, None)

    config_lifecycle.write_committed_config(request, mutate, error_prefix="Failed to remove discussion")


async def _live_project_result(  # noqa: PLR0911
    state: WizardState,
    paths: RuntimePaths,
) -> ProjectResult | None:
    """Require every named Bot to run and actually join the room before claiming success."""
    assert state.draft is not None
    room_key, agent_keys, team_key = _project_keys(state)
    scribe_key = f"{room_key}_scribe"
    room = (await asyncio.to_thread(load_rooms, paths)).get(room_key)
    if room is None:
        return None
    health = get_matrix_sync_health_snapshot()
    if not {*agent_keys, team_key, scribe_key}.issubset(set(health.active_entities) - set(health.stale_entities)):
        return None
    identities = []
    for key in [*agent_keys, scribe_key, team_key, "user"]:
        account = await asyncio.to_thread(load_agent_user, key, paths)
        if account is None or not account.access_token:
            return None
        identities.append(account)
    sender = create_agent_http_client("user", paths)
    try:
        membership = await sender.joined_members(room.room_id)
        if not isinstance(membership, nio.JoinedMembersResponse):
            return None
        joined = {member.user_id for member in membership.members}
        if not {identity.user_id for identity in identities}.issubset(joined):
            return None
    finally:
        await sender.close()
    if not state.owner_user_id:
        return None
    router = create_agent_http_client(ROUTER_AGENT_NAME, paths)
    try:
        owner_membership = await router.room_get_state_event(room.room_id, "m.room.member", state.owner_user_id)
        if not isinstance(owner_membership, nio.RoomGetStateEventResponse) or owner_membership.content.get(
            "membership",
        ) not in {"invite", "join"}:
            return None
    finally:
        await router.close()
    members = [
        ProjectMember(agent_id=key, user_id=account.user_id, name=role.name, responsibility=role.responsibility)
        for key, account, role in zip(agent_keys, identities, state.draft.selected_agents, strict=False)
    ]
    return ProjectResult(
        project_id=str(state.draft_id),
        room_id=room.room_id,
        homeserver_url=runtime_matrix_homeserver(paths),
        team_user_id=identities[-2].user_id,
        sender_user_id=identities[-1].user_id,
        members=members,
        scribe=ProjectMember(
            agent_id=scribe_key,
            user_id=identities[-3].user_id,
            name="整理员",
            responsibility="后台整理讨论成果，不参与发言",
        ),
    )


async def provision_project(
    request: Request,
    state: WizardState,
    store: WizardStore,
    owner: str | None,
) -> ProjectResult:
    """Resume config reconciliation and wait a bounded time for real runtime evidence."""
    _config, paths = config_lifecycle.read_committed_runtime_config(request)
    state.progress = "正在保存聊天室与 Bot 配置"
    await run_blocking_until_complete(store.save, state)
    await run_blocking_until_complete(_install_project_config, request, state, owner)
    state.config_installed = True
    state.progress = "配置已保存，正在启动 Bot 并加入聊天室"
    await run_blocking_until_complete(store.save, state)
    try:
        async with asyncio.timeout(90):
            while True:
                result = await _live_project_result(state, paths)
                if result:
                    return result
                status = config_lifecycle.app_state(request.app).config_reload_status
                if status and status().status == "failed":
                    raise HTTPException(503, "MindRoom 加载项目配置失败，请查看服务日志后重试。")
                await asyncio.sleep(0.5)
    except TimeoutError:
        raise HTTPException(504, "配置已保存，但 Bot 尚未全部上线。可重试继续等待，不会重复创建。") from None

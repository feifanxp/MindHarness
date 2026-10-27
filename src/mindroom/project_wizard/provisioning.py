# ruff: noqa: RUF001
"""Map a confirmed plan onto managed MindRoom entities and verify live membership."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

import nio
from fastapi import HTTPException

from mindroom.api import config_lifecycle
from mindroom.background_tasks import run_blocking_until_complete
from mindroom.constants import OWNER_MATRIX_USER_ID_ENV, ROUTER_AGENT_NAME, runtime_matrix_homeserver
from mindroom.matrix.health import get_matrix_sync_health_snapshot
from mindroom.matrix.state import load_rooms
from mindroom.matrix.users import create_agent_http_client, load_agent_user
from mindroom.project_wizard.models import ProjectMember, ProjectResult, WizardState
from mindroom.runtime_state import get_runtime_state

if TYPE_CHECKING:
    from fastapi import Request

    from mindroom.constants import RuntimePaths
    from mindroom.project_wizard.store import WizardStore


_PROJECT_DISCUSSION_INSTRUCTIONS = """你在参加项目群聊。项目目标和预期成果是整个项目的背景，不是每条消息都必须完成的作业。
你和用户、其他成员平等交流。可以直接接其他成员的话、回答他们的问题或提出有依据的不同看法，不需要等用户点名，不把用户当作分配任务的老板。不要每轮都向用户请示下一步或把可以互相讨论的问题都抛给用户。只有确实缺少用户才能提供的信息时才问用户。
默认每次只推进一个最相关的观点，用 2–3 句自然语言说清楚，中文以 80–150 字为目标，最多 200 字；其他语言保持相当长度。说清一个观点及其理由就停下，把下一步留给对方，不追加其他专业分支。先接住刚提出的具体问题；没有新观点时简短说明，不重复已有分析。
默认不用标题、表格、长清单、自我介绍或固定免责声明，不逐项覆盖自己的全部职责，不自动附上选项菜单。需要澄清时只问一个会改变下一步判断的问题。
用户要求“展开”“详细分析”“做对比表”“整理方案”时，按要求提供足够细节；要求“简短点”“先讨论”“只说分歧”时遵循该节奏。当前请求的表达方式优先于角色中预设的报告格式。
只把用户明确确认的信息当作项目事实。成员提出的假设、举例和推测仍然是假设；不要把它们重复成已确认的硬件条件、法规要求或用户需求，也不要自行补全用户没说的现有流程。被问某个前提是否成立时，只说明已知与缺口，不围绕未确认前提继续长篇推演。
不要猜测系统为何派你发言、其他成员为何没回复、你能否读取完整历史；只能描述当前确实提供给你的信息。不要冒充真人，也不必每轮声明自己的身份。
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
    return prefix, [f"{prefix}_a{index + 1}" for index in range(len(state.draft.agents))], f"{prefix}_team"


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
    for key, role in zip(agent_keys, draft.agents, strict=True):
        agents[key] = {
            "display_name": role.name,
            "role": role.responsibility,
            "model": model,
            "instructions": [
                context,
                role.behavior,
                "使用用户的语言回答。区分证据与假设，不冒充真实人类专家。可以直接回应其他成员的观点，但不要假称别人已经同意或回复。",
                _PROJECT_DISCUSSION_INSTRUCTIONS,
            ],
            "rooms": [room_key],
            "thread_mode": "thread",
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
    return {room_key: room}, agents, {team_key: team}


def _install_project_config(request: Request, state: WizardState, owner: str | None) -> None:
    """Commit room, agents and team together using the existing validated config writer."""
    config, _paths = config_lifecycle.read_committed_runtime_config(request)
    rooms, agents, teams = _project_config(state, config.router.model, owner)

    def mutate(candidate: dict[str, Any]) -> None:
        for section, entries in (("rooms", rooms), ("agents", agents), ("teams", teams)):
            target = candidate.setdefault(section, {})
            for key, value in entries.items():
                if key in target and target[key] != value:
                    raise HTTPException(409, "项目配置已被外部修改，请检查现有配置后重试。")
                target[key] = value

    config_lifecycle.write_committed_config(request, mutate, error_prefix="Failed to save project configuration")


async def _live_project_result(  # noqa: PLR0911
    state: WizardState,
    paths: RuntimePaths,
) -> ProjectResult | None:
    """Require every named Bot to run and actually join the room before claiming success."""
    assert state.draft is not None
    room_key, agent_keys, team_key = _project_keys(state)
    room = (await asyncio.to_thread(load_rooms, paths)).get(room_key)
    if room is None:
        return None
    health = get_matrix_sync_health_snapshot()
    if not {*agent_keys, team_key}.issubset(set(health.active_entities) - set(health.stale_entities)):
        return None
    identities = []
    for key in [*agent_keys, team_key, "user"]:
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
        for key, account, role in zip(agent_keys, identities, state.draft.agents, strict=False)
    ]
    return ProjectResult(
        project_id=str(state.draft_id),
        room_id=room.room_id,
        homeserver_url=runtime_matrix_homeserver(paths),
        team_user_id=identities[-2].user_id,
        sender_user_id=identities[-1].user_id,
        members=members,
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

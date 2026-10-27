"""Room opt-in and transcript-based limits; no coordinator chooses a speaker."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from mindroom.config.judgment import LLMJudgmentConfig
from mindroom.config.participation import ParticipationConfig
from mindroom.constants import ROUTER_AGENT_NAME
from mindroom.entity_resolution import entity_identity_registry
from mindroom.matrix.state import resolve_room_id
from mindroom.turn_origin import TurnIntent

if TYPE_CHECKING:
    from collections.abc import Sequence

    from mindroom.config.main import Config
    from mindroom.config.participation import PeerDiscussionConfig
    from mindroom.constants import RuntimePaths
    from mindroom.matrix.client_visible_messages import ResolvedVisibleMessage
    from mindroom.matrix.identity import MatrixID
    from mindroom.participation import ParticipationGate
    from mindroom.turn_origin import TurnOrigin

_PEER_PARTICIPATION_INSTRUCTIONS = (
    "This is an equal-peer group discussion, including humans and agents. You need not have spoken before. "
    "Decide for yourself whether you have a specific useful contribution NOW, after reading the latest messages. "
    "You may answer a peer's question, challenge an assumption, or add a missing relevant perspective without being tagged. "
    "Do not wait for a human to assign work. Nobody is the boss or mandatory facilitator. "
    "Stay silent when your point has been made, the question is for somebody else, the group awaits missing information, "
    "or the latest human asks to pause. Do not acknowledge just to take a turn or invent disagreement. "
    "If you respond, address the latest discussion rather than independently re-answering the original broad question."
)


def room_discussion(config: Config, paths: RuntimePaths, room_id: str) -> PeerDiscussionConfig | None:
    """Resolve opt-in only from the actual managed room's configuration."""
    return next(
        (room.peer_discussion for key, room in config.rooms.items() if resolve_room_id(key, paths) == room_id),
        None,
    )


def peer_participation(
    config: Config,
    paths: RuntimePaths,
    *,
    agent_name: str,
    room_id: str,
    thread_id: str | None,
) -> ParticipationConfig:
    """Every eligible peer uses its own reply model for its participation decision."""
    agent = config.agents[agent_name]
    own_id = entity_identity_registry(config, paths).current_id(agent_name).full_id
    model = config.resolve_runtime_model(
        entity_name=agent_name,
        room_id=room_id,
        thread_id=thread_id,
        runtime_paths=paths,
    ).model_name
    return ParticipationConfig(
        debounce_seconds=0,
        instructions=(
            f"You are {agent.display_name} ({own_id}). Your perspective: {agent.role}. "
            + _PEER_PARTICIPATION_INSTRUCTIONS
        ),
        judgment=LLMJudgmentConfig(provider="llm", model=model, timeout_seconds=30),
    )


def allows_peer_source(config: Config, paths: RuntimePaths, room_id: str, origin: TurnOrigin) -> bool:
    """Only configured individual peers may wake an opted-in discussion without tags."""
    return (
        origin.intent == TurnIntent.MANAGED_MESSAGE
        and origin.sender_entity_name in config.agents
        and room_discussion(config, paths, room_id) is not None
    )


def peer_action_kind(
    *,
    config: Config,
    paths: RuntimePaths,
    room_id: str,
    origin: TurnOrigin,
    agent_name: str,
    available: bool,
    mentioned: Sequence[MatrixID],
    am_i_mentioned: bool,
) -> Literal["individual", "skip"] | None:
    """Preserve explicit named-team requests; otherwise let authorized peers decide separately."""
    if room_discussion(config, paths, room_id) is None or origin.intent not in {
        TurnIntent.USER_MESSAGE,
        TurnIntent.MANAGED_MESSAGE,
    }:
        return None
    registry = entity_identity_registry(config, paths)
    named_team = any(registry.current_entity_name_for_user_id(mid.full_id) in config.teams for mid in mentioned)
    if named_team:
        return None if agent_name in config.teams and am_i_mentioned else "skip"
    if agent_name in config.agents and available and (not mentioned or am_i_mentioned):
        return "individual"
    return "skip"


def enforce_transcript_limits(
    gate: ParticipationGate | None,
    history: Sequence[ResolvedVisibleMessage],
    *,
    config: Config,
    paths: RuntimePaths,
    room_id: str,
    agent_name: str,
    source_event_ids: Sequence[str],
    history_unavailable: bool,
) -> None:
    """Apply transcript limits after refreshing history and before making any visible reply."""
    if gate is None or (settings := room_discussion(config, paths, room_id)) is None:
        return
    reason = (
        "peer_history_unavailable"
        if history_unavailable
        else _transcript_stop_reason(
            history,
            config=config,
            paths=paths,
            agent_name=agent_name,
            source_event_ids=source_event_ids,
            settings=settings,
        )
    )
    if reason is not None:
        gate.decline(reason)


def _transcript_stop_reason(  # noqa: PLR0911
    history: Sequence[ResolvedVisibleMessage],
    *,
    config: Config,
    paths: RuntimePaths,
    agent_name: str,
    source_event_ids: Sequence[str],
    settings: PeerDiscussionConfig,
) -> str | None:
    """Bound autonomous exchanges from visible history, including after restart."""
    registry = entity_identity_registry(config, paths)
    managed = {registry.current_id(name).full_id for name in [*config.agents, *config.teams, ROUTER_AGENT_NAME]}
    own_id = registry.current_id(agent_name).full_id
    messages = [message for message in history if message.body.strip()]
    sources = set(source_event_ids)
    source_index = max((index for index, message in enumerate(messages) if message.event_id in sources), default=-1)
    human_index = max((index for index, message in enumerate(messages) if message.sender not in managed), default=-1)
    if human_index < 0:
        return "peer_missing_human_anchor"
    if source_index < 0:
        return "peer_missing_source"
    if human_index > source_index:
        return "peer_newer_human_message"
    if any(message.sender == own_id for message in messages[source_index + 1 :]):
        return "peer_already_contributed"
    tail = messages[human_index + 1 :]
    if len(tail) >= settings.max_agent_turns:
        return "peer_turn_limit"
    if sum(message.sender == own_id for message in tail) >= settings.max_turns_per_agent:
        return "peer_member_turn_limit"
    if tail and tail[-1].sender == own_id:
        return "peer_wait_for_others"
    return None

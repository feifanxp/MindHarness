"""Peer discussion limits use the shared transcript rather than a leader's selection."""

import asyncio
from pathlib import Path

import pytest

from mindroom.config.agent import AgentConfig, RoomConfig
from mindroom.config.main import Config
from mindroom.config.participation import PeerDiscussionConfig
from mindroom.entity_resolution import entity_identity_registry
from mindroom.matrix.client_visible_messages import ResolvedVisibleMessage
from mindroom.peer_discussion.policy import _transcript_stop_reason
from mindroom.peer_discussion.runtime import speaking_slot
from tests.conftest import bind_runtime_paths, runtime_paths_for, test_runtime_paths


@pytest.fixture
def peer_config(tmp_path: Path) -> Config:
    """Two peers share one opted-in room."""
    return bind_runtime_paths(
        Config(
            agents={name: AgentConfig(display_name=name, rooms=["!room:localhost"]) for name in ("a", "b")},
            rooms={"!room:localhost": RoomConfig(peer_discussion=PeerDiscussionConfig(max_agent_turns=3))},
        ),
        test_runtime_paths(tmp_path),
    )


@pytest.mark.parametrize(
    ("speakers", "source", "reason"),
    [
        (["human"], 0, None),
        (["human", "b"], 0, None),
        (["human", "a", "b"], 0, "peer_already_contributed"),
        (["human", "b", "human"], 1, "peer_newer_human_message"),
        (["human", "b", "a", "b"], 3, "peer_turn_limit"),
        (["human", "a"], 1, "peer_wait_for_others"),
        (["b"], 0, "peer_missing_human_anchor"),
        (["human", "a", "b", "human"], 3, None),
    ],
)
def test_transcript_limits_survive_new_runtime(
    peer_config: Config,
    speakers: list[str],
    source: int,
    reason: str | None,
) -> None:
    """Only newer human messages reset the budget; old queued requests do not reply again."""
    paths = runtime_paths_for(peer_config)
    registry = entity_identity_registry(peer_config, paths)
    history = [
        ResolvedVisibleMessage.synthetic(
            sender="@person:localhost" if name == "human" else registry.current_id(name).full_id,
            body=f"message {index}",
            event_id=f"event-{index}",
        )
        for index, name in enumerate(speakers)
    ]
    assert (
        _transcript_stop_reason(
            history,
            config=peer_config,
            paths=paths,
            agent_name="a",
            source_event_ids=[f"event-{source}"],
            settings=PeerDiscussionConfig(max_agent_turns=3),
        )
        == reason
    )


@pytest.mark.asyncio
async def test_speaking_slot_serializes_peers_and_releases_on_cancel(tmp_path: Path) -> None:
    """Peers see the preceding committed answer; cancelling one waiter cannot strand others."""
    entered = asyncio.Event()
    release = asyncio.Event()
    order = []

    async def first() -> None:
        async with speaking_slot(tmp_path, "room", "thread", enabled=True):
            order.append("first")
            entered.set()
            await release.wait()

    async def next_peer(name: str) -> None:
        async with speaking_slot(tmp_path, "room", "thread", enabled=True):
            order.append(name)

    first_task = asyncio.create_task(first())
    await entered.wait()
    cancelled = asyncio.create_task(next_peer("cancelled"))
    final = asyncio.create_task(next_peer("last"))
    cancelled.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled
    assert order == ["first"]
    release.set()
    await asyncio.wait_for(asyncio.gather(first_task, final), timeout=1)
    assert order == ["first", "last"]


def test_one_peer_cannot_take_every_turn(peer_config: Config) -> None:
    """One member reaches its own ceiling before the room-wide budget is exhausted."""
    paths = runtime_paths_for(peer_config)
    registry = entity_identity_registry(peer_config, paths)
    history = [
        ResolvedVisibleMessage.synthetic(
            sender="@person:localhost" if name == "human" else registry.current_id(name).full_id,
            body=f"message {index}",
            event_id=f"event-{index}",
        )
        for index, name in enumerate(["human", "a", "b", "a", "b"])
    ]
    assert (
        _transcript_stop_reason(
            history,
            config=peer_config,
            paths=paths,
            agent_name="a",
            source_event_ids=["event-4"],
            settings=PeerDiscussionConfig(max_agent_turns=6, max_turns_per_agent=2),
        )
        == "peer_member_turn_limit"
    )

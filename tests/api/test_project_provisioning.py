"""Real provisioning readiness, retry, and local owner handoff regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import httpx
import nio
import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from mindroom.api import config_lifecycle, main
from mindroom.credentials.manager import get_runtime_shared_credentials_manager
from mindroom.matrix.users import AgentMatrixUser
from mindroom.project_wizard import chat_session, provisioning
from mindroom.project_wizard.models import ProjectResult, ProjectWizardDraft, WizardState
from mindroom.project_wizard.store import WizardStore


def _ready_state() -> WizardState:
    ident = uuid4()
    return WizardState(
        draft_id=ident,
        revision=1,
        status="proposal_ready",
        owner_user_id="@owner:example.org",
        draft=ProjectWizardDraft(
            draft_id=str(ident),
            revision=1,
            status="proposal_ready",
            project={"name": "Discussion", "goal": "Compare ideas"},
            collaboration={"mode": "parallel", "rationale": "Independent views"},
            agents=[{"name": "Researcher", "responsibility": "Research", "behavior": "Check evidence"}],
        ),
    )


def _request(test_client: TestClient) -> Request:
    return Request({"type": "http", "app": test_client.app})


def test_repeated_config_install_preserves_one_set_of_entities(test_client: TestClient) -> None:
    """A retry survives Pydantic normalization and does not duplicate configured entities."""
    state = _ready_state()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    paths = main._app_runtime_paths(test_client.app)
    first = paths.config_path.read_bytes()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    assert paths.config_path.read_bytes() == first
    config, _ = config_lifecycle.read_committed_runtime_config(_request(test_client))
    room_key, keys, team = provisioning._project_keys(state)
    assert config.agents[keys[0]].tool_names == []
    assert config.agents[keys[0]].include_default_tools is False
    assert config.teams[team].mode == "collaborate"
    assert config.agents[keys[0]].instructions[-1] == provisioning._PROJECT_DISCUSSION_INSTRUCTIONS
    assert config.teams[team].instructions == provisioning._PROJECT_TEAM_INSTRUCTIONS
    assert config.rooms[room_key].invite_users == [state.owner_user_id]
    assert config.rooms[room_key].peer_discussion is not None
    assert config.rooms[room_key].peer_discussion.max_agent_turns == 6


def test_reopen_refuses_committed_config_even_if_flag_write_was_lost(test_client: TestClient) -> None:
    """A crash after config commit cannot reopen a frozen plan into conflicting reused IDs."""
    state = _ready_state()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    state.status = "provision_failed"
    state.confirmation_key = uuid4()
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "standalone")
    store.save(state)
    response = test_client.post(
        f"/api/project-wizard/drafts/{state.draft_id}/reopen",
        json={"revision": 1, "idempotency_key": str(state.confirmation_key)},
    )
    assert response.status_code == 409
    assert store.read(state.draft_id).status == "provision_failed"


@pytest.mark.parametrize(("membership", "ready"), [("invite", True), ("join", True), ("leave", False)])
@pytest.mark.asyncio
async def test_ready_result_requires_owner_invitation(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    membership: str,
    ready: bool,
) -> None:
    """Bot membership alone never establishes that the user can enter the private room."""
    state = _ready_state()
    room_key, keys, team = provisioning._project_keys(state)
    paths = main._app_runtime_paths(test_client.app)
    accounts = {
        key: AgentMatrixUser(key, f"@{key}:example.org", key, None, access_token="test-session")  # noqa: S106
        for key in [*keys, team, "user"]
    }
    monkeypatch.setattr(provisioning, "load_rooms", lambda _: {room_key: SimpleNamespace(room_id="!room:example.org")})
    monkeypatch.setattr(
        provisioning,
        "get_matrix_sync_health_snapshot",
        lambda: SimpleNamespace(active_entities=[*keys, team], stale_entities=[]),
    )
    monkeypatch.setattr(provisioning, "load_agent_user", lambda key, _: accounts[key])
    client = AsyncMock(spec=nio.AsyncClient)
    client.joined_members.return_value = nio.JoinedMembersResponse(
        [nio.RoomMember(a.user_id, a.display_name, "") for a in accounts.values()],
        "!room:example.org",
    )
    client.room_get_state_event.return_value = nio.RoomGetStateEventResponse(
        {"membership": membership},
        "m.room.member",
        state.owner_user_id,
        "!room:example.org",
    )
    monkeypatch.setattr(provisioning, "create_agent_http_client", lambda *_: client)
    result = await provisioning._live_project_result(state, paths)
    assert (result is not None) is ready
    assert client.close.await_count == 2


def _created_state() -> WizardState:
    state = _ready_state()
    state.status = "created"
    state.result = ProjectResult(
        project_id=str(state.draft_id),
        room_id="!room:example.org",
        homeserver_url="http://localhost:8008",
        team_user_id="@team:example.org",
        sender_user_id="@user:example.org",
        members=[],
    )
    return state


@pytest.mark.asyncio
async def test_chat_handoff_only_authenticates_frozen_owner(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A configured owner login cannot be handed to a different upstream identity."""
    paths = main._app_runtime_paths(test_client.app)
    manager = get_runtime_shared_credentials_manager(paths)
    manager.save_credentials("project_chat_owner", {"user_id": "@owner:example.org", "password": "fixture-password"})
    client = Mock()
    monkeypatch.setattr(chat_session.httpx, "AsyncClient", client)
    with pytest.raises(HTTPException) as denied:
        await chat_session.create_chat_session(
            _created_state(),
            paths,
            {"user_id": "other", "matrix_user_id": "@other:example.org"},
        )
    assert denied.value.status_code == 403
    client.assert_not_called()


@pytest.mark.asyncio
async def test_chat_handoff_joins_room_and_returns_only_new_device_session(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Starting chat signs in the human owner, then joins the exact persisted room."""
    paths = main._app_runtime_paths(test_client.app)
    get_runtime_shared_credentials_manager(paths).save_credentials(
        "project_chat_owner",
        {"user_id": "@owner:example.org", "password": "fixture-password"},
    )
    client = AsyncMock(spec=httpx.AsyncClient)
    client.__aenter__.return_value = client
    client.post.side_effect = [
        httpx.Response(
            200,
            json={"user_id": "@owner:example.org", "access_token": "new-device-session", "device_id": "NEW"},
        ),
        httpx.Response(200, json={"room_id": "!room:example.org"}),
    ]
    monkeypatch.setattr(chat_session.httpx, "AsyncClient", lambda **_: client)
    result = await chat_session.create_chat_session(_created_state(), paths, {"user_id": "standalone"})
    assert result.user_id == "@owner:example.org"
    assert result.device_id == "NEW"
    assert result.room_id == "!room:example.org"
    assert client.post.call_args_list[1].args[0].endswith("%21room%3Aexample.org")


def test_selected_portraits_are_installed_before_runtime_reload(test_client: TestClient) -> None:
    """The Bot starts with the same bundled portrait as its candidate card."""
    state = _ready_state()
    assert state.draft is not None
    state.draft.agents[0].avatar_id = 2
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    _, keys, _ = provisioning._project_keys(state)
    paths = main._app_runtime_paths(test_client.app)
    assert (
        provisioning.workspace_avatar_path("agents", keys[0], paths).read_bytes()
        == provisioning.avatar_path(2).read_bytes()
    )

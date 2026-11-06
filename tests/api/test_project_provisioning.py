"""Real provisioning readiness, retry, and local owner handoff regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import nio
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from mindroom.api import config_lifecycle, main
from mindroom.matrix.users import AgentMatrixUser
from mindroom.project_wizard import provisioning
from mindroom.project_wizard.models import ProjectWizardDraft, WizardState
from mindroom.project_wizard.store import WizardStore

pytestmark = pytest.mark.usefixtures("discussion_login")


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
    scribe = f"{room_key}_scribe"
    assert config.agents[keys[0]].display_name == "Researcher（Research）"  # noqa: RUF001
    assert config.agents[scribe].display_name == "整理员"
    assert config.agents[keys[0]].tool_names == []
    assert config.agents[scribe].room_scribe
    assert config.agents[scribe].thread_mode == "room"
    assert scribe not in config.teams[team].agents
    assert config.agents[keys[0]].include_default_tools is False
    assert config.agents[keys[0]].thread_mode == "room"
    assert config.teams[team].mode == "collaborate"
    assert config.get_entity_thread_mode(team, paths) == "room"
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
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "@owner:example.org")
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
        for key in [*keys, f"{room_key}_scribe", team, "user"]
    }
    monkeypatch.setattr(provisioning, "load_rooms", lambda _: {room_key: SimpleNamespace(room_id="!room:example.org")})
    monkeypatch.setattr(
        provisioning,
        "get_matrix_sync_health_snapshot",
        lambda: SimpleNamespace(active_entities=[*keys, f"{room_key}_scribe", team], stale_entities=[]),
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
    if result is not None:
        assert result.scribe is not None
        assert result.scribe.agent_id == f"{room_key}_scribe"
        assert result.team_user_id == accounts[team].user_id
        assert len(result.members) == len(keys)
    assert client.close.await_count == 2


def test_chat_handoff_no_longer_issues_operator_credentials(test_client: TestClient) -> None:
    """Old clients must refresh and reuse their personal login."""
    assert test_client.post("/api/project-wizard/drafts/old/chat-session").status_code == 410


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


@pytest.mark.parametrize("installed_receipt", [True, False])
def test_delete_stops_only_this_project_and_preserves_other_config(
    test_client: TestClient,
    installed_receipt: bool,
) -> None:
    """Deletion also handles a config commit whose draft receipt was interrupted."""
    state = _ready_state()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    state.status = "created"
    state.config_installed = installed_receipt
    paths = main._app_runtime_paths(test_client.app)
    store = WizardStore(paths.storage_root, "@owner:example.org")
    store.save(state)
    before, _ = config_lifecycle.read_committed_runtime_config(_request(test_client))
    room, agents, team = provisioning._project_keys(state)
    response = test_client.request(
        "DELETE",
        f"/api/project-wizard/drafts/{state.draft_id}",
        json={"revision": state.revision},
    )
    assert response.status_code == 204
    after, _ = config_lifecycle.read_committed_runtime_config(_request(test_client))
    assert room not in after.rooms
    assert team not in after.teams
    assert set(after.agents) == set(before.agents) - {*agents, f"{room}_scribe"}
    assert after.models == before.models
    assert store.read(state.draft_id, include_deleted=True).messages == []


def test_created_discussion_can_be_renamed_and_archived_without_removing_bots(test_client: TestClient) -> None:
    """Room display names follow rename; archiving only changes the owner's navigation."""
    state = _ready_state()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    state.status = "created"
    state.config_installed = True
    paths = main._app_runtime_paths(test_client.app)
    WizardStore(paths.storage_root, "@owner:example.org").save(state)
    room, agents, _team = provisioning._project_keys(state)
    url = f"/api/project-wizard/drafts/{state.draft_id}"
    renamed = test_client.patch(url, json={"revision": state.revision, "name": "重新命名"})
    assert renamed.status_code == 200
    config, _ = config_lifecycle.read_committed_runtime_config(_request(test_client))
    assert config.rooms[room].display_name == "重新命名"
    archived = test_client.patch(url + "/archive", json={"revision": renamed.json()["revision"], "archived": True})
    assert archived.status_code == 200
    config, _ = config_lifecycle.read_committed_runtime_config(_request(test_client))
    assert set(agents).issubset(config.agents)


def test_delete_rejects_a_bot_shared_with_another_room(test_client: TestClient) -> None:
    """A project action must not stop a bot that an operator has reused elsewhere."""
    state = _ready_state()
    provisioning._install_project_config(_request(test_client), state, state.owner_user_id)
    state.status = "created"
    state.config_installed = True
    paths = main._app_runtime_paths(test_client.app)
    WizardStore(paths.storage_root, "@owner:example.org").save(state)
    _room, agents, _team = provisioning._project_keys(state)
    config_lifecycle.write_committed_config(
        _request(test_client),
        lambda data: data["agents"][agents[0]]["rooms"].append("!shared:localhost"),
        error_prefix="test",
    )
    before = paths.config_path.read_bytes()
    response = test_client.request(
        "DELETE",
        f"/api/project-wizard/drafts/{state.draft_id}",
        json={"revision": state.revision},
    )
    assert response.status_code == 409
    assert paths.config_path.read_bytes() == before
    assert test_client.get(f"/api/project-wizard/drafts/{state.draft_id}").status_code == 200

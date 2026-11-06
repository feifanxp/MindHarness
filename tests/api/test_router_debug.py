"""Discussion-owner authorization and temporary router settings endpoints."""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from mindroom.api import main
from mindroom.constants import RuntimePaths
from mindroom.project_wizard.models import ProjectResult, WizardState
from mindroom.project_wizard.store import WizardStore
from mindroom.router_debug.state import record_event, session_for

pytestmark = pytest.mark.usefixtures("discussion_login")


def create_discussion(client: TestClient, owner: str = "@owner:example.org") -> tuple[str, RuntimePaths]:
    """Create an owned real-room result without invoking Matrix provisioning."""
    paths = main._app_runtime_paths(client.app)
    state = WizardState(
        draft_id=uuid4(),
        status="created",
        result=ProjectResult(
            project_id="project",
            room_id="!debug:localhost",
            homeserver_url="http://localhost:8008",
            team_user_id="@team:localhost",
            sender_user_id="@owner:localhost",
            members=[],
        ),
    )
    WizardStore(paths.storage_root, owner).save(state)
    return f"/api/project-wizard/drafts/{state.draft_id}/router-debug", paths


def test_debug_lifecycle_and_config_is_unchanged(test_client: TestClient) -> None:
    """A temporary experiment never changes the saved runtime configuration."""
    endpoint, paths = create_discussion(test_client)
    original = paths.config_path.read_text()
    session_id = str(uuid4())
    opened = test_client.post(endpoint, json={"session_id": session_id, "start": True})
    assert opened.status_code == 200
    assert opened.headers["Cache-Control"] == "no-store"
    body = opened.json()
    assert body["settings"]["model"] is None
    assert body["configured"]["models"] == ["default"]
    record_event(paths, "!debug:localhost", "$message", "validation_failed", "invalid_response_format")
    observed = test_client.post(endpoint, json={"session_id": session_id}).json()
    assert observed["events"][0]["event_id"] == "$message"
    settings = {**body["settings"], "retries": 1, "model": "default"}
    applied = test_client.put(endpoint, json={"session_id": session_id, "revision": 0, "settings": settings})
    assert applied.status_code == 200
    assert applied.json()["revision"] == 1
    assert session_for(paths, "!debug:localhost").settings.retries == 1
    assert (
        test_client.put(endpoint, json={"session_id": session_id, "revision": 0, "settings": settings}).status_code
        == 409
    )
    assert paths.config_path.read_text() == original
    assert test_client.request("DELETE", endpoint, json={"session_id": session_id}).status_code == 200
    assert session_for(paths, "!debug:localhost") is None
    assert test_client.post(endpoint, json={"session_id": session_id}).status_code == 409


def test_other_owners_tabs_and_origins_cannot_change_debugger(test_client: TestClient) -> None:
    """Another identity, tab or origin cannot read or alter this session."""
    endpoint, paths = create_discussion(test_client)
    session_id = str(uuid4())
    opened = test_client.post(endpoint, json={"session_id": session_id, "start": True}).json()
    other, _ = create_discussion(test_client, "@other:example.org")
    assert test_client.post(other, json={"session_id": session_id, "start": True}).status_code == 404
    assert test_client.post(endpoint, json={"session_id": str(uuid4()), "start": True}).status_code == 409
    assert (
        test_client.put(
            endpoint,
            json={"session_id": str(uuid4()), "revision": 0, "settings": opened["settings"]},
        ).status_code
        == 409
    )
    test_client.request("DELETE", endpoint, json={"session_id": str(uuid4())})
    assert session_for(paths, "!debug:localhost") is not None
    assert (
        test_client.post(
            endpoint,
            headers={"Origin": "https://other.example"},
            json={"session_id": session_id},
        ).status_code
        == 403
    )
    test_client.request("DELETE", endpoint, json={"session_id": session_id})


def test_rejects_unknown_models_templates_and_uncreated_discussions(test_client: TestClient) -> None:
    """Invalid experiments are rejected before they reach live routing."""
    endpoint, _ = create_discussion(test_client)
    session_id = str(uuid4())
    settings = test_client.post(endpoint, json={"session_id": session_id, "start": True}).json()["settings"]
    for override in ({"model": "not-configured"}, {"prompt_template": "missing placeholders"}, {"retries": 5}):
        response = test_client.put(
            endpoint,
            json={"session_id": session_id, "revision": 0, "settings": {**settings, **override}},
        )
        assert response.status_code == 422
    draft = test_client.post("/api/project-wizard/drafts").json()
    assert (
        test_client.post(
            f"/api/project-wizard/drafts/{draft['draft_id']}/router-debug",
            json={"session_id": session_id, "start": True},
        ).status_code
        == 409
    )
    test_client.request("DELETE", endpoint, json={"session_id": session_id})


def test_rejects_test_mode_results(test_client: TestClient) -> None:
    """A saved test-mode result does not prove a real Matrix room exists."""
    endpoint, paths = create_discussion(test_client)
    draft_id = UUID(endpoint.split("/")[-2])
    store = WizardStore(paths.storage_root, "@owner:example.org")
    saved = store.read(draft_id)
    assert isinstance(saved.result, ProjectResult)
    saved.result.test_mode = True
    store.save(saved)
    response = test_client.post(endpoint, json={"session_id": str(uuid4()), "start": True})
    assert response.status_code == 409
    assert session_for(paths, "!debug:localhost") is None

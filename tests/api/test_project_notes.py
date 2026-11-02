"""Private project notes and explicitly requested extraction."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from mindroom.api import main, project_wizard
from mindroom.project_wizard.models import ProjectMember, ProjectResult, WizardState
from mindroom.project_wizard.store import WizardStore
from mindroom.room_scribe.models import Note, ScribeState
from mindroom.room_scribe.store import ScribeStore


def created(test_client: TestClient, owner: str = "standalone") -> WizardState:
    """Save a real created result under the chosen authenticated owner."""
    paths = main._app_runtime_paths(test_client.app)
    state = WizardState(
        draft_id=uuid4(),
        status="created",
        result=ProjectResult(
            project_id="project",
            room_id="!room:localhost",
            homeserver_url="http://localhost:8008",
            team_user_id="@team:localhost",
            sender_user_id="@owner:localhost",
            members=[],
            scribe=ProjectMember(agent_id="scribe", user_id="@scribe:localhost", name="Scribe", responsibility="Notes"),
        ),
    )
    WizardStore(paths.storage_root, owner).save(state)
    return state


def test_notes_are_owner_scoped_and_do_not_return_transcript(test_client: TestClient) -> None:
    """The API exposes note citations, but never another owner's draft or the raw cached messages."""
    state = created(test_client)
    paths = main._app_runtime_paths(test_client.app)
    saved = ScribeState(room_id="!room:localhost", sources=[{"body": "private transcript"}])
    saved.notes.items = [Note(id="one", category="idea", text="Useful idea", source_event_ids=["$source"])]
    ScribeStore(paths.storage_root, saved.room_id).save(saved)
    response = test_client.get(f"/api/project-wizard/drafts/{state.draft_id}/notes")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json()["items"][0]["source_event_ids"] == ["$source"]
    assert "private transcript" not in response.text
    other = created(test_client, "other-owner")
    assert test_client.get(f"/api/project-wizard/drafts/{other.draft_id}/notes").status_code == 404
    assert test_client.post(f"/api/project-wizard/drafts/{other.draft_id}/notes/refresh").status_code == 404


def test_refresh_refuses_disabled_scribe(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A saved result cannot resurrect an agent removed from live configuration."""
    state = created(test_client)
    run = AsyncMock()
    monkeypatch.setattr(project_wizard, "run_pass", run)
    assert test_client.post(f"/api/project-wizard/drafts/{state.draft_id}/notes/refresh").status_code == 409
    run.assert_not_awaited()


def test_uncreated_room_has_no_notes(test_client: TestClient) -> None:
    """Preparing discussions do not read arbitrary room storage."""
    state = test_client.post("/api/project-wizard/drafts").json()
    assert test_client.get(f"/api/project-wizard/drafts/{state['draft_id']}/notes").status_code == 409

"""Candidate profiles, owner selections and selected-only room provisioning."""

import json
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from mindroom.api import main, project_wizard
from mindroom.project_wizard.models import ProjectWizardAgentDraft, WizardState
from mindroom.project_wizard.provisioning import _project_config, _project_keys
from mindroom.project_wizard.store import WizardStore
from tests.api.test_project_wizard_api import install, proposal, saved


def test_old_draft_preserves_members() -> None:
    """Unreleased pre-selection drafts keep their original member and avatar behavior."""
    agent = ProjectWizardAgentDraft(name="Expert", responsibility="Research", behavior="Curious")
    assert agent.selected
    assert agent.avatar_id is None
    assert agent.expertise == ""


def test_saved_long_profiles_drop_retired_recommendation(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Existing saved roles keep their identities and instructions while dropping the retired pitch."""
    state = saved(test_client, monkeypatch)
    agent = state["draft"]["agents"][0]
    agent["responsibility"] = ("Long existing role description. " * 5).strip()
    agent["behavior"] = ("Preserve existing behavioral instructions. " * 4).strip()
    agent["recommendation"] = "Retired recommendation"
    agent.pop("expertise")
    agent["selected"] = False
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "standalone")
    (store.root / f"{state['draft_id']}.json").write_text(json.dumps(state))
    response = test_client.get(f"/api/project-wizard/drafts/{state['draft_id']}")
    assert response.status_code == 200
    restored = response.json()["draft"]["agents"][0]
    assert restored == {key: value for key, value in agent.items() if key != "recommendation"} | {"expertise": ""}
    assert "recommendation" not in ProjectWizardAgentDraft.model_json_schema()["properties"]


@pytest.mark.parametrize(
    ("field", "text"),
    [("expertise", ""), ("responsibility", "x" * 25), ("behavior", "x" * 25), ("expertise", "x" * 25)],
)
def test_generated_profiles_require_short_fields(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    text: str,
) -> None:
    """Reject verbose or incomplete generated cards without truncating or saving them."""
    draft = proposal().model_dump()
    draft["agents"][0][field] = text
    install(monkeypatch, {"message": "Candidates", "draft": draft})
    state = test_client.post("/api/project-wizard/drafts").json()
    response = test_client.post(
        f"/api/project-wizard/drafts/{state['draft_id']}/messages",
        json={"revision": 0, "message_id": str(uuid4()), "content": "讨论"},
    )
    assert response.status_code == 502


def test_generated_profiles_enforce_total_copy_budget(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Individually short fields must also fit the overall profile budget."""
    draft = proposal().model_dump()
    draft["agents"][0].update(responsibility="x" * 21, behavior="y" * 21, expertise="z" * 21)
    install(monkeypatch, {"message": "Candidates", "draft": draft})
    state = test_client.post("/api/project-wizard/drafts").json()
    response = test_client.post(
        f"/api/project-wizard/drafts/{state['draft_id']}/messages",
        json={"revision": 0, "message_id": str(uuid4()), "content": "讨论"},
    )
    assert response.status_code == 502


def test_match_profiles_and_selection_survive_refresh(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Candidate profiles and the chosen subset are saved together with a new revision."""
    state = saved(test_client, monkeypatch)
    candidates = state["draft"]["agents"]
    assert len(candidates) == 4
    assert sum(agent["selected"] for agent in candidates) == 3
    assert len({agent["avatar_id"] for agent in candidates}) == 4
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    names = [candidates[1]["name"], candidates[3]["name"]]
    result = test_client.patch(url + "/members", json={"revision": 1, "names": names})
    assert result.status_code == 200
    selected = result.json()
    assert selected["revision"] == selected["draft"]["revision"] == 2
    assert [agent["name"] for agent in selected["draft"]["agents"] if agent["selected"]] == names
    assert test_client.get(url).json() == selected
    assert test_client.patch(url + "/members", json={"revision": 2, "names": names}).json() == selected
    assert test_client.patch(url + "/members", json={"revision": 1, "names": []}).status_code == 409


@pytest.mark.parametrize("names", [["Unknown"], ["林悦", "林悦"]])
def test_selection_rejects_unknown_and_duplicate_candidates(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    names: list[str],
) -> None:
    """Selection cannot inject a new role or count one role twice."""
    state = saved(test_client, monkeypatch)
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    assert test_client.patch(url + "/members", json={"revision": 1, "names": names}).status_code == 422
    assert test_client.get(url).json() == state


def test_revised_profiles_preserve_choices_and_portraits(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model cannot undo a user's selection or change existing avatar identities."""
    state = saved(test_client, monkeypatch)
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    chosen = test_client.patch(url + "/members", json={"revision": 1, "names": ["陈墨"]}).json()
    revised = proposal()
    revised.agents.reverse()
    revised.agents[0].behavior = "Creative"
    install(monkeypatch, {"message": "Updated", "draft": revised.model_dump()})
    result = test_client.post(
        url + "/messages",
        json={"revision": 2, "message_id": str(uuid4()), "content": "调整性格"},
    )
    assert result.status_code == 200
    profiles = result.json()["draft"]["agents"]
    assert [agent["name"] for agent in profiles if agent["selected"]] == ["陈墨"]
    assert {agent["name"]: agent["avatar_id"] for agent in profiles} == {
        agent["name"]: agent["avatar_id"] for agent in chosen["draft"]["agents"]
    }


@pytest.mark.parametrize("count", [1, 3, 7])
def test_ready_model_output_requires_four_to_six_candidates(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    count: int,
) -> None:
    """A malformed candidate pool remains retryable instead of becoming a partial team."""
    draft = proposal().model_dump()
    draft["agents"] = [dict(draft["agents"][0], name=f"Person {i}") for i in range(count)]
    install(monkeypatch, {"message": "Candidates", "draft": draft})
    state = test_client.post("/api/project-wizard/drafts").json()
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    response = test_client.post(url + "/messages", json={"revision": 0, "message_id": str(uuid4()), "content": "讨论"})
    assert response.status_code == 502
    assert test_client.get(url).json()["draft"] is None


def test_provisioning_uses_selected_profiles_only(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Unselected candidates never enter agent configuration or team membership."""
    state = WizardState.model_validate(saved(test_client, monkeypatch))
    assert state.draft is not None
    for index, candidate in enumerate(state.draft.agents):
        candidate.selected = index in {1, 3}
    room_key, keys, team_key = _project_keys(state)
    rooms, agents, teams = _project_config(state, "default", "@owner:example.org")
    assert keys == [f"{room_key}_a2", f"{room_key}_a4"]
    assert list(agents) == [*keys, f"{room_key}_scribe"]
    assert teams[team_key]["agents"] == keys
    for key, candidate in zip(keys, state.draft.selected_agents, strict=True):
        assert agents[key]["display_name"] == candidate.name
        assert agents[key]["role"] == candidate.responsibility
        assert candidate.behavior in agents[key]["instructions"]
        assert f"擅长领域：{candidate.expertise}" in agents[key]["instructions"]  # noqa: RUF001
        assert state.draft.project.goal in agents[key]["instructions"][0]
    assert rooms[room_key]["invite_users"] == ["@owner:example.org"]


def test_frozen_selection_cannot_change(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A failed but already confirmed team remains frozen for safe provisioning retries."""
    state = saved(test_client, monkeypatch)
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "standalone")
    frozen = store.read(UUID(state["draft_id"]))
    frozen.status = "provision_failed"
    store.save(frozen)
    response = test_client.patch(
        f"/api/project-wizard/drafts/{state['draft_id']}/members",
        json={"revision": 1, "names": []},
    )
    assert response.status_code == 409


def test_avatar_library_serves_png_and_rejects_unknown_index(test_client: TestClient) -> None:
    """All candidate portraits are available without external image services."""
    for index in range(12):
        response = test_client.get(f"/api/project-wizard/avatars/{index}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/png"
        assert response.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert test_client.get("/api/project-wizard/avatars/12").status_code == 404


def test_first_ready_team_defaults_to_three_after_clarification() -> None:
    """Preliminary roles are not user selections before the picker is available."""
    early = proposal()
    early.collaboration.mode = "needs_clarification"
    early.agents = early.agents[:1]
    current = project_wizard._next_draft(None, early)
    ready = project_wizard._next_draft(current, proposal())
    assert ready is not None
    assert len(ready.selected_agents) == 3


def test_empty_selection_cannot_provision(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty saved selection is allowed for editing, but cannot create a room."""
    state = saved(test_client, monkeypatch)
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    assert test_client.patch(url + "/members", json={"revision": 1, "names": []}).status_code == 200
    monkeypatch.setattr(project_wizard, "preflight", lambda *_: "@owner:example.org")
    result = test_client.post(url + "/confirm", json={"revision": 2, "idempotency_key": str(uuid4())})
    assert result.status_code == 409
    assert test_client.get(url).json()["status"] == "proposal_ready"

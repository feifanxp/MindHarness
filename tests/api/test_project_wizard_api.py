"""Tests for durable project wizard and real provisioning boundary."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from mindroom.api import main, project_wizard
from mindroom.project_wizard.models import ConfirmRequest, ProjectWizardDraftContent, WizardState
from mindroom.project_wizard.provisioning import _project_config
from mindroom.project_wizard.store import WizardStore


def proposal(name: str = "项目") -> ProjectWizardDraftContent:
    """Build a bounded complementary-role proposal."""
    return ProjectWizardDraftContent(
        project={"name": name, "goal": "目标", "expected_outcomes": ["成果"], "constraints": [], "open_questions": []},
        collaboration={"mode": "parallel", "rationale": "多角度"},
        agents=[
            {"name": "林悦", "responsibility": "产品经理", "behavior": "求证", "expertise": "用户研究"},
            {"name": "陈墨", "responsibility": "教师", "behavior": "耐心", "expertise": "课程设计"},
            {"name": "苏青", "responsibility": "设计师", "behavior": "开放", "expertise": "交互设计"},
            {"name": "周衡", "responsibility": "工程师", "behavior": "务实", "expertise": "系统架构"},
        ],
    )


def install(monkeypatch: pytest.MonkeyPatch, content: object) -> SimpleNamespace:
    """Stub only model inference, retaining the real durable API."""
    agent = SimpleNamespace(arun=AsyncMock(return_value=SimpleNamespace(content=content)))
    monkeypatch.setattr(project_wizard, "Agent", lambda **_: agent)
    monkeypatch.setattr(project_wizard.model_loading, "get_model_instance", lambda *_: object())
    return agent


def saved(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Persist a draft and generate its initial plan through the API."""
    install(monkeypatch, {"message": "方案", "draft": proposal().model_dump()})
    state = client.post("/api/project-wizard/drafts").json()
    r = client.post(
        f"/api/project-wizard/drafts/{state['draft_id']}/messages",
        json={"revision": 0, "message_id": str(uuid4()), "content": "讨论"},
    )
    assert r.status_code == 200
    return r.json()


def test_persists_and_restores(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify persists and restores."""
    state = saved(test_client, monkeypatch)
    assert test_client.get(f"/api/project-wizard/drafts/{state['draft_id']}").json() == state
    assert test_client.get("/api/project-wizard/drafts/latest").json() == state


def test_stale_write_rejected(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify stale write rejected."""
    state = saved(test_client, monkeypatch)
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    assert test_client.patch(url, json={"revision": 1, "name": "新"}).status_code == 200
    assert test_client.patch(url, json={"revision": 1, "name": "旧"}).status_code == 409


def test_model_failure_keeps_user_turn(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify model failure keeps user turn."""
    state = test_client.post("/api/project-wizard/drafts").json()
    agent = install(monkeypatch, None)
    agent.arun.side_effect = TimeoutError()
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    r = test_client.post(url + "/messages", json={"revision": 0, "message_id": str(uuid4()), "content": "讨论"})
    assert r.status_code == 504
    assert len(test_client.get(url).json()["messages"]) == 1


def test_confirmation_requires_full_runtime(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify confirmation requires full runtime."""
    state = saved(test_client, monkeypatch)
    r = test_client.post(
        f"/api/project-wizard/drafts/{state['draft_id']}/confirm",
        json={"revision": 1, "idempotency_key": str(uuid4())},
    )
    assert r.status_code == 503
    assert "完整 MindRoom" in r.json()["detail"]


def test_retired_stateless_route_refuses_old_tabs(test_client: TestClient) -> None:
    """Verify retired stateless route refuses old tabs."""
    r = test_client.post("/api/project-wizard/chat", json={})
    assert r.status_code == 410


def test__project_config_has_no_model_tools(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify project config has no model tools."""
    state = saved(test_client, monkeypatch)

    _, agents, teams = _project_config(
        WizardState.model_validate(state),
        "default",
        "@owner:example.org",
    )
    assert all(agent["tools"] == [] for agent in agents.values())
    assert teams


def test_invalid_model_output_is_rejected(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify invalid model output is rejected."""
    state = test_client.post("/api/project-wizard/drafts").json()
    install(monkeypatch, {"message": "bad", "draft": {"permissions": ["admin"]}})
    r = test_client.post(
        f"/api/project-wizard/drafts/{state['draft_id']}/messages",
        json={"revision": 0, "message_id": str(uuid4()), "content": "bad"},
    )
    assert r.status_code == 502


def test_confirmation_schema_is_explicit() -> None:
    """Verify confirmation schema is explicit."""
    assert ConfirmRequest(revision=1, idempotency_key=uuid4()).revision == 1


def test_sidebar_rename_empty_draft_survives_generated_title(
    test_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A manual title works before a proposal exists and is not overwritten by the assistant."""
    state = test_client.post("/api/project-wizard/drafts").json()
    url = f"/api/project-wizard/drafts/{state['draft_id']}"
    renamed = test_client.patch(url, json={"revision": 0, "name": "我的讨论"})
    assert renamed.status_code == 200
    assert renamed.json()["display_name"] == "我的讨论"
    install(monkeypatch, {"message": "方案", "draft": proposal("模型建议标题").model_dump()})
    generated = test_client.post(url + "/messages", json={"revision": 1, "message_id": str(uuid4()), "content": "讨论"})
    assert generated.status_code == 200
    assert generated.json()["draft"]["project"]["name"] == "我的讨论"
    assert test_client.get("/api/project-wizard/drafts").json()[0]["name"] == "我的讨论"


def test_archive_restore_and_delete_never_restore_hidden_drafts(test_client: TestClient) -> None:
    """Archiving is reversible, deletion is idempotent, and neither becomes the latest active draft."""
    first = test_client.post("/api/project-wizard/drafts").json()
    second = test_client.post("/api/project-wizard/drafts").json()
    url = f"/api/project-wizard/drafts/{second['draft_id']}"
    archived = test_client.patch(url + "/archive", json={"revision": 0, "archived": True})
    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert [item["draft_id"] for item in test_client.get("/api/project-wizard/drafts").json()] == [first["draft_id"]]
    assert test_client.get("/api/project-wizard/drafts/latest").json()["draft_id"] == first["draft_id"]
    assert test_client.get("/api/project-wizard/drafts?archived=true").json()[0]["draft_id"] == second["draft_id"]
    assert test_client.patch(url + "/archive", json={"revision": 0, "archived": False}).status_code == 409
    restored = test_client.patch(url + "/archive", json={"revision": 1, "archived": False})
    assert restored.status_code == 200
    assert not restored.json()["archived"]
    assert test_client.request("DELETE", url, json={"revision": 1}).status_code == 409
    assert test_client.request("DELETE", url, json={"revision": 2}).status_code == 204
    assert test_client.request("DELETE", url, json={"revision": 2}).status_code == 204
    assert test_client.get(url).status_code == 404
    assert test_client.patch(url + "/archive", json={"revision": 3, "archived": False}).status_code == 404
    assert test_client.get("/api/project-wizard/drafts/latest").json()["draft_id"] == first["draft_id"]


def test_sidebar_actions_cannot_touch_another_owners_draft(test_client: TestClient) -> None:
    """All sidebar mutations share the owner-scoped store boundary."""
    other = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "another-owner").create()
    url = f"/api/project-wizard/drafts/{other.draft_id}"
    assert test_client.patch(url, json={"revision": 0, "name": "stolen"}).status_code == 404
    assert test_client.patch(url + "/archive", json={"revision": 0, "archived": True}).status_code == 404
    assert test_client.request("DELETE", url, json={"revision": 0}).status_code == 404


def test_delete_refuses_an_active_draft_operation(test_client: TestClient) -> None:
    """An active model/provisioning operation cannot race a sidebar deletion."""
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "standalone")
    state = store.create()
    with store.operation(state.draft_id):
        assert (
            test_client.request(
                "DELETE",
                f"/api/project-wizard/drafts/{state.draft_id}",
                json={"revision": 0},
            ).status_code
            == 409
        )
    assert test_client.get(f"/api/project-wizard/drafts/{state.draft_id}").status_code == 200


def test_all_archived_discussions_remain_discoverable_and_restorable(test_client: TestClient) -> None:
    """Archiving more than the recent-list limit never strands older discussions."""
    store = WizardStore(main._app_runtime_paths(test_client.app).storage_root, "standalone")
    states = [store.create() for _ in range(51)]
    for state in states:
        state.archived = True
        store.save(state)
    entries = test_client.get("/api/project-wizard/drafts?archived=true").json()
    assert len(entries) == 51
    oldest = next(entry for entry in entries if entry["draft_id"] == str(states[0].draft_id))
    result = test_client.patch(
        f"/api/project-wizard/drafts/{oldest['draft_id']}/archive",
        json={"revision": oldest["revision"], "archived": False},
    )
    assert result.status_code == 200
    assert test_client.get("/api/project-wizard/drafts").json()[0]["draft_id"] == oldest["draft_id"]

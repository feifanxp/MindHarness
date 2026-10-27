"""Tests for durable project wizard and real provisioning boundary."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from mindroom.api import project_wizard
from mindroom.project_wizard.models import ConfirmRequest, ProjectWizardDraftContent, WizardState
from mindroom.project_wizard.provisioning import _project_config


def proposal(name: str = "项目") -> ProjectWizardDraftContent:
    """Build a bounded complementary-role proposal."""
    return ProjectWizardDraftContent(
        project={"name": name, "goal": "目标", "expected_outcomes": ["成果"], "constraints": [], "open_questions": []},
        collaboration={"mode": "parallel", "rationale": "多角度"},
        agents=[
            {"name": "专家", "responsibility": "研究", "behavior": "求证"},
            {"name": "教师", "responsibility": "实践", "behavior": "说明限制"},
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

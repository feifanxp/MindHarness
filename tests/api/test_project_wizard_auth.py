"""Personal discussion identities cannot claim another account's drafts or operator access."""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi.testclient import TestClient

from mindroom import constants
from mindroom.api import main, project_wizard_auth
from mindroom.matrix_openid import MatrixOpenIDError
from mindroom.project_wizard.legacy_owners import migrate_standalone_drafts
from mindroom.project_wizard.store import WizardStore


def sign_in(client: TestClient, monkeypatch: pytest.MonkeyPatch, user: str) -> None:
    """Exchange a homeserver-verified identity through the production endpoint."""
    monkeypatch.setattr(project_wizard_auth, "verify_matrix_openid", AsyncMock(return_value=user))
    client.headers.update({"Origin": "http://localhost", "X-MindRoom-Discussion-User": user})
    result = client.post(
        "/api/project-wizard/session",
        json={
            "openid_token": {
                "access_token": "openid",
                "token_type": "Bearer",
                "matrix_server_name": "example.org",
                "expires_in": 300,
            },
        },
    )
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"]


def test_personal_identity_and_isolation(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Anonymous/operator identity cannot create drafts; Alice and Bob have disjoint lists."""
    test_client.headers["Origin"] = "http://localhost"
    assert test_client.post("/api/project-wizard/drafts").status_code == 401
    sign_in(test_client, monkeypatch, "@alice:example.org")
    draft = test_client.post("/api/project-wizard/drafts").json()
    assert draft["owner_user_id"] == "@alice:example.org"
    sign_in(test_client, monkeypatch, "@bob:example.org")
    assert test_client.get("/api/project-wizard/drafts").json() == []
    assert test_client.get(f"/api/project-wizard/drafts/{draft['draft_id']}").status_code == 404
    test_client.headers["X-MindRoom-Discussion-User"] = "@alice:example.org"
    assert test_client.get("/api/project-wizard/drafts").status_code == 401


def test_signout_and_origin(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Cross-origin mutations fail, and logout removes the personal session."""
    sign_in(test_client, monkeypatch, "@alice:example.org")
    test_client.headers["Origin"] = "https://other.example"
    assert test_client.post("/api/project-wizard/drafts").status_code == 403
    assert test_client.delete("/api/project-wizard/session").status_code == 403
    test_client.headers["Origin"] = "http://localhost"
    assert test_client.delete("/api/project-wizard/session").status_code == 200
    assert test_client.get("/api/project-wizard/drafts").status_code == 401


def test_session_does_not_grant_dashboard_access(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A discussion identity cannot replace the operator key on protected management endpoints."""
    paths = main._app_runtime_paths(test_client.app)
    paths = constants.resolve_primary_runtime_paths(
        config_path=paths.config_path,
        storage_path=paths.storage_root,
        process_env={"MINDROOM_API_KEY": "operator-key", "MATRIX_HOMESERVER": "http://localhost:8008"},
    )
    main.initialize_api_app(test_client.app, paths)
    sign_in(test_client, monkeypatch, "@alice:example.org")
    assert test_client.get("/api/project-wizard/session").status_code == 200
    assert test_client.get("/api/config/raw").status_code == 401


def test_invalid_openid(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """The claimed browser user cannot substitute for homeserver verification."""
    verifier = AsyncMock(side_effect=MatrixOpenIDError(401, "invalid proof"))
    monkeypatch.setattr(project_wizard_auth, "verify_matrix_openid", verifier)
    test_client.headers.update({"Origin": "http://localhost", "X-MindRoom-Discussion-User": "@alice:example.org"})
    response = test_client.post(
        "/api/project-wizard/session",
        json={
            "openid_token": {
                "access_token": "invalid",
                "token_type": "Bearer",
                "matrix_server_name": "example.org",
                "expires_in": 300,
            },
        },
    )
    assert response.status_code == 401
    assert not test_client.cookies


def test_legacy_owner_migration(tmp_path: Path) -> None:
    """Only the recorded owner or explicitly configured owner receives historical drafts."""
    legacy = WizardStore(tmp_path, "standalone")
    unassigned = legacy.create()
    owned = legacy.create()
    owned.owner_user_id = "@alice:example.org"
    legacy.save(owned)
    migrate_standalone_drafts(tmp_path, "@bob:example.org", None)
    assert not WizardStore(tmp_path, "@bob:example.org").root.exists()
    migrate_standalone_drafts(tmp_path, "@alice:example.org", None)
    assert WizardStore(tmp_path, "@alice:example.org").read(owned.draft_id).owner_user_id == owned.owner_user_id
    assert legacy.read(unassigned.draft_id)
    migrate_standalone_drafts(tmp_path, "@bob:example.org", "@bob:example.org")
    assert WizardStore(tmp_path, "@bob:example.org").read(unassigned.draft_id)
    migrate_standalone_drafts(tmp_path, "@bob:example.org", "@bob:example.org")
    assert not list(legacy.root.glob("*.json"))


def test_legacy_profiles_migrate_without_blocking_signin(tmp_path: Path) -> None:
    """Valid historical profile fields are normalized by the existing legacy reader."""
    legacy = WizardStore(tmp_path, "standalone")
    state = legacy.create("@alice:example.org")
    raw = state.model_dump(mode="json")
    raw["draft"] = {
        "draft_id": str(state.draft_id),
        "revision": 1,
        "status": "proposal_ready",
        "project": {"name": "Old", "goal": "Discuss", "expected_outcomes": [], "constraints": [], "open_questions": []},
        "collaboration": {"mode": "parallel", "rationale": "Views"},
        "agents": [
            {
                "name": "Helper",
                "responsibility": "Design",
                "behavior": "Careful",
                "expertise": "Research",
                "recommendation": "Old pitch",
            },
        ],
    }
    (legacy.root / f"{state.draft_id}.json").write_text(json.dumps(raw))
    migrate_standalone_drafts(tmp_path, "@alice:example.org", None)
    restored = WizardStore(tmp_path, "@alice:example.org").read(state.draft_id)
    assert restored.draft is not None
    assert restored.draft.agents[0].name == "Helper"


def test_expired_cookie_cannot_read_drafts(test_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Expired identity proof must be re-established before any personal read."""
    sign_in(test_client, monkeypatch, "@alice:example.org")
    cookie = jwt.encode(
        {"sub": "@alice:example.org", "exp": 1, "aud": "discussion"},
        project_wizard_auth._SESSION_KEY,
        algorithm="HS256",
    )
    test_client.cookies.clear()
    test_client.cookies.set("mindroom_discussion_session", cookie, path="/api/project-wizard")
    assert test_client.get("/api/project-wizard/drafts").status_code == 401


def test_existing_migration_target_is_preserved(tmp_path: Path) -> None:
    """A repeated migration cannot replace a newer personal draft with an old snapshot."""
    legacy = WizardStore(tmp_path, "standalone")
    state = legacy.create("@alice:example.org")
    target = WizardStore(tmp_path, "@alice:example.org")
    state.display_name = "Personal name"
    target.save(state)
    migrate_standalone_drafts(tmp_path, "@alice:example.org", None)
    assert target.read(state.draft_id).display_name == "Personal name"
    assert legacy.read(state.draft_id).display_name is None


def test_https_public_origin_sets_secure_cookie_behind_http_tunnel(
    test_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """TLS termination at the tunnel must not downgrade the personal session cookie."""
    paths = main._app_runtime_paths(test_client.app)
    paths = constants.resolve_primary_runtime_paths(
        config_path=paths.config_path, storage_path=paths.storage_root,
        process_env={"MINDROOM_PUBLIC_URL": "https://chat.example.org", "MATRIX_HOMESERVER": "http://localhost:8008"},
    )
    main.initialize_api_app(test_client.app, paths)
    monkeypatch.setattr(project_wizard_auth, "verify_matrix_openid", AsyncMock(return_value="@alice:example.org"))
    test_client.headers.update({"Origin": "https://chat.example.org", "X-MindRoom-Discussion-User": "@alice:example.org"})
    result = test_client.post("/api/project-wizard/session", json={"openid_token": {
        "access_token": "proof", "token_type": "Bearer", "matrix_server_name": "example.org", "expires_in": 300,
    }})
    assert result.status_code == 200
    assert "Secure" in result.headers["set-cookie"]

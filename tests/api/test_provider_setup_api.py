"""Tests for the first-run AI provider setup API."""

import json
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from mindroom import constants
from mindroom.api import main, provider_setup
from mindroom.api.main import app, initialize_api_app
from mindroom.config.main import Config
from mindroom.credentials.manager import CredentialsManager, get_runtime_credentials_manager
from mindroom.providers.model_loading import get_model_instance

_OPENROUTER_KEY = "sk-or-v1-secret-test-key"


def test_custom_chat_supports_new_token_limit_parameter(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry only an explicitly rejected legacy token-limit field, not arbitrary provider failures."""
    requests: list[dict[str, object]] = []

    def provider(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        if "max_tokens" in body:
            return httpx.Response(400, json={"error": {"param": "max_tokens", "message": "Unsupported parameter"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    _mock_provider(monkeypatch, provider)
    response = client.post(
        "/api/provider-setup/verify-custom",
        json={
            "protocol": "chat_completions",
            "base_url": "https://relay.example/v1",
            "model_id": "vendor-model",
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert response.status_code == 200
    assert len(requests) == 2
    assert requests[1]["max_completion_tokens"] == 16
    assert "max_tokens" not in requests[1]


@pytest.mark.parametrize(
    ("protocol", "field", "model_class"),
    [
        ("chat_completions", "choices", "MindRoomOpenAIChat"),
        ("responses", "output", "MindRoomOpenAIResponses"),
        ("anthropic", "content", "MindRoomAnthropicClaude"),
    ],
)
def test_custom_model_saved_through_dashboard_loads_own_key_and_transport(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    protocol: str,
    field: str,
    model_class: str,
) -> None:
    """The existing dashboard persistence APIs produce the same model used by real chat."""
    async_client = httpx.AsyncClient
    _mock_provider(monkeypatch, lambda _request: httpx.Response(200, json={field: [{"text": "OK"}]}))
    _credentials(client).save_credentials("openai", {"api_key": "official-key"})
    probe = client.post(
        "/api/provider-setup/verify-custom",
        json={
            "protocol": protocol,
            "base_url": "https://relay.example/v1",
            "model_id": "vendor-model",
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert probe.status_code == 200
    # SDK imports subclass AsyncClient, so restore the class after the HTTP probe.
    monkeypatch.setattr(provider_setup.httpx, "AsyncClient", async_client)
    key = client.post(
        "/api/credentials/model:relay/api-key",
        json={"service": "model:relay", "api_key": _OPENROUTER_KEY},
    )
    assert key.status_code == 200
    saved = client.put("/api/config/models/relay", json=probe.json())
    assert saved.status_code == 200
    config = main._app_context(client.app).runtime_config
    assert config is not None
    runtime_paths = main._app_runtime_paths(client.app)
    model = get_model_instance(config, runtime_paths, "relay")
    assert type(model).__name__ == model_class
    assert model.api_key == _OPENROUTER_KEY
    assert str(model.get_async_client().base_url).rstrip("/") == (
        "https://relay.example" if protocol == "anthropic" else "https://relay.example/v1"
    )
    assert _credentials(client).load_credentials("openai")["api_key"] == "official-key"
    assert _OPENROUTER_KEY not in runtime_paths.config_path.read_text()


@pytest.mark.parametrize(
    ("protocol", "base_url", "path", "field"),
    [
        ("chat_completions", "https://relay.example/v1/", "/v1/chat/completions", "choices"),
        ("responses", "https://relay.example/custom/v1", "/custom/v1/responses", "output"),
        ("anthropic", "https://relay.example/proxy/v1/", "/proxy/v1/messages", "content"),
    ],
)
def test_custom_provider_checks_selected_protocol_without_saving(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    protocol: str,
    base_url: str,
    path: str,
    field: str,
) -> None:
    """The probe uses only the supplied credentials and returns an explicit non-secret model config."""
    requests: list[httpx.Request] = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={field: [{"text": "OK"}]})

    _mock_provider(monkeypatch, provider)
    response = client.post(
        "/api/provider-setup/verify-custom",
        json={"protocol": protocol, "base_url": base_url, "model_id": "vendor-model", "api_key": _OPENROUTER_KEY},
    )
    assert response.status_code == 200
    assert len(requests) == 1
    outbound = requests[0]
    assert outbound.method == "POST"
    assert outbound.url.host == "relay.example"
    assert outbound.url.path == path
    assert json.loads(outbound.content)["model"] == "vendor-model"
    assert json.loads(outbound.content)["stream"] is False
    if protocol == "anthropic":
        assert outbound.headers["x-api-key"] == _OPENROUTER_KEY
        assert "authorization" not in outbound.headers
        assert response.json()["extra_kwargs"]["client_params"]["base_url"] == "https://relay.example/proxy"
        assert response.json()["provider"] == "anthropic"
    else:
        assert outbound.headers["authorization"] == f"Bearer {_OPENROUTER_KEY}"
        assert response.json()["api"] == protocol
    assert _OPENROUTER_KEY not in response.text
    assert _credentials(client).load_credentials("openai") is None
    assert _credentials(client).load_credentials("anthropic") is None


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "https://user:secret@relay.example/v1",
        "https://relay.example/v1?key=secret",
        "https://relay.example/v1/chat/completions",
    ],
)
def test_custom_provider_rejects_invalid_base_urls(client: TestClient, url: str) -> None:
    """Reject ambiguous endpoints and credentials embedded in URLs before making requests."""
    response = client.post(
        "/api/provider-setup/verify-custom",
        json={"protocol": "chat_completions", "base_url": url, "model_id": "model", "api_key": _OPENROUTER_KEY},
    )
    assert response.status_code == 422
    assert _OPENROUTER_KEY not in response.text
    assert "secret" not in response.text


@pytest.mark.parametrize("status", [302, 401, 403, 404, 429, 500])
def test_custom_provider_does_not_redirect_or_echo_provider_errors(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    status: int,
) -> None:
    """Keys are not forwarded through redirects or reflected from provider error bodies."""
    requests: list[httpx.Request] = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, headers={"location": "https://other.example"}, text=_OPENROUTER_KEY)

    _mock_provider(monkeypatch, provider)
    response = client.post(
        "/api/provider-setup/verify-custom",
        json={
            "protocol": "responses",
            "base_url": "https://relay.example/v1",
            "model_id": "model",
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert response.status_code == 400
    assert len(requests) == 1
    assert _OPENROUTER_KEY not in response.text


@pytest.mark.parametrize("body", ["<html>Not an API</html>", "{}", '{"choices": []}'])
def test_custom_provider_rejects_wrong_response(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    body: str,
) -> None:
    """HTTP 200 from a landing page is not a successful model probe."""
    _mock_provider(monkeypatch, lambda _request: httpx.Response(200, text=body))
    response = client.post(
        "/api/provider-setup/verify-custom",
        json={
            "protocol": "chat_completions",
            "base_url": "https://relay.example/v1",
            "model_id": "model",
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert response.status_code == 502


def _hosted_config() -> Config:
    """Mirror the hosted seed: one agent and the router on an OpenRouter default model."""
    return Config.model_validate(
        {
            "models": {
                "default": {"provider": "openrouter", "id": "google/gemini-3.8-flash"},
                "sonnet": {"provider": "anthropic", "id": "claude-sonnet-5"},
                "local": {"provider": "ollama", "id": "qwen3.8:27b"},
            },
            "agents": {"mind": {"display_name": "Mind", "role": "assistant", "model": "default"}},
        },
    )


def _publish_config(config: Config) -> None:
    context = main._app_context(app)
    context.config_data = config.authored_model_dump()
    context.runtime_config = config
    context.config_load_result = main.ConfigLoadResult(success=True)


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Create an API client with the hosted seed config committed."""
    initialize_api_app(
        app,
        constants.resolve_primary_runtime_paths(
            config_path=tmp_path / "config.yaml",
            storage_path=tmp_path / "mindroom_data",
            process_env={constants.OWNER_MATRIX_USER_ID_ENV: "@alice:example.org"},
        ),
    )
    _publish_config(_hosted_config())
    return TestClient(app, base_url="http://localhost")


def _credentials(client: TestClient) -> CredentialsManager:
    return get_runtime_credentials_manager(main._app_runtime_paths(client.app))


def _mock_provider(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        provider_setup.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )


def test_status_reports_provider_used_by_agents_without_key(client: TestClient) -> None:
    """The router and the Mind agent share the OpenRouter default model, which has no key yet."""
    response = client.get("/api/provider-setup/status")

    assert response.status_code == 200
    assert response.json() == {"missing": [{"provider": "openrouter", "models": ["default"]}]}


def test_status_accepts_key_saved_under_env_var_name(client: TestClient) -> None:
    """A key saved as ``OPENROUTER_API_KEY`` counts, exactly like runtime model loading."""
    _credentials(client).save_credentials("OPENROUTER_API_KEY", {"api_key": _OPENROUTER_KEY, "_source": "ui"})

    response = client.get("/api/provider-setup/status")

    assert response.json() == {"missing": []}


def test_status_accepts_per_model_key(client: TestClient) -> None:
    """A dashboard key saved for one model config satisfies that model."""
    _credentials(client).save_credentials("model:default", {"api_key": _OPENROUTER_KEY, "_source": "ui"})

    assert client.get("/api/provider-setup/status").json() == {"missing": []}


def test_status_accepts_key_in_model_config(client: TestClient) -> None:
    """An explicit ``extra_kwargs.api_key`` satisfies the model, like at runtime."""
    config = _hosted_config()
    config.models["default"].extra_kwargs = {"api_key": _OPENROUTER_KEY}
    _publish_config(config)

    assert client.get("/api/provider-setup/status").json() == {"missing": []}


@pytest.mark.parametrize(
    "model",
    [
        {"provider": "anthropic", "id": "claude-sonnet-5", "extra_kwargs": {"auth_token": "anthropic-oauth-token"}},
        {"provider": "azure", "id": "gpt-6-astra", "extra_kwargs": {"azure_ad_token": "azure-ad-token"}},
        {"provider": "azure", "id": "gpt-6-astra", "extra_kwargs": {"azure_ad_token_provider": "token-provider"}},
        {"provider": "gemini", "id": "gemini-3.8-flash", "extra_kwargs": {"vertexai": True}},
        {"provider": "google", "id": "gemini-3.8-flash", "extra_kwargs": {"vertexai": True}},
        {"provider": "bedrock_claude", "id": "anthropic.claude-sonnet-5"},
        {"provider": "vertexai_claude", "id": "claude-sonnet-5"},
        {"provider": "codex", "id": "gpt-6-astra"},
        {"provider": "ollama", "id": "qwen3.8:27b"},
    ],
)
def test_status_accepts_non_api_key_authentication(client: TestClient, model: dict[str, object]) -> None:
    """Models authenticated by a token or a non-API-key runtime never ask for a provider key."""
    _publish_config(
        Config.model_validate(
            {
                "models": {"default": model},
                "agents": {"mind": {"display_name": "Mind", "role": "assistant", "model": "default"}},
            },
        ),
    )

    assert client.get("/api/provider-setup/status").json() == {"missing": []}


def _config_with_unknown_model_reference() -> Config:
    """Config validation allows the router and agents to name a model missing from ``models``."""
    return Config.model_validate(
        {
            "models": {"sonnet": {"provider": "openrouter", "id": "anthropic/claude-sonnet-5"}},
            "agents": {"mind": {"display_name": "Mind", "role": "assistant", "model": "ghost"}},
        },
    )


def test_status_skips_model_references_missing_from_models(client: TestClient) -> None:
    """An unknown model reference (here the implicit router ``default``) never breaks the status check."""
    _publish_config(_config_with_unknown_model_reference())

    response = client.get("/api/provider-setup/status")

    assert response.status_code == 200
    assert response.json() == {"missing": []}


def test_connect_succeeds_with_model_references_missing_from_models(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Saving a verified key still reports success when config names an unknown model."""
    _publish_config(_config_with_unknown_model_reference())
    _mock_provider(monkeypatch, lambda _request: httpx.Response(200, json={"data": {}}))

    response = client.post("/api/provider-setup/connect", json={"provider": "openrouter", "api_key": _OPENROUTER_KEY})

    assert response.status_code == 200
    assert response.json() == {"service": "openrouter", "missing": []}
    assert _credentials(client).load_credentials("openrouter") == {"api_key": _OPENROUTER_KEY, "_source": "ui"}


def test_status_ignores_unused_and_keyless_models(client: TestClient) -> None:
    """Unused models and providers without API keys never ask for setup."""
    config = _hosted_config()
    config.agents["mind"].model = "local"
    config.router.model = "local"
    _publish_config(config)

    assert client.get("/api/provider-setup/status").json() == {"missing": []}


def test_connect_verifies_key_and_saves_canonical_service(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A key the provider accepts is saved under ``openrouter`` as a UI credential."""
    requests: list[httpx.Request] = []

    def openrouter(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": {"label": "sk-or-v1-sec...key"}})

    _mock_provider(monkeypatch, openrouter)

    response = client.post(
        "/api/provider-setup/connect",
        json={"provider": "openrouter", "api_key": f"  {_OPENROUTER_KEY}\n"},
    )

    assert response.status_code == 200
    assert response.json() == {"service": "openrouter", "missing": []}
    assert _OPENROUTER_KEY not in response.text
    assert [(request.method, str(request.url)) for request in requests] == [
        ("GET", "https://openrouter.ai/api/v1/key"),
    ]
    assert requests[0].headers["Authorization"] == f"Bearer {_OPENROUTER_KEY}"
    assert _credentials(client).load_credentials("openrouter") == {"api_key": _OPENROUTER_KEY, "_source": "ui"}


def test_connect_anthropic_uses_models_endpoint_and_reports_remaining_openrouter_models(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An Anthropic key is saved, but the OpenRouter default model still needs its own key."""
    requests: list[httpx.Request] = []

    def anthropic(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"data": []})

    _mock_provider(monkeypatch, anthropic)

    response = client.post("/api/provider-setup/connect", json={"provider": "anthropic", "api_key": "sk-ant-test"})

    assert response.status_code == 200
    assert response.json() == {
        "service": "anthropic",
        "missing": [{"provider": "openrouter", "models": ["default"]}],
    }
    assert str(requests[0].url) == "https://api.anthropic.com/v1/models"
    assert requests[0].headers["x-api-key"] == "sk-ant-test"
    assert requests[0].headers["anthropic-version"] == "2023-06-01"


@pytest.mark.parametrize("status_code", [401, 403])
def test_connect_rejected_key_is_not_saved_or_echoed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    status_code: int,
) -> None:
    """A key the provider rejects returns a clear error and is never stored, logged, or echoed."""
    _mock_provider(monkeypatch, lambda _request: httpx.Response(status_code, json={"error": "invalid key"}))

    response = client.post("/api/provider-setup/connect", json={"provider": "openai", "api_key": _OPENROUTER_KEY})

    assert response.status_code == 400
    assert response.json() == {
        "detail": "OpenAI rejected this API key. Check that you copied the whole key and that it is active.",
    }
    assert _credentials(client).load_credentials("openai") is None
    captured = capsys.readouterr()
    assert _OPENROUTER_KEY not in caplog.text + captured.out + captured.err


def test_connect_reports_unreachable_provider_without_saving(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Network failures ask the user to retry and never store an unverified key."""

    def unreachable(request: httpx.Request) -> httpx.Response:
        message = "connection refused"
        raise httpx.ConnectError(message, request=request)

    _mock_provider(monkeypatch, unreachable)

    response = client.post("/api/provider-setup/connect", json={"provider": "openrouter", "api_key": _OPENROUTER_KEY})

    assert response.status_code == 502
    assert response.json() == {"detail": "Could not reach OpenRouter to verify the key. Try again in a moment."}
    assert _credentials(client).load_credentials("openrouter") is None


def test_connect_reports_provider_outage_without_saving(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Provider-side failures other than auth rejections are reported as temporary."""
    _mock_provider(monkeypatch, lambda _request: httpx.Response(503))

    response = client.post("/api/provider-setup/connect", json={"provider": "openrouter", "api_key": _OPENROUTER_KEY})

    assert response.status_code == 502
    assert "HTTP 503" in response.json()["detail"]
    assert _credentials(client).load_credentials("openrouter") is None


def test_connect_rejects_blank_key_and_unknown_provider(client: TestClient) -> None:
    """Blank keys and providers outside the setup list never reach a provider."""
    blank = client.post("/api/provider-setup/connect", json={"provider": "openrouter", "api_key": "   "})
    unknown = client.post("/api/provider-setup/connect", json={"provider": "groq", "api_key": "gsk-test"})

    assert blank.status_code == 400
    assert blank.json() == {"detail": "Paste an API key first."}
    assert unknown.status_code == 422


@pytest.mark.parametrize("protocol", ["chat_completions", "responses", "anthropic"])
def test_discover_catalog_uses_protocol_and_never_saves(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    protocol: str,
) -> None:
    """Discovery is a read-only catalog request, not a paid inference call."""
    requests: list[httpx.Request] = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"data": [{"id": "z"}, {"id": "a", "display_name": "Alpha"}, {"id": "z"}, {}, {"id": 5}]},
        )

    _mock_provider(monkeypatch, provider)
    response = client.post(
        "/api/provider-setup/discover-models",
        json={
            "name": "relay",
            "base_url": "https://relay.example/proxy/v1/",
            "protocol": protocol,
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert response.status_code == 200
    assert [model["id"] for model in response.json()["models"]] == ["a", "z"]
    assert response.json()["models"][0]["credentials_service"] == "custom-provider:relay:key"
    assert requests[0].url.path == "/proxy/v1/models"
    assert requests[0].method == "GET"
    if protocol == "anthropic":
        assert requests[0].headers["x-api-key"] == _OPENROUTER_KEY
        assert response.json()["models"][0]["extra_kwargs"] == {
            "client_params": {"base_url": "https://relay.example/proxy"},
        }
    else:
        assert requests[0].headers["authorization"] == f"Bearer {_OPENROUTER_KEY}"
    assert _OPENROUTER_KEY not in response.text
    assert _credentials(client).load_credentials("custom-provider:relay:key") is None


def test_discover_anthropic_pagination(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Anthropic cursors stay on the same trusted endpoint."""
    cursors = []

    def provider(request: httpx.Request) -> httpx.Response:
        cursors.append(request.url.params.get("after_id"))
        if len(cursors) == 1:
            return httpx.Response(200, json={"data": [{"id": "a"}], "has_more": True, "last_id": "a"})
        return httpx.Response(200, json={"data": [{"id": "b"}], "has_more": False})

    _mock_provider(monkeypatch, provider)
    result = client.post(
        "/api/provider-setup/discover-models",
        json={"name": "relay", "base_url": "https://relay.example", "protocol": "anthropic", "api_key": "test-key"},
    )
    assert result.status_code == 200
    assert cursors == [None, "a"]
    assert len(result.json()["models"]) == 2
    assert not result.json()["truncated"]


@pytest.mark.parametrize(
    ("status", "body"),
    [(401, {"error": _OPENROUTER_KEY}), (404, {}), (302, {}), (200, {"models": []})],
)
def test_discover_rejects_errors_without_echoing_secrets(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    status: int,
    body: dict,
) -> None:
    """Neither redirects nor malformed catalog responses can appear successful."""
    requests = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, json=body, headers={"Location": "https://other.example/models"})

    _mock_provider(monkeypatch, provider)
    result = client.post(
        "/api/provider-setup/discover-models",
        json={
            "name": "relay",
            "base_url": "https://relay.example/v1",
            "protocol": "responses",
            "api_key": _OPENROUTER_KEY,
        },
    )
    assert result.status_code in {400, 502}
    assert _OPENROUTER_KEY not in result.text
    assert len(requests) == 1


def test_discover_saved_key_only_for_its_configured_endpoint(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank key can sync a saved provider but cannot forward its secret elsewhere."""
    model = {
        "provider": "openai",
        "id": "a",
        "api": "responses",
        "credentials_service": "custom-provider:relay:key",
        "extra_kwargs": {"base_url": "https://relay.example/v1"},
    }
    assert client.put("/api/config/models/relay-a", json=model).status_code == 200
    assert (
        client.post(
            "/api/credentials/custom-provider:relay:key/api-key",
            json={"service": "custom-provider:relay:key", "api_key": _OPENROUTER_KEY},
        ).status_code
        == 200
    )
    requests = []

    def provider(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["authorization"] == f"Bearer {_OPENROUTER_KEY}"
        return httpx.Response(200, json={"data": [{"id": "b"}]})

    _mock_provider(monkeypatch, provider)
    payload = {"name": "relay", "base_url": "https://relay.example/v1", "protocol": "responses"}
    assert client.post("/api/provider-setup/discover-models", json=payload).status_code == 200
    payload["base_url"] = "https://other.example/v1"
    assert client.post("/api/provider-setup/discover-models", json=payload).status_code == 409
    payload["base_url"] = "https://relay.example/v1"
    payload["protocol"] = "chat_completions"
    assert client.post("/api/provider-setup/discover-models", json=payload).status_code == 409
    assert len(requests) == 1


@pytest.mark.parametrize("protocol", ["chat_completions", "responses", "anthropic"])
def test_shared_provider_key_loads_and_rotates_for_every_model(client: TestClient, protocol: str) -> None:
    """Runtime models share live credentials, never the official provider's key."""
    service = "custom-provider:relay:key"
    provider = "anthropic" if protocol == "anthropic" else "openai"
    _credentials(client).save_credentials(provider, {"api_key": "official-key"})
    for name in ("a", "b"):
        model = {
            "provider": provider,
            "id": name,
            "credentials_service": service,
            "api": None if protocol == "anthropic" else protocol,
            "extra_kwargs": {"client_params": {"base_url": "https://relay.example"}}
            if protocol == "anthropic"
            else {"base_url": "https://relay.example/v1"},
        }
        assert client.put(f"/api/config/models/relay-{name}", json=model).status_code == 200
    config = main._app_context(client.app).runtime_config
    assert config is not None
    paths = main._app_runtime_paths(client.app)
    with pytest.raises(ValueError, match="Missing API key"):
        get_model_instance(config, paths, "relay-a")
    assert provider_setup.missing_model_api_key_provider(config, paths, "relay-a") == service
    for key in ("initial-key", "rotated-key"):
        assert (
            client.post(f"/api/credentials/{service}/api-key", json={"service": service, "api_key": key}).status_code
            == 200
        )
        for name in ("a", "b"):
            runtime = get_model_instance(config, paths, f"relay-{name}")
            assert runtime.api_key == key
            assert str(runtime.get_async_client().base_url).startswith("https://relay.example")
            assert provider_setup.missing_model_api_key_provider(config, paths, f"relay-{name}") is None
    assert "rotated-key" not in paths.config_path.read_text()

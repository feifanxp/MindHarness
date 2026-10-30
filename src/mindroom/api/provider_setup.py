"""First-run AI provider setup for the dashboard.

Reports which provider keys the configured router, agents, and teams still need,
and saves a pasted provider key only after the provider accepts it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from mindroom.api import config_lifecycle
from mindroom.api.credentials import save_dashboard_api_key
from mindroom.config.models import ModelConfig
from mindroom.credentials.manager import get_runtime_shared_credentials_manager
from mindroom.logging_config import get_logger
from mindroom.model_defaults import OPENROUTER_BASE_URL_DEFAULT
from mindroom.providers.model_loading import missing_model_api_key_provider

if TYPE_CHECKING:
    from mindroom.config.main import Config
    from mindroom.constants import RuntimePaths

logger = get_logger(__name__)

router = APIRouter(prefix="/api/provider-setup", tags=["provider-setup"])

_ConnectableProvider = Literal["openrouter", "anthropic", "openai"]

_KEY_CHECK_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class _ProviderKeyCheck:
    """One cheap, non-billable authenticated request that proves a key is valid."""

    label: str
    url: str
    header_name: str
    header_prefix: str = ""
    extra_headers: tuple[tuple[str, str], ...] = ()


_PROVIDER_KEY_CHECKS: dict[_ConnectableProvider, _ProviderKeyCheck] = {
    "openrouter": _ProviderKeyCheck(
        label="OpenRouter",
        url=f"{OPENROUTER_BASE_URL_DEFAULT}/key",
        header_name="Authorization",
        header_prefix="Bearer ",
    ),
    "anthropic": _ProviderKeyCheck(
        label="Anthropic",
        url="https://api.anthropic.com/v1/models",
        header_name="x-api-key",
        extra_headers=(("anthropic-version", "2023-06-01"),),
    ),
    "openai": _ProviderKeyCheck(
        label="OpenAI",
        url="https://api.openai.com/v1/models",
        header_name="Authorization",
        header_prefix="Bearer ",
    ),
}


class MissingProviderKey(BaseModel):
    """A provider the configured entities use without a resolvable API key."""

    provider: str
    models: list[str]


class ProviderSetupStatus(BaseModel):
    """Provider keys the configured router, agents, and teams still need."""

    missing: list[MissingProviderKey]


class ConnectProviderRequest(BaseModel):
    """A pasted provider API key to verify and save."""

    provider: _ConnectableProvider
    api_key: str


class ConnectProviderResponse(BaseModel):
    """Result of saving a verified provider key."""

    service: str
    missing: list[MissingProviderKey]


class CustomEndpointRequest(BaseModel):
    """Explicit endpoint, protocol and model for a third-party connection check."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, hide_input_in_errors=True)

    base_url: str = Field(min_length=1, max_length=2048)
    protocol: Literal["chat_completions", "responses", "anthropic"]

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        """Accept HTTP API roots without embedded credentials or request suffixes."""
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or any(character.isspace() for character in value)
        ):
            message = "Use an HTTP(S) API base URL without credentials, query parameters or fragments."
            raise ValueError(message)
        if parsed.path.rstrip("/").endswith(("/chat/completions", "/responses", "/messages")):
            message = "Enter the API base URL, not a full chat/completions, responses or messages endpoint."
            raise ValueError(message)
        return value.rstrip("/")


class CustomProviderRequest(CustomEndpointRequest):
    """One explicit model to verify."""

    api_key: str = Field(min_length=1, max_length=8192)
    model_id: str = Field(min_length=1, max_length=256)


class DiscoverModelsRequest(CustomEndpointRequest):
    """Provider connection with an optional replacement key."""

    name: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    api_key: str = Field(default="", max_length=8192)


class DiscoveredModels(BaseModel):
    """Non-secret configurations returned by a provider catalog."""

    models: list[ModelConfig]
    truncated: bool = False


def _custom_model(
    base_url: str,
    protocol: Literal["chat_completions", "responses", "anthropic"],
    model_id: str,
    service: str,
) -> ModelConfig:
    return ModelConfig(
        provider="anthropic" if protocol == "anthropic" else "openai",
        id=model_id,
        credentials_service=service,
        api=None if protocol == "anthropic" else protocol,
        extra_kwargs=(
            {"client_params": {"base_url": base_url.removesuffix("/v1")}}
            if protocol == "anthropic"
            else {"base_url": base_url}
        ),
    )


def _custom_catalog_key(request: Request, payload: DiscoverModelsRequest, service: str) -> str:
    config, runtime_paths = config_lifecycle.read_committed_runtime_config(request)
    template = _custom_model(payload.base_url, payload.protocol, "", service)
    saved = [model for model in config.models.values() if model.credentials_service == service]
    if any(
        model.provider != template.provider
        or model.api != template.api
        or _custom_endpoint(model) != _custom_endpoint(template)
        for model in saved
    ):
        raise HTTPException(
            status_code=409,
            detail="This provider name belongs to another URL or protocol. Use a new provider name.",
        )
    api_key = payload.api_key
    if not api_key and saved:
        credentials = get_runtime_shared_credentials_manager(runtime_paths).load_credentials(service)
        api_key = credentials.get("api_key", "") if credentials else ""
    if not api_key:
        raise HTTPException(status_code=400, detail="Enter an API key for this provider.")
    return api_key


def _custom_endpoint(model: ModelConfig) -> object:
    kwargs = model.extra_kwargs or {}
    if model.provider == "anthropic":
        params = kwargs.get("client_params", {})
        return params.get("base_url") if isinstance(params, dict) else None
    return kwargs.get("base_url")


def _catalog_page(response: httpx.Response, template: ModelConfig) -> tuple[list[ModelConfig], bool, str | None]:
    if not response.is_success:
        raise HTTPException(
            status_code=400,
            detail=f"Could not fetch models (HTTP {response.status_code}). Check the URL, key and provider catalog support.",
        )
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="The provider did not return a JSON model list.") from None
    if not isinstance(data, dict) or not isinstance(data.get("data"), list):
        raise HTTPException(status_code=502, detail="The provider returned an invalid model list.")
    models = []
    for item in data["data"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            continue
        model_id = item["id"].strip()
        if not model_id or len(model_id) > 256:
            continue
        model = template.model_copy(update={"id": model_id})
        if isinstance(item.get("display_name"), str):
            model.display_name = item["display_name"]
        models.append(model)
    cursor = data.get("last_id")
    return models, bool(data.get("has_more")), cursor if isinstance(cursor, str) else None


@router.post("/discover-models", response_model=DiscoveredModels, response_model_exclude_none=True)
async def discover_custom_models(request: Request, payload: DiscoverModelsRequest) -> DiscoveredModels:
    """Fetch a catalog without inference; reuse keys only for their saved endpoint."""
    service = f"custom-provider:{payload.name}:key"
    api_key = _custom_catalog_key(request, payload, service)
    template = _custom_model(payload.base_url, payload.protocol, "", service)
    anthropic = payload.protocol == "anthropic"
    endpoint = f"{payload.base_url.removesuffix('/v1')}/v1/models" if anthropic else f"{payload.base_url}/models"
    headers = (
        {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        if anthropic
        else {"Authorization": f"Bearer {api_key}"}
    )
    models: dict[str, ModelConfig] = {}
    params: dict[str, str] = {}
    cursors: set[str] = set()
    truncated = False
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            for _ in range(20):
                response = await client.get(endpoint, headers=headers, params=params)
                page, has_more, cursor = _catalog_page(response, template)
                models.update((model.id, model) for model in page)
                if len(models) > 5000:
                    truncated = True
                    break
                if not has_more:
                    break
                if not anthropic or not cursor or cursor in cursors:
                    truncated = True
                    break
                cursors.add(cursor)
                params = {"after_id": cursor}
            else:
                truncated = True
    except (httpx.HTTPError, httpx.InvalidURL):
        raise HTTPException(
            status_code=502,
            detail="Could not reach the provider. Check the API base URL and retry.",
        ) from None
    return DiscoveredModels(models=sorted(models.values(), key=lambda model: model.id)[:5000], truncated=truncated)


@router.post("/verify-custom", response_model=ModelConfig, response_model_exclude_none=True)
async def verify_custom_provider(payload: CustomProviderRequest) -> ModelConfig:
    """Check one short real inference request; return non-secret config, without saving."""
    base_url = payload.base_url
    headers = {"Authorization": f"Bearer {payload.api_key}"}
    body: dict[str, object] = {"model": payload.model_id, "stream": False}
    if payload.protocol == "anthropic":
        # Anthropic SDKs append /v1/messages; accept the common pasted /v1 root too.
        base_url = base_url.removesuffix("/v1")
        endpoint = f"{base_url}/v1/messages"
        headers = {"x-api-key": payload.api_key, "anthropic-version": "2023-06-01"}
        body.update(messages=[{"role": "user", "content": "Reply with OK."}], max_tokens=16)
    elif payload.protocol == "responses":
        endpoint = f"{base_url}/responses"
        body.update(input="Reply with OK.", max_output_tokens=16)
    else:
        endpoint = f"{base_url}/chat/completions"
        body.update(messages=[{"role": "user", "content": "Reply with OK."}], max_tokens=16)
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            response = await client.post(endpoint, headers=headers, json=body)
            # Some OpenAI-compatible models require the newer token-limit field.
            if payload.protocol == "chat_completions" and response.status_code == 400:
                try:
                    error_body = response.json()
                except ValueError:
                    error_body = {}
                error = error_body.get("error") if isinstance(error_body, dict) else None
                if isinstance(error, dict) and error.get("param") == "max_tokens":
                    body["max_completion_tokens"] = body.pop("max_tokens")
                    response = await client.post(endpoint, headers=headers, json=body)
    except (httpx.HTTPError, httpx.InvalidURL):
        raise HTTPException(
            status_code=502,
            detail="Could not reach the custom API. Check the base URL and try again.",
        ) from None
    if not response.is_success:
        raise HTTPException(
            status_code=400,
            detail=f"Custom API check failed (HTTP {response.status_code}). Check the URL, key, model ID and protocol.",
        )
    try:
        result = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="The custom API did not return a JSON model response.") from None
    result_field = {"chat_completions": "choices", "responses": "output", "anthropic": "content"}[payload.protocol]
    if not isinstance(result, dict) or not isinstance(result.get(result_field), list) or not result[result_field]:
        raise HTTPException(status_code=502, detail="The custom API response does not match the selected protocol.")
    return ModelConfig(
        provider="anthropic" if payload.protocol == "anthropic" else "openai",
        id=payload.model_id,
        api=None if payload.protocol == "anthropic" else payload.protocol,
        extra_kwargs=(
            {"client_params": {"base_url": base_url}} if payload.protocol == "anthropic" else {"base_url": base_url}
        ),
    )


def _entity_model_names(config: Config) -> list[str]:
    """Return the model names used by the router, agents, and teams, in first-use order."""
    names = [config.router.model]
    names.extend(agent.model for agent in config.agents.values())
    names.extend(team.model for team in config.teams.values() if team.model is not None)
    return list(dict.fromkeys(names))


def _missing_provider_keys(config: Config, runtime_paths: RuntimePaths) -> list[MissingProviderKey]:
    models_by_provider: dict[str, list[str]] = {}
    for model_name in _entity_model_names(config):
        provider = missing_model_api_key_provider(config, runtime_paths, model_name)
        if provider is not None:
            models_by_provider.setdefault(provider, []).append(model_name)
    return [MissingProviderKey(provider=provider, models=models) for provider, models in models_by_provider.items()]


async def _verify_provider_key(provider: _ConnectableProvider, api_key: str) -> None:
    """Raise an HTTP error unless the provider accepts the key. Never logs or echoes the key."""
    check = _PROVIDER_KEY_CHECKS[provider]
    headers = {check.header_name: f"{check.header_prefix}{api_key}", **dict(check.extra_headers)}
    try:
        async with httpx.AsyncClient(timeout=_KEY_CHECK_TIMEOUT_SECONDS) as client:
            response = await client.get(check.url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("provider_key_check_unreachable", provider=provider, error_type=type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach {check.label} to verify the key. Try again in a moment.",
        ) from None
    if response.status_code in {401, 403}:
        logger.info("provider_key_check_rejected", provider=provider, status_code=response.status_code)
        raise HTTPException(
            status_code=400,
            detail=f"{check.label} rejected this API key. Check that you copied the whole key and that it is active.",
        )
    if response.is_error:
        logger.warning("provider_key_check_failed", provider=provider, status_code=response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"{check.label} could not verify the key right now (HTTP {response.status_code}). Try again shortly.",
        )


@router.get("/status")
async def get_provider_setup_status(request: Request) -> ProviderSetupStatus:
    """Report provider keys that the configured router, agents, and teams cannot resolve."""
    config, runtime_paths = config_lifecycle.read_committed_runtime_config(request)
    return ProviderSetupStatus(missing=_missing_provider_keys(config, runtime_paths))


@router.post("/connect")
async def connect_provider(request: Request, payload: ConnectProviderRequest) -> ConnectProviderResponse:
    """Verify a provider key with the provider, then save it under the canonical provider service."""
    api_key = payload.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Paste an API key first.")
    await _verify_provider_key(payload.provider, api_key)
    service = save_dashboard_api_key(request, payload.provider, api_key)
    logger.info("provider_key_connected", provider=payload.provider)
    config, runtime_paths = config_lifecycle.read_committed_runtime_config(request)
    return ConnectProviderResponse(
        service=service,
        missing=_missing_provider_keys(config, runtime_paths),
    )

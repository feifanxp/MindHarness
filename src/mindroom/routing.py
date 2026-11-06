"""Simple AI routing for MindRoom responders."""

from __future__ import annotations

import asyncio
from time import perf_counter
from typing import TYPE_CHECKING

from agno.agent import Agent
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from mindroom.agent_descriptions import describe_agent
from mindroom.constants import ROUTER_AGENT_NAME
from mindroom.entity_resolution import entity_identity_registry
from mindroom.helper_usage import record_system_usage
from mindroom.logging_config import get_logger
from mindroom.matrix.client_visible_messages import ResolvedVisibleMessage, replace_visible_message
from mindroom.matrix.identity import MatrixID
from mindroom.providers import model_loading
from mindroom.router_debug.state import current_settings, record_selection
from mindroom.routing_judgment import ResponderSelection, judge_responder
from mindroom.tool_system.events import body_without_tool_markers

if TYPE_CHECKING:
    from collections.abc import Sequence

    from mindroom.config.main import Config
    from mindroom.constants import RuntimePaths

logger = get_logger(__name__)


class _RoutingSuggestion(BaseModel):
    """Structured output for routing decisions."""

    model_config = ConfigDict(from_attributes=True)

    entity_name: str = Field(description="The name of the agent or team that should respond")
    reasoning: str = Field(description="Brief explanation of why this agent or team was chosen")


async def suggest_responder(
    message: str,
    available_entity_names: list[str],
    config: Config,
    runtime_paths: RuntimePaths,
    thread_context: Sequence[ResolvedVisibleMessage] | None = None,
    *,
    room_id: str | None = None,
    thread_id: str | None = None,
) -> ResponderSelection | None:
    """Use AI to suggest which configured responder should answer a message.

    This is the core routing logic, independent of any transport layer.

    Args:
        message: The user message to route.
        available_entity_names: Plain agent or team names (e.g. ["code", "research", "ops"]).
        config: Application configuration.
        runtime_paths: Explicit runtime context for model and Matrix identity resolution.
        thread_context: Optional recent messages for context.
            Each message should expose visible sender/body fields.
        room_id: Optional Matrix room whose runtime model default applies.
        thread_id: Optional Matrix thread whose model override takes precedence.

    Returns:
        An accepted selection (entity_name=None means no fit), or None if routing fails.

    """
    try:
        debug = current_settings()
        if config.router.judgment is not None and (debug is None or debug.strategy == "configured"):
            selection = await judge_responder(message, available_entity_names, config, runtime_paths, thread_context)
            record_selection("judgment", {"backend": config.router.judgment.provider, "result": selection})
            if selection is not None:
                return selection
        entity_descriptions = []
        for entity_name in available_entity_names:
            description = describe_agent(entity_name, config)
            entity_descriptions.append(f"{entity_name}:\n  {description}")

        agents_info = "\n\n".join(entity_descriptions)

        template = (debug.prompt_template if debug is not None else None) or config.get_prompt(
            "ROUTER_AGENT_SELECTION_PROMPT_TEMPLATE",
        )
        prompt = template.format(agents_info=agents_info, message=message)

        history_count = debug.history_messages if debug is not None else 3
        history_chars = debug.history_chars if debug is not None else 100
        if thread_context and history_count:
            context = f"{config.get_prompt('ROUTER_THREAD_CONTEXT_HEADER')}\n"
            for msg in thread_context[-history_count:]:
                sender = msg.sender
                body = body_without_tool_markers(msg.body, msg.content)[:history_chars]
                context += f"{sender}: {body}\n"
            prompt = context + "\n" + prompt

        router_model_name = config.resolve_runtime_model(
            entity_name=ROUTER_AGENT_NAME,
            room_id=room_id,
            thread_id=thread_id,
            runtime_paths=runtime_paths,
        ).model_name
        if debug is not None and debug.model is not None:
            router_model_name = debug.model

        model = model_loading.get_model_instance(config, runtime_paths, router_model_name)
        logger.info(
            "using_router_model",
            model_name=router_model_name,
            model_class=model.__class__.__name__,
            model_id=model.id,
        )

        agent = Agent(
            name="Router",
            role="Route messages to appropriate agents or teams",
            model=model,
            output_schema=_RoutingSuggestion,
            telemetry=False,
        )

        record_selection(
            "input",
            {
                "model_alias": router_model_name,
                "model_id": model.id,
                "candidates": available_entity_names,
                "available_history_messages": len(thread_context or ()),
                "used_history_messages": min(history_count, len(thread_context or ())),
                "prompt": prompt,
                "settings": debug.model_dump() if debug is not None else None,
            },
        )
        suggestion = await _select_with_validation(agent, prompt, available_entity_names, runtime_paths)
        if suggestion is None:
            return None

        logger.info("Routing decision", entity=suggestion.entity_name, reason=suggestion.reasoning)
    except Exception as e:
        record_selection("error", {"kind": type(e).__name__})
        logger.exception("Routing failed", error=str(e))
        return None
    else:
        return ResponderSelection(suggestion.entity_name)


async def _select_with_validation(
    agent: Agent,
    prompt: str,
    candidates: list[str],
    runtime_paths: RuntimePaths,
) -> _RoutingSuggestion | None:
    """Preserve normal routing; an active experiment may bound and retry validation."""
    debug = current_settings()
    retries = debug.retries if debug is not None else 0
    timeout = debug.timeout_seconds if debug is not None else None
    for attempt in range(retries + 1):
        started = perf_counter()
        record_selection("attempt", {"number": attempt + 1, "prompt": prompt})
        async with asyncio.timeout(timeout):
            response = await agent.arun(prompt, session_id="routing")
        await record_system_usage(response, runtime_paths=runtime_paths, kind="routing")
        record_selection(
            "output",
            {
                "attempt": attempt + 1,
                "latency_ms": round((perf_counter() - started) * 1000),
                "type": type(response.content).__name__,
                "content": response.content,
            },
        )
        failure = None
        try:
            suggestion = _RoutingSuggestion.model_validate(response.content)
        except ValidationError:
            failure = "invalid_response_format"
            logger.warning(
                "Unexpected response type from AI routing",
                expected="_RoutingSuggestion",
                actual=type(response.content).__name__,
            )
        else:
            if suggestion.entity_name in candidates:
                record_selection("selected", suggestion.model_dump())
                return suggestion
            failure = "invalid_candidate"
            logger.warning(
                "AI suggested invalid entity",
                suggested=suggestion.entity_name,
                available=candidates,
            )
        record_selection("validation_failed", {"reason": failure, "will_retry": attempt < retries})
        prompt += (
            "\nThe previous answer failed validation. Return one object with entity_name and reasoning. "
            f"entity_name must be one of: {', '.join(candidates)}."
        )
    return None


async def suggest_responder_for_message(
    message: str,
    available_entities: list[MatrixID],
    config: Config,
    runtime_paths: RuntimePaths,
    thread_context: Sequence[ResolvedVisibleMessage] | None = None,
    *,
    room_id: str | None = None,
    thread_id: str | None = None,
) -> str | None:
    """Use AI to suggest which configured responder should answer a message.

    Matrix-aware wrapper around suggest_responder() that converts MatrixID
    objects to plain responder names and resolves sender identities in
    thread context.
    """
    registry = entity_identity_registry(config, runtime_paths)
    entity_names = [
        name
        for mid in available_entities
        if (name := registry.current_entity_name_for_user_id(mid.full_id, include_router=False)) is not None
    ]

    # Resolve Matrix sender IDs to readable names for thread context
    resolved_context = None
    if thread_context:
        resolved_context = []
        for msg in thread_context:
            sender = msg.sender
            if sender.startswith("@") and ":" in sender:
                sender_name = registry.current_entity_name_for_user_id(sender)
                sender = sender_name if sender_name is not None else MatrixID.parse(sender).domain
            resolved_context.append(replace_visible_message(msg, sender=sender))

    selection = await suggest_responder(
        message,
        entity_names,
        config,
        runtime_paths,
        resolved_context,
        room_id=room_id,
        thread_id=thread_id,
    )

    return selection.entity_name if selection is not None else None


__all__ = [
    "ResponderSelection",
    "suggest_responder",
    "suggest_responder_for_message",
]

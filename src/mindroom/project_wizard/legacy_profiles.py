"""Read saved profiles written before compact teammate cards."""

from __future__ import annotations

from typing import cast


def discard_retired_recommendations(value: object) -> object:
    """Discard retired pitch copy while leaving current schema validation to the model."""
    # LEGACY_COMPAT: Saved teammate profiles with recommendation pitch text.
    # Legacy format: draft.agents entries contain recommendation, which is no longer part of the current profile.
    # Last legacy release: Unreleased writer a1535ec81; no tag contains this schema.
    # Handling: Drop only recommendation on persisted reads; preserve identities, choices, and role instructions.
    # Coverage: tests/api/test_project_teammates.py::test_saved_long_profiles_drop_retired_recommendation
    draft = cast("dict[str, object]", value).get("draft") if isinstance(value, dict) else None
    agents = cast("dict[str, object]", draft).get("agents") if isinstance(draft, dict) else None
    if isinstance(agents, list):
        for agent in cast("list[object]", agents):
            if isinstance(agent, dict):
                cast("dict[str, object]", agent).pop("recommendation", None)
    return value

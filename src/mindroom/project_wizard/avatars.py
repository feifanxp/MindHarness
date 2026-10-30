"""Bundled portraits shared by candidate cards and managed Matrix accounts."""

from pathlib import Path


def avatar_path(avatar_id: int) -> Path:
    """Resolve a validated avatar-library index without model-provided paths."""
    if not 0 <= avatar_id < 12:
        msg = "Avatar index must be between zero and eleven"
        raise ValueError(msg)
    return Path(__file__).with_name("avatars") / f"{avatar_id}.png"

"""Atomic snapshots and process-wide exclusion for automatic and manual passes."""

from __future__ import annotations

import hashlib
from contextlib import contextmanager
from typing import TYPE_CHECKING

from mindroom.durable_write import write_json_file_durable
from mindroom.file_locks import release_file_lock, try_exclusive_file_lock
from mindroom.room_scribe.models import ScribeState

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


class ScribeStore:
    """Room-scoped storage outside every worker workspace."""

    def __init__(self, storage_root: Path, room_id: str) -> None:
        """Use the immutable room ID, never user-controlled path segments."""
        self.room_id = room_id
        key = hashlib.sha256(room_id.encode()).hexdigest()
        self.path = storage_root / "tracking" / "room_scribe" / f"{key}.json"

    def read(self) -> ScribeState:
        """Load the last complete snapshot, including retryable pending messages."""
        if not self.path.exists():
            return ScribeState(room_id=self.room_id)
        return ScribeState.model_validate_json(self.path.read_text())

    def save(self, state: ScribeState) -> None:
        """Publish notes and their processed revisions together."""
        write_json_file_durable(self.path, state.model_dump(mode="json"))

    @contextmanager
    def operation(self) -> Iterator[bool]:
        """Do not let a manual refresh race the periodic worker."""
        lock = try_exclusive_file_lock(self.path.with_suffix(".lock"))
        try:
            yield lock is not None
        finally:
            if lock is not None:
                release_file_lock(lock)

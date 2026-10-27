"""FIFO speaking slots shared by peers; queued turns re-read history after acquisition."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING
from weakref import WeakValueDictionary

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from pathlib import Path

_slots: WeakValueDictionary[tuple[Path, str, str | None], asyncio.Lock] = WeakValueDictionary()


@asynccontextmanager
async def speaking_slot(
    storage_root: Path,
    room_id: str,
    thread_id: str | None,
    *,
    enabled: bool,
) -> AsyncIterator[None]:
    """Serialize eligible peers fairly without selecting their answers or identities."""
    if not enabled:
        yield
        return
    key = (storage_root, room_id, thread_id)
    lock = _slots.setdefault(key, asyncio.Lock())
    async with lock:
        yield

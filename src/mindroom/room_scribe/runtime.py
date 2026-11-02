"""Orchestrator-owned periodic room scribe lifecycle."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from mindroom.logging_config import get_logger
from mindroom.matrix.state import resolve_room_id
from mindroom.room_scribe.service import run_pass

if TYPE_CHECKING:
    from collections.abc import Callable

    from mindroom.config.main import Config
    from mindroom.constants import RuntimePaths

logger = get_logger(__name__)


@dataclass
class ScribeRunner:
    """Background work continues even when no browser has the room open."""

    paths: RuntimePaths
    config_provider: Callable[[], Config | None]
    task: asyncio.Task[None] | None = field(default=None, init=False)

    def start(self) -> None:
        """Start once; each pass reads the current configuration."""
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self.run(), name="room_scribe")

    async def stop(self) -> None:
        """Release network clients and operation locks before runtime shutdown."""
        if self.task is not None:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None

    async def run(self) -> None:
        """Keep temporary room or model failures from stopping other rooms."""
        while True:
            config = self.config_provider()
            if config is not None:
                for name, agent in config.agents.items():
                    if not agent.room_scribe:
                        continue
                    for room_key in agent.rooms:
                        room_id = resolve_room_id(room_key, self.paths)
                        if not room_id.startswith("!"):
                            continue
                        try:
                            await run_pass(config, self.paths, name, room_id)
                        except Exception:
                            logger.exception("Room scribe unavailable", agent=name, room_id=room_id)
            await asyncio.sleep(10)

"""Incremental homeserver reads, reduced with the shared visible-message rules."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import nio

from mindroom.matrix.client_visible_messages import (
    ResolvedVisibleMessage,
    ThreadEditCandidates,
    apply_latest_edits_to_messages,
    bundled_replacement_candidates,
    is_visible_room_message,
)
from mindroom.matrix.event_info import EventInfo
from mindroom.matrix.message_content import VisibleRoomMessage, extract_and_resolve_message

if TYPE_CHECKING:
    from collections.abc import Collection

    from mindroom.room_scribe.models import ScribeState


async def _scan(
    client: nio.AsyncClient,
    room_id: str,
    stop_id: str | None,
) -> tuple[list[nio.Event], bool]:
    events: list[nio.Event] = []
    token = None
    for _ in range(1000):
        response = await client.room_messages(
            room_id,
            start=token,
            limit=100,
            direction=nio.MessageDirection.back,
            message_filter={"types": ["m.room.message", "m.room.redaction"]},
        )
        if not isinstance(response, nio.RoomMessagesResponse):
            msg = "Room history is unavailable"
            raise RuntimeError(msg)  # noqa: TRY004 - a Matrix error response is a failed read
        for event in response.chunk:
            if event.event_id == stop_id:
                return events, True
            events.append(event)
        if not response.end or response.end == token:
            return events, False
        token = response.end
    msg = "Room history scan exceeded its page budget; progress was not advanced"
    raise RuntimeError(msg)


async def read_messages(
    client: nio.AsyncClient,
    state: ScribeState,
    *,
    trusted_sender_ids: Collection[str],
) -> list[ResolvedVisibleMessage]:
    """Read every speaker and thread, retaining only originals and their current valid edits.

    A redaction rebuilds from the homeserver so deleting an edit restores the surviving revision.
    Missing checkpoints (for example compacted edits) also rebuild rather than skipping history.
    """
    events, found = await _scan(client, state.room_id, state.last_event_id)
    if found and any(event.source.get("type") == "m.room.redaction" for event in events):
        events, found = await _scan(client, state.room_id, None)
    sources = [*state.sources, *(event.source for event in events)] if found else [event.source for event in events]
    originals: dict[str, VisibleRoomMessage] = {}
    edits = ThreadEditCandidates()
    for source in sources:
        for candidate in [source, *bundled_replacement_candidates(source)]:
            event = nio.Event.parse_event(candidate)
            if not is_visible_room_message(event):
                continue
            info = EventInfo.from_event(event.source)
            if not edits.record(event, event_info=info):
                originals[event.event_id] = event
    retained: list[dict[str, Any]] = []
    messages: dict[str, ResolvedVisibleMessage] = {}
    for event in originals.values():
        retained.append(event.source)
        edit = edits.winner_for(event.event_id, sender=event.sender)
        if edit is not None:
            retained.append(edit.source)
        data = await extract_and_resolve_message(event, client, trusted_sender_ids=trusted_sender_ids)
        messages[event.event_id] = ResolvedVisibleMessage.from_message_data(
            data,
            thread_id=EventInfo.from_event(event.source).thread_id,
            latest_event_id=event.event_id,
        )
    await apply_latest_edits_to_messages(
        client,
        messages_by_event_id=messages,
        edit_candidates=edits,
        synthesize_unseen_originals=False,
        trusted_sender_ids=trusted_sender_ids,
    )
    state.sources = retained
    if events:
        state.last_event_id = events[0].event_id
    return sorted(messages.values(), key=lambda message: (message.timestamp, message.event_id))

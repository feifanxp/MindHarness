"""Room-wide evidence, quiet extraction, replay, and correction regressions."""

import json
import time
from pathlib import Path
from unittest.mock import AsyncMock

import nio
import pytest

from mindroom.agent_reply_membership import AgentReplyMembershipIndex
from mindroom.authorization import is_sender_allowed_for_agent_reply_in_room
from mindroom.config.agent import AgentConfig
from mindroom.config.main import Config
from mindroom.constants import STREAM_STATUS_KEY
from mindroom.matrix import message_content
from mindroom.matrix.client_visible_messages import ResolvedVisibleMessage
from mindroom.room_scribe import service
from mindroom.room_scribe.history import read_messages
from mindroom.room_scribe.models import Note, NoteUpdate, ScribeState
from mindroom.room_scribe.store import ScribeStore
from tests.conftest import bind_runtime_paths, runtime_paths_for, test_runtime_paths

ROOM = "!room:localhost"


@pytest.fixture
def scribe_config(tmp_path: Path) -> Config:
    """Use real typed config and persisted bot identities."""
    return bind_runtime_paths(
        Config(agents={"scribe": AgentConfig(display_name="Scribe", room_scribe=True, rooms=[ROOM])}),
        test_runtime_paths(tmp_path),
    )


def message(event_id: str, body: str = "A useful idea") -> ResolvedVisibleMessage:
    """A completed ordinary message independent of any agent reply session."""
    return ResolvedVisibleMessage.synthetic(event_id=event_id, sender="@human:localhost", body=body)


def event(
    event_id: str,
    body: str,
    *,
    sender: str = "@human:localhost",
    timestamp: int = 1,
    **content: object,
) -> nio.Event:
    """Parse the same Matrix shape used by the production history reader."""
    parsed = nio.Event.parse_event(
        {
            "event_id": event_id,
            "type": "m.room.message",
            "sender": sender,
            "origin_server_ts": timestamp,
            "content": {"msgtype": "m.text", "body": body, **content},
        },
    )
    assert isinstance(parsed, nio.Event)
    return parsed


def page(*events: nio.Event) -> nio.RoomMessagesResponse:
    """One terminal page, returned newest first."""
    return nio.RoomMessagesResponse(ROOM, list(events), "start")


def note(*sources: str, ident: str = "note") -> Note:
    """A note with explicit provenance."""
    return Note(id=ident, category="idea", text="Compare both approaches", source_event_ids=list(sources))


@pytest.mark.usefixtures("enforce_turn_authorization")
def test_scribe_cannot_answer_even_an_administrator(scribe_config: Config) -> None:
    """Scribes are excluded from the shared reply/candidate authorization seam."""
    scribe_config.administrators = ["@human:localhost"]
    assert not is_sender_allowed_for_agent_reply_in_room(
        "@human:localhost",
        "scribe",
        scribe_config,
        ROOM,
        runtime_paths_for(scribe_config),
        AgentReplyMembershipIndex(),
    )


@pytest.mark.asyncio
async def test_whole_room_reads_people_bots_threads_and_final_edits() -> None:
    """Stream edits count once; thread replies and otherwise unanswered humans are included."""
    root = event("$root", "Budget is 100")
    bot = event("$bot", "Thinking", sender="@bot:localhost", **{STREAM_STATUS_KEY: "streaming"})
    reply = event("$reply", "Compare options", **{"m.relates_to": {"rel_type": "m.thread", "event_id": "$root"}})
    edit = event(
        "$edit",
        "* Final suggestion",
        sender="@bot:localhost",
        timestamp=2,
        **{
            "m.relates_to": {"rel_type": "m.replace", "event_id": "$bot"},
            "m.new_content": {"msgtype": "m.text", "body": "Final suggestion", STREAM_STATUS_KEY: "completed"},
        },
    )
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.side_effect = [page(reply, bot, root), page(edit, reply)]
    state = ScribeState(room_id=ROOM)
    initial = await read_messages(client, state, trusted_sender_ids={"@bot:localhost"})
    assert len(initial) == 3
    assert len(service._reconcile(state, initial)) == 2
    final = await read_messages(client, state, trusted_sender_ids={"@bot:localhost"})
    assert len(final) == 3
    assert next(item for item in final if item.event_id == "$bot").body == "Final suggestion"
    assert len(service._reconcile(state, final)) == 3
    assert len(state.sources) == 4


@pytest.mark.asyncio
async def test_foreign_edit_cannot_rewrite_a_source() -> None:
    """Only the original speaker's replacements affect extracted facts."""
    root = event("$root", "Budget is 100")
    edit = event(
        "$edit",
        "* Budget is 900",
        sender="@other:localhost",
        timestamp=2,
        **{
            "m.relates_to": {"rel_type": "m.replace", "event_id": "$root"},
            "m.new_content": {"msgtype": "m.text", "body": "Budget is 900"},
        },
    )
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.return_value = page(edit, root)
    messages = await read_messages(client, ScribeState(room_id=ROOM), trusted_sender_ids=())
    assert [item.body for item in messages] == ["Budget is 100"]


@pytest.mark.asyncio
async def test_empty_filtered_page_does_not_drop_older_history() -> None:
    """Matrix can return an empty page with a continuation token before the checkpoint."""
    client = AsyncMock(spec=nio.AsyncClient)
    old = event("$old", "Retain this fact")
    new = event("$new", "Another fact", timestamp=2)
    client.room_messages.side_effect = [
        page(old),
        nio.RoomMessagesResponse(ROOM, [new], "latest", "middle"),
        nio.RoomMessagesResponse(ROOM, [], "middle", "older"),
        page(old),
    ]
    state = ScribeState(room_id=ROOM)
    await read_messages(client, state, trusted_sender_ids=())
    messages = await read_messages(client, state, trusted_sender_ids=())
    assert [item.event_id for item in messages] == ["$old", "$new"]


@pytest.mark.asyncio
async def test_redaction_rebuilds_history_and_removes_notes() -> None:
    """Deleting original evidence drops both its note and the overview before new inference."""
    root = event("$root", "A private detail")
    redaction = nio.Event.parse_event(
        {
            "event_id": "$redaction",
            "type": "m.room.redaction",
            "sender": "@human:localhost",
            "origin_server_ts": 2,
            "content": {},
            "redacts": "$root",
        },
    )
    assert isinstance(redaction, nio.Event)
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.side_effect = [page(root), page(redaction, root), page(redaction)]
    state = ScribeState(room_id=ROOM)
    initial = await read_messages(client, state, trusted_sender_ids=())
    service._apply_update(
        state,
        NoteUpdate(overview="Private detail", upserts=[note("$root", ident="")]),
        service._extraction_batch(state, initial),
        1,
    )
    current = await read_messages(client, state, trusted_sender_ids=())
    service._reconcile(state, current)
    assert state.notes.items == []
    assert state.notes.overview == ""
    assert state.sources == []


def test_correction_requeues_surviving_multi_source_context() -> None:
    """A changed source invalidates a claim and re-extracts its other supporting message."""
    state = ScribeState(room_id=ROOM)
    original = [message("$a"), message("$b"), message("$c")]
    service._apply_update(
        state,
        NoteUpdate(upserts=[note("$a", "$b", ident="")]),
        service._extraction_batch(state, original),
        1,
    )
    corrected = message("$a", "Correction")
    corrected.latest_event_id = "$edit"
    pending = service._reconcile(state, [corrected, *original[1:]])
    assert {item.event_id for item in pending} == {"$a", "$b"}
    assert not state.notes.items


def test_patch_preserves_omitted_notes_and_rejects_invented_sources() -> None:
    """The model cannot drop history by omission or cite an event it was never shown."""
    state = ScribeState(room_id=ROOM)
    service._apply_update(
        state,
        NoteUpdate(upserts=[note("$a", ident="")]),
        service._extraction_batch(state, [message("$a")]),
        1,
    )
    saved = state.model_dump()
    with pytest.raises(ValueError, match="citations"):
        service._apply_update(
            state,
            NoteUpdate(upserts=[note("$invented", ident="")]),
            service._extraction_batch(state, [message("$b")]),
            2,
        )
    assert state.model_dump() == saved
    service._apply_update(state, NoteUpdate(), service._extraction_batch(state, [message("$b")]), 3)
    assert len(state.notes.items) == 1
    assert state.notes.updated_at == 1
    assert state.notes.checked_at == 3
    assert service._reconcile(state, [message("$a"), message("$b")]) == []


@pytest.mark.asyncio
async def test_quiet_trigger_force_and_restart_dedup(scribe_config: Config, monkeypatch: pytest.MonkeyPatch) -> None:
    """A single human message can be summarized, while active chat is deferred and restarts do not repeat it."""
    paths = runtime_paths_for(scribe_config)
    client = AsyncMock(spec=nio.AsyncClient)
    source = event("$a", "Useful", timestamp=int(time.time() * 1000))
    client.room_messages.return_value = page(source)
    _extract = AsyncMock(return_value=NoteUpdate(upserts=[note("$a", ident="")]))
    monkeypatch.setattr(service, "create_agent_http_client", lambda *_: client)
    monkeypatch.setattr(service, "_extract", _extract)
    result = await service.run_pass(scribe_config, paths, "scribe", ROOM)
    assert result.pending_messages == 1
    _extract.assert_not_awaited()
    result = await service.run_pass(scribe_config, paths, "scribe", ROOM, force=True)
    assert len(result.items) == 1
    assert result.status == "ready"
    await service.run_pass(scribe_config, paths, "scribe", ROOM, force=True)
    _extract.assert_awaited_once()
    client.room_send.assert_not_awaited()


@pytest.mark.asyncio
async def test_failure_does_not_advance_progress(scribe_config: Config, monkeypatch: pytest.MonkeyPatch) -> None:
    """Failed inference is retried from the same evidence, without deleting previous results."""
    paths = runtime_paths_for(scribe_config)
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.return_value = page(event("$a", "Useful"))
    _extract = AsyncMock(side_effect=[TimeoutError(), NoteUpdate(upserts=[note("$a", ident="")])])
    monkeypatch.setattr(service, "create_agent_http_client", lambda *_: client)
    monkeypatch.setattr(service, "_extract", _extract)
    first = await service.run_pass(scribe_config, paths, "scribe", ROOM)
    assert first.status == "error"
    assert ScribeStore(paths.storage_root, ROOM).read().processed == {}
    second = await service.run_pass(scribe_config, paths, "scribe", ROOM)
    assert second.status == "ready"
    assert len(second.items) == 1


@pytest.mark.asyncio
async def test_edit_during_inference_does_not_publish_stale_note(
    scribe_config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Slow model calls cannot resurrect a message corrected while inference was running."""
    paths = runtime_paths_for(scribe_config)
    client = AsyncMock(spec=nio.AsyncClient)
    original = event("$a", "Old")
    edit = event(
        "$edit",
        "* New",
        timestamp=2,
        **{
            "m.relates_to": {"rel_type": "m.replace", "event_id": "$a"},
            "m.new_content": {"msgtype": "m.text", "body": "New"},
        },
    )
    client.room_messages.side_effect = [page(original), page(edit, original)]
    _extract = AsyncMock(return_value=NoteUpdate(upserts=[note("$a", ident="")]))
    monkeypatch.setattr(service, "create_agent_http_client", lambda *_: client)
    monkeypatch.setattr(service, "_extract", _extract)
    result = await service.run_pass(scribe_config, paths, "scribe", ROOM)
    assert not result.items
    assert result.status == "waiting"


def test_manual_and_background_pass_share_one_lock(tmp_path: Path) -> None:
    """The API and runner coordinate even when they use separate store objects."""
    store = ScribeStore(tmp_path, ROOM)
    with store.operation() as first:
        assert first
        with ScribeStore(tmp_path, ROOM).operation() as second:
            assert not second
    with store.operation() as next_pass:
        assert next_pass


def test_long_messages_resume_after_restart_and_allow_following_messages(tmp_path: Path) -> None:
    """A long message is sliced without losing text or permanently blocking later evidence."""
    store = ScribeStore(tmp_path, ROOM)
    state = store.read()
    messages = [message("$long", "a" * 80_010), message("$next", "Last message")]
    slices = []
    for _ in range(3):
        batch = service._extraction_batch(state, service._reconcile(state, messages))
        slices.extend(part.body for part in batch.messages)
        service._apply_update(state, NoteUpdate(), batch, 1)
        store.save(state)
        state = store.read()
    assert "".join(slices) == messages[0].body + messages[1].body
    assert set(state.processed) == {"$long", "$next"}
    assert not state.partial


@pytest.mark.asyncio
async def test_sidecar_full_text_is_extracted_and_missing_download_is_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    """Long-message previews never count as successfully processed full messages."""
    source = event(
        "$long",
        "Preview",
        **{
            "msgtype": "m.file",
            "url": "mxc://localhost/text",
            "io.mindroom.long_text": {"version": 2, "encoding": "matrix_event_content_json"},
        },
    )
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.return_value = page(source)
    download = AsyncMock(
        side_effect=[None, json.dumps({"msgtype": "m.text", "body": "Full important conclusion"}).encode()],
    )
    monkeypatch.setattr(message_content, "download_mxc_bytes", download)
    state = ScribeState(room_id=ROOM)
    pending = service._reconcile(state, await read_messages(client, state, trusted_sender_ids=()))
    assert pending == []
    assert state.notes.pending_messages == 1
    assert not state.processed
    pending = service._reconcile(state, await read_messages(client, state, trusted_sender_ids=()))
    assert [item.body for item in pending] == ["Full important conclusion"]
    assert download.await_count == 2


def test_unchanged_sidecar_download_failure_preserves_saved_evidence() -> None:
    """Temporary inability to read the same revision cannot erase an already grounded note."""
    state = ScribeState(room_id=ROOM)
    resolved = message("$long", "Full important conclusion")
    service._apply_update(
        state,
        NoteUpdate(overview="Summary", upserts=[note("$long", ident="")]),
        service._extraction_batch(state, [resolved]),
        1,
    )
    unresolved = message("$long", "Preview")
    unresolved.content = {
        "msgtype": "m.file",
        "url": "mxc://localhost/text",
        "io.mindroom.long_text": {"version": 2, "encoding": "matrix_event_content_json"},
    }
    assert service._reconcile(state, [unresolved]) == []
    assert len(state.notes.items) == 1
    assert state.notes.overview == "Summary"
    unresolved.latest_event_id = "$changed"
    service._reconcile(state, [unresolved])
    assert not state.notes.items
    assert not state.notes.overview


@pytest.mark.asyncio
async def test_prior_evidence_change_during_inference_invalidates_overview(
    scribe_config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A model overview cannot repeat changed evidence from a previous batch."""
    paths = runtime_paths_for(scribe_config)
    store = ScribeStore(paths.storage_root, ROOM)
    state = store.read()
    old = event("$old", "Old decision")
    new = event("$new", "New idea", timestamp=2)
    edit = event(
        "$edit",
        "* Corrected",
        timestamp=3,
        **{
            "m.relates_to": {"rel_type": "m.replace", "event_id": "$old"},
            "m.new_content": {"msgtype": "m.text", "body": "Corrected"},
        },
    )
    client = AsyncMock(spec=nio.AsyncClient)
    client.room_messages.side_effect = [page(old), page(new, old), page(edit, new)]
    original = await read_messages(client, state, trusted_sender_ids=())
    service._apply_update(
        state,
        NoteUpdate(upserts=[note("$old", ident="")]),
        service._extraction_batch(state, original),
        1,
    )
    store.save(state)
    monkeypatch.setattr(service, "create_agent_http_client", lambda *_: client)
    monkeypatch.setattr(service, "_extract", AsyncMock(return_value=NoteUpdate(overview="Old decision and new idea")))
    result = await service.run_pass(scribe_config, paths, "scribe", ROOM, force=True)
    assert result.overview == ""
    assert result.items == []
    assert result.status == "waiting"

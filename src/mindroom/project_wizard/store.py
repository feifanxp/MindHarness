# ruff: noqa: RUF001
"""Atomic, owner-scoped draft storage outside worker-writable workspaces."""

from __future__ import annotations

import hashlib
import json
import time
from contextlib import contextmanager
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from fastapi import HTTPException

from mindroom.durable_write import write_json_file_durable
from mindroom.file_locks import release_file_lock, try_exclusive_file_lock
from mindroom.project_wizard.legacy_profiles import discard_retired_recommendations
from mindroom.project_wizard.models import DiscussionSummary, ProjectWizardDraft, StoredMessage, WizardState

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


class WizardStore:
    """One authenticated user's durable drafts in one runtime."""

    def __init__(self, storage_root: Path, owner: str) -> None:
        """Keep user identifiers out of filesystem paths."""
        owner_key = hashlib.sha256(owner.encode()).hexdigest()
        self.root = storage_root / "tracking" / "project_wizard" / owner_key

    def _path(self, draft_id: UUID) -> Path:
        return self.root / f"{draft_id}.json"

    def create(self, owner_user_id: str | None = None) -> WizardState:
        """Persist an empty conversation before accepting any model work."""
        state = WizardState(draft_id=uuid4(), owner_user_id=owner_user_id)
        self.save(state)
        return state

    def save(self, state: WizardState) -> None:
        """Publish a complete snapshot atomically under the caller's operation lock."""
        state.updated_at = time.time()
        write_json_file_durable(self._path(state.draft_id), state.model_dump(mode="json"))

    def read(self, draft_id: UUID, *, include_deleted: bool = False) -> WizardState:
        """Read one atomic snapshot, requiring it to belong to this owner."""
        path = self._path(draft_id)
        if not path.exists():
            raise HTTPException(404, "找不到该草稿，请重新选择。")
        state = WizardState.model_validate(discard_retired_recommendations(json.loads(path.read_text())))
        if state.deleted and not include_deleted:
            raise HTTPException(404, "该讨论已删除。")
        return state

    @contextmanager
    def operation(self, draft_id: UUID, *, include_deleted: bool = False) -> Iterator[WizardState]:
        """Serialize a draft's operations; process exit releases an interrupted request."""
        self.read(draft_id, include_deleted=include_deleted)
        lock = try_exclusive_file_lock(self.root / f"{draft_id}.lock")
        if lock is None:
            raise HTTPException(409, "草稿正在处理中，请等待后重新加载。")
        try:
            state = self.read(draft_id, include_deleted=include_deleted)
            if not state.deleted:
                self._recover(state)
            yield state
        finally:
            release_file_lock(lock)

    def _recover(self, state: WizardState) -> None:
        # Drafts from Task C's mock adapter are reopened for real provisioning.
        if state.test_mode or (state.result is not None and state.result.test_mode):
            state.test_mode = False
            state.result = None
            state.status = "proposal_ready" if state.draft is not None else "empty"
            state.confirmation_key = None
            state.confirmed_revision = None
            state.error = None
            self.save(state)
        if state.status in {"confirmed", "provisioning"}:
            state.status = "provision_failed"
            state.error = "创建已中断，可安全重试。"
            self.save(state)
        elif state.pending_message_id is not None and state.error is None:
            state.status = "revising" if state.draft else "discovering"
            state.error = "上次回复已中断，请重试该消息。"
            self.save(state)

    def get(self, draft_id: UUID) -> WizardState:
        """Recover abandoned work without blocking an active model call."""
        lock = try_exclusive_file_lock(self.root / f"{draft_id}.lock")
        if lock is None:
            return self.read(draft_id)
        try:
            state = self.read(draft_id)
            self._recover(state)
            return state
        finally:
            release_file_lock(lock)

    def latest(self) -> WizardState | None:
        """Restore the last persisted conversation without browser-held private content."""
        entries = self.discussions()
        return self.get(entries[0].draft_id) if entries else None

    def discussions(self, *, archived: bool = False) -> list[DiscussionSummary]:
        """List this owner's recent discussions without loading or exposing their transcripts."""
        paths = sorted(self.root.glob("*.json"), key=lambda path: path.stat().st_mtime_ns, reverse=True)
        states = [self.read(UUID(path.stem), include_deleted=True) for path in paths]
        entries = [
            DiscussionSummary(
                draft_id=state.draft_id,
                name=state.display_name or (state.draft.project.name if state.draft else "新讨论"),
                status=state.status,
                updated_at=state.updated_at,
                revision=state.revision,
                archived=state.archived,
            )
            for state in states
            if not state.deleted and state.archived == archived
        ]
        return entries if archived else entries[:50]

    @staticmethod
    def check_revision(state: WizardState, revision: int) -> None:
        """Reject stale tab edits before touching saved content."""
        if state.revision != revision:
            raise HTTPException(409, "方案已在其他页面更新，请重新加载后再确认或修改。")

    @staticmethod
    def check_editable(state: WizardState) -> None:
        """Frozen confirmations cannot be altered by subsequent chat or rename requests."""
        if state.status in {"confirmed", "provisioning", "created", "provision_failed"}:
            raise HTTPException(409, "该方案已确认，请先返回修改方案。")
        if state.pending_message_id:
            raise HTTPException(409, "请先重试尚未完成的消息。")

    def complete_message(self, state: WizardState, content: str, proposal: ProjectWizardDraft | None) -> None:
        """Commit the assistant message and matching proposal in the same snapshot."""
        state.revision += 1
        if proposal:
            proposal.draft_id = str(state.draft_id)
            proposal.revision = state.revision
        state.draft = proposal
        if state.draft is not None and state.display_name:
            state.draft.project.name = state.display_name
        state.messages.append(StoredMessage(id=uuid4(), role="assistant", content=content))
        state.pending_message_id = None
        state.error = None
        state.status = "proposal_ready" if proposal and proposal.status == "proposal_ready" else "discovering"
        self.save(state)

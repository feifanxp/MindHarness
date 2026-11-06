"""Move standalone discussion records only to their established Matrix owner."""

from pathlib import Path
from uuid import UUID

from mindroom.file_locks import advisory_file_lock
from mindroom.project_wizard.store import WizardStore


def migrate_standalone_drafts(storage_root: Path, user_id: str, configured_owner: str | None) -> None:
    """Preserve IDs and records; leave unassigned or conflicting records untouched."""
    legacy_store = WizardStore(storage_root, "standalone")
    legacy = legacy_store.root
    if not legacy.is_dir():
        return
    target = WizardStore(storage_root, user_id).root
    # LEGACY_COMPAT: Discussion drafts stored under the shared standalone operator identity.
    # Legacy format: tracking/project_wizard/<sha256(standalone)>/*.json; owner_user_id may be null.
    # Last legacy release: unreleased fork feature; no tag contains its native writer.
    # Replacement: per-Matrix-user storage introduced in this change.
    # Handling: frozen owners win; unassigned drafts require MINDROOM_OWNER_USER_ID to match.
    # Existing target records are never replaced; unknown owners remain unclaimed.
    # Coverage: tests/api/test_project_wizard_auth.py::test_legacy_owner_migration
    with advisory_file_lock(legacy / "migration.lock"):
        for source in legacy.glob("*.json"):
            state = legacy_store.read(UUID(source.stem), include_deleted=True)
            if (state.owner_user_id or configured_owner) != user_id:
                continue
            target.mkdir(parents=True, exist_ok=True)
            destination = target / source.name
            if destination.exists():
                continue
            # Same-volume hard link publishes the entire record without replacing another draft.
            destination.hardlink_to(source)
            source.unlink()

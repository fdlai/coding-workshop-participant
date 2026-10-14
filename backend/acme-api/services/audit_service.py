"""Audit logging helpers.

Audit rows are added to the caller's session without committing so they are
persisted atomically with the mutation they describe.
"""

from typing import Any

from sqlalchemy.orm import Session

from models.audit_log import AuditLog


_SENSITIVE_MARKERS = ("password", "hash", "token", "secret", "credential")


def sanitize_changes(changes: Any) -> Any:
    """Recursively drop keys that could carry secrets from an audit payload."""
    if isinstance(changes, dict):
        return {
            key: sanitize_changes(value)
            for key, value in changes.items()
            if not any(marker in str(key).lower() for marker in _SENSITIVE_MARKERS)
        }
    if isinstance(changes, (list, tuple)):
        return [sanitize_changes(item) for item in changes]
    return changes


def record_audit(
    db: Session,
    *,
    actor_id: int,
    action: str,
    entity_type: str,
    entity_id: int,
    description: str,
    changes: dict[str, Any] | None = None,
) -> AuditLog:
    """Stage an audit record in the current transaction (no commit)."""
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        description=description,
        changes=sanitize_changes(changes) if changes is not None else None,
    )
    db.add(entry)
    return entry

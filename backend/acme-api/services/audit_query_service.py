"""Read-only audit-log queries for the administrator audit viewer."""

from datetime import date, datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from models.audit_log import AuditLog
from schemas.audit import AuditLogOut, AuditLogPage
from schemas.user import UserSummary


def to_audit_out(entry: AuditLog) -> AuditLogOut:
    """Serialize an audit row together with its actor summary."""
    return AuditLogOut(
        id=entry.id,
        created_at=entry.created_at,
        actor=UserSummary.model_validate(entry.actor),
        action=entry.action,
        entity_type=entry.entity_type,
        entity_id=entry.entity_id,
        description=entry.description,
        changes=entry.changes,
    )


def recent_audit_entries(db: Session, limit: int) -> list[AuditLogOut]:
    """Return the newest audit entries, newest first."""
    rows = db.scalars(
        select(AuditLog)
        .options(joinedload(AuditLog.actor))
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
    )
    return [to_audit_out(row) for row in rows]


def list_audit_logs(
    db: Session,
    *,
    action: str | None,
    entity_type: str | None,
    actor_id: int | None,
    since: date | None,
    until: date | None,
    limit: int,
    offset: int,
) -> AuditLogPage:
    """Return a filtered, paginated page of audit entries (newest first).

    ``since`` and ``until`` are inclusive UTC calendar days.
    """
    filters = []
    if action:
        filters.append(AuditLog.action == action)
    if entity_type:
        filters.append(AuditLog.entity_type == entity_type)
    if actor_id:
        filters.append(AuditLog.actor_id == actor_id)
    if since:
        filters.append(AuditLog.created_at >= datetime.combine(since, time.min, tzinfo=timezone.utc))
    if until:
        filters.append(AuditLog.created_at <= datetime.combine(until, time.max, tzinfo=timezone.utc))

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0
    rows = db.scalars(
        select(AuditLog)
        .options(joinedload(AuditLog.actor))
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return AuditLogPage(
        items=[to_audit_out(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
        available_actions=list(db.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action))),
        available_entity_types=list(
            db.scalars(select(AuditLog.entity_type).distinct().order_by(AuditLog.entity_type))
        ),
    )

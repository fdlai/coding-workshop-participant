"""Administrator-only audit-log endpoint."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.audit import AuditLogPage
from services import audit_query_service
from services.auth_service import require_roles


router = APIRouter(tags=["audit"])


@router.get("/audit-logs", response_model=AuditLogPage)
def get_audit_logs(
    action: str | None = Query(default=None, max_length=100),
    entity_type: str | None = Query(default=None, max_length=100),
    actor_id: int | None = Query(default=None, gt=0),
    since: date | None = None,
    until: date | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> AuditLogPage:
    """Return audit entries, newest first, with optional filters (administrators only)."""
    return audit_query_service.list_audit_logs(
        db,
        action=action,
        entity_type=entity_type,
        actor_id=actor_id,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )

"""Pydantic schemas for the audit-log listing endpoint."""

from datetime import datetime

from pydantic import BaseModel

from schemas.user import UserSummary


class AuditLogOut(BaseModel):
    """One audit entry with the acting user's summary."""

    id: int
    created_at: datetime
    actor: UserSummary
    action: str
    entity_type: str
    entity_id: int
    description: str | None = None
    changes: dict | None = None


class AuditLogPage(BaseModel):
    """A page of audit entries plus values for building filter dropdowns."""

    items: list[AuditLogOut]
    total: int
    limit: int
    offset: int
    available_actions: list[str]
    available_entity_types: list[str]

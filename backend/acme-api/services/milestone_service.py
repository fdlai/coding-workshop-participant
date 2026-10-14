"""Business logic for milestones."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import User
from schemas.milestone import MilestoneCreate, MilestoneUpdate
from services import clock
from services.access import ensure_can_manage_project, get_milestone_or_404
from services.audit_service import record_audit
from services.project_service import ensure_schedulable, lock_project
from services.scheduling_rules import as_utc, conflict, effective_window, unprocessable


def _validate_dates(db: Session, project: Project, start: date, end: date, exclude_id: int | None) -> None:
    if end < start:
        raise unprocessable("Milestone start date must be on or before its end date")
    if start < project.start_date or end > project.estimated_end_date:
        raise unprocessable(
            f"Milestone must fall within the project dates "
            f"({project.start_date} to {project.estimated_end_date})"
        )
    query = select(Milestone).where(
        Milestone.project_id == project.id,
        Milestone.start_date <= end,
        Milestone.end_date >= start,
    )
    if exclude_id is not None:
        query = query.where(Milestone.id != exclude_id)
    clash = db.scalars(query).first()
    if clash is not None:
        raise conflict(
            f"Milestone dates overlap '{clash.name}' ({clash.start_date} to {clash.end_date})"
        )


def _snapshot(milestone: Milestone, fields: list[str]) -> dict[str, Any]:
    return {
        field: (str(getattr(milestone, field)) if field.endswith("date") else getattr(milestone, field))
        for field in fields
    }


def list_milestones(db: Session, project_id: int) -> list[Milestone]:
    """Return a project's milestones in date order."""
    return list(
        db.scalars(
            select(Milestone)
            .where(Milestone.project_id == project_id)
            .order_by(Milestone.start_date, Milestone.id)
        )
    )


def create_milestone(db: Session, actor: User, project_id: int, payload: MilestoneCreate) -> Milestone:
    """Create a milestone inside an active, unarchived project."""
    try:
        project = lock_project(db, project_id)
        ensure_can_manage_project(actor, project)
        ensure_schedulable(project)
        _validate_dates(db, project, payload.start_date, payload.end_date, None)

        milestone = Milestone(
            project_id=project.id,
            name=payload.name,
            description=payload.description,
            deliverables=payload.deliverables,
            start_date=payload.start_date,
            end_date=payload.end_date,
            status="pending",
        )
        db.add(milestone)
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="milestone.create",
            entity_type="milestone",
            entity_id=milestone.id,
            description=f"Created milestone '{milestone.name}' in project '{project.name}'",
            changes={
                "after": _snapshot(milestone, ["project_id", "name", "start_date", "end_date", "status"])
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(milestone)
    return milestone


def update_milestone(
    db: Session, actor: User, milestone_id: int, payload: MilestoneUpdate
) -> Milestone:
    """Edit a pending milestone without invalidating its scheduled work."""
    try:
        milestone = get_milestone_or_404(db, milestone_id)
        project = lock_project(db, milestone.project_id)
        ensure_can_manage_project(actor, project)
        ensure_schedulable(project)
        if milestone.status != "pending":
            raise conflict("Completed milestones cannot be edited")

        changes = {
            k: v for k, v in payload.model_dump(exclude_unset=True).items() if getattr(milestone, k) != v
        }
        if not changes:
            db.rollback()
            return milestone

        new_start = changes.get("start_date", milestone.start_date)
        new_end = changes.get("end_date", milestone.end_date)
        if "start_date" in changes or "end_date" in changes:
            _validate_dates(db, project, new_start, new_end, milestone.id)
            _ensure_assignments_fit(db, milestone, new_start, new_end)

        before = _snapshot(milestone, list(changes))
        for field, value in changes.items():
            setattr(milestone, field, value)
        record_audit(
            db,
            actor_id=actor.id,
            action="milestone.update",
            entity_type="milestone",
            entity_id=milestone.id,
            description=f"Updated milestone '{milestone.name}'",
            changes={"before": before, "after": _snapshot(milestone, list(changes))},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(milestone)
    return milestone


def _ensure_assignments_fit(db: Session, milestone: Milestone, start: date, end: date) -> None:
    """New dates must contain every assignment period that accrues or will accrue work."""
    offenders = []
    for assignment in db.scalars(
        select(MilestoneAssignment).where(MilestoneAssignment.milestone_id == milestone.id)
    ):
        window = effective_window(assignment, milestone)
        if window and (window[0] < start or window[1] > end):
            offenders.append(assignment.id)
    if offenders:
        raise conflict(f"New milestone dates would exclude scheduled assignment(s): {sorted(offenders)}")


def set_milestone_status(
    db: Session,
    actor: User,
    milestone_id: int,
    new_status: str,
    *,
    now: datetime | None = None,
) -> Milestone:
    """Mark a milestone completed (forward-only; reopening is not supported).

    Completion stamps ``completed_at``; assignment rows are never modified.
    Work on the milestone stops accruing after the completion date.
    """
    now = as_utc(now or clock.utc_now())
    try:
        milestone = get_milestone_or_404(db, milestone_id)
        project = lock_project(db, milestone.project_id)
        ensure_can_manage_project(actor, project)
        ensure_schedulable(project)
        if new_status == "pending":
            raise conflict("Milestones can only move from pending to completed (reopening is not supported)")
        if milestone.status == "completed":
            raise conflict("Milestone is already completed")

        milestone.status = "completed"
        milestone.completed_at = now
        record_audit(
            db,
            actor_id=actor.id,
            action="milestone.complete",
            entity_type="milestone",
            entity_id=milestone.id,
            description=f"Completed milestone '{milestone.name}'",
            changes={
                "before": {"status": "pending"},
                "after": {"status": "completed", "completed_at": now.isoformat()},
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(milestone)
    return milestone

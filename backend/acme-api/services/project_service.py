"""Business logic for projects."""

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from schemas.project import ProjectCreate, ProjectUpdate
from services import clock
from services.access import ensure_can_manage_project
from services.audit_service import record_audit
from services.scheduling_rules import (
    as_utc,
    conflict,
    effective_end_date,
    end_open_assignments,
    unprocessable,
    utc_today,
)


def _snapshot(project: Project, fields: list[str]) -> dict[str, Any]:
    return {
        field: (str(getattr(project, field)) if field.endswith(("date", "budget")) else getattr(project, field))
        for field in fields
    }


def ensure_not_archived(project: Project) -> None:
    """Archived projects are read-only until restored."""
    if project.is_archived:
        raise conflict("Project is archived and read-only; restore it first")


def ensure_schedulable(project: Project) -> None:
    """Milestone and assignment changes require an unarchived, active project."""
    ensure_not_archived(project)
    if project.status != "active":
        raise conflict(f"Project is {project.status}; scheduling changes are closed")


def _require_manager(db: Session, manager_id: int) -> User:
    manager = db.get(User, manager_id)
    if manager is None or manager.role != "manager":
        raise unprocessable("manager_id must reference an existing user with the manager role")
    if not manager.is_active:
        raise unprocessable("The selected manager is inactive")
    return manager


def list_projects(
    db: Session,
    actor: User,
    *,
    status_filter: str | None = None,
    manager_id: int | None = None,
    include_archived: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[Project]:
    """Return the projects visible to the actor (role-filtered)."""
    query = select(Project)
    if actor.role == "manager":
        query = query.where(Project.manager_id == actor.id)
    elif actor.role == "employee":
        assigned = (
            select(Milestone.project_id)
            .join(MilestoneAssignment, MilestoneAssignment.milestone_id == Milestone.id)
            .where(MilestoneAssignment.employee_id == actor.id)
        )
        query = query.where(Project.id.in_(assigned))
    if status_filter:
        query = query.where(Project.status == status_filter)
    if manager_id is not None and actor.role == "admin":
        query = query.where(Project.manager_id == manager_id)
    if not include_archived:
        query = query.where(Project.is_archived.is_(False))
    query = query.order_by(Project.start_date.desc(), Project.id.desc()).limit(limit).offset(offset)
    return list(db.scalars(query))


def lock_project(db: Session, project_id: int) -> Project:
    """Load a project with a row lock to serialize concurrent milestone changes."""
    project = db.scalar(select(Project).where(Project.id == project_id).with_for_update())
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def create_project(db: Session, actor: User, payload: ProjectCreate) -> Project:
    """Create a project and its audit record in one transaction."""
    try:
        manager = _require_manager(db, payload.manager_id)
        project = Project(
            name=payload.name,
            description=payload.description,
            manager_id=manager.id,
            created_by=actor.id,
            start_date=payload.start_date,
            estimated_end_date=payload.estimated_end_date,
            estimated_budget=payload.estimated_budget,
            status="active",
            is_archived=False,
        )
        db.add(project)
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="project.create",
            entity_type="project",
            entity_id=project.id,
            description=f"Created project '{project.name}' managed by '{manager.username}'",
            changes={
                "after": _snapshot(
                    project,
                    ["name", "manager_id", "start_date", "estimated_end_date", "estimated_budget", "status"],
                )
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(project)
    return project


def update_project(db: Session, actor: User, project_id: int, payload: ProjectUpdate) -> Project:
    """Edit a project's details, refusing edits that would invalidate its schedule."""
    try:
        project = lock_project(db, project_id)
        ensure_can_manage_project(actor, project)
        ensure_not_archived(project)

        changes = payload.model_dump(exclude_unset=True)
        if "manager_id" in changes and changes["manager_id"] != project.manager_id:
            if actor.role != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only administrators can reassign a project's manager",
                )
        changes = {k: v for k, v in changes.items() if getattr(project, k) != v}
        if not changes:
            db.rollback()
            return project

        new_start = changes.get("start_date", project.start_date)
        new_end = changes.get("estimated_end_date", project.estimated_end_date)
        if new_end < new_start:
            raise unprocessable("Project end date must not precede its start date")
        if "start_date" in changes or "estimated_end_date" in changes:
            outside = list(
                db.scalars(
                    select(Milestone.id).where(
                        Milestone.project_id == project.id,
                        (Milestone.start_date < new_start) | (Milestone.end_date > new_end),
                    )
                )
            )
            if outside:
                raise conflict(
                    f"New project dates would exclude existing milestone(s): {sorted(outside)}"
                )
        if "manager_id" in changes:
            _validate_manager_change(db, project, changes["manager_id"])

        before = _snapshot(project, list(changes))
        for field, value in changes.items():
            setattr(project, field, value)
        record_audit(
            db,
            actor_id=actor.id,
            action="project.update",
            entity_type="project",
            entity_id=project.id,
            description=f"Updated project '{project.name}'",
            changes={"before": before, "after": _snapshot(project, list(changes))},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(project)
    return project


def _validate_manager_change(db: Session, project: Project, new_manager_id: int) -> None:
    """New manager must be valid and organizationally cover all open assignments."""
    _require_manager(db, new_manager_id)
    today = utc_today()
    rows = db.execute(
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .where(Milestone.project_id == project.id)
    )
    uncovered = sorted(
        {
            a.employee_id
            for a, m in rows
            if effective_end_date(a, m) >= today
            and db.get(EmployeeManager, (a.employee_id, new_manager_id)) is None
        }
    )
    if uncovered:
        raise conflict(
            f"Employees {uncovered} have open assignments but do not report to the new manager"
        )


def set_status(
    db: Session,
    actor: User,
    project_id: int,
    new_status: str,
    *,
    now: datetime | None = None,
) -> tuple[Project, list[int]]:
    """Change project status; completing/abandoning ends open assignments (rows are kept).

    Returns the project and the ids of assignments ended by the transition.
    Reactivating a project never restores ended assignments (forward-only).
    """
    now = now or clock.utc_now()
    try:
        project = lock_project(db, project_id)
        ensure_can_manage_project(actor, project)
        ensure_not_archived(project)
        if project.status == new_status:
            db.rollback()
            return project, []

        old_status = project.status
        ended: list[dict[str, Any]] = []
        if new_status in ("completed", "abandoned"):
            ended = end_open_assignments(db, today=utc_today(now), project_id=project.id)
        project.status = new_status
        record_audit(
            db,
            actor_id=actor.id,
            action="project.status_change",
            entity_type="project",
            entity_id=project.id,
            description=(
                f"Changed project '{project.name}' status from {old_status} to {new_status}; "
                f"ended {len(ended)} open assignment(s)"
            ),
            changes={
                "before": {"status": old_status},
                "after": {"status": new_status},
                "ended_assignments": ended,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(project)
    return project, [item["assignment_id"] for item in ended]


def set_archived(
    db: Session, actor: User, project_id: int, archived: bool, *, now: datetime | None = None
) -> Project:
    """Archive or restore a project (administrators only); nothing else is modified."""
    if actor.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can archive or restore projects",
        )
    now = as_utc(now or clock.utc_now())
    try:
        project = lock_project(db, project_id)
        if project.is_archived == archived:
            raise conflict("Project is already archived" if archived else "Project is not archived")
        project.is_archived = archived
        project.archived_at = now if archived else None
        record_audit(
            db,
            actor_id=actor.id,
            action="project.archive" if archived else "project.restore",
            entity_type="project",
            entity_id=project.id,
            description=f"{'Archived' if archived else 'Restored'} project '{project.name}'",
            changes={"before": {"is_archived": not archived}, "after": {"is_archived": archived}},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(project)
    return project

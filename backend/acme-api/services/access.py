"""Shared authorization helpers for project-scoped resources."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import User


def forbidden(detail: str = "Not authorized for this project") -> HTTPException:
    """Build a 403 error."""
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def ensure_can_manage_project(actor: User, project: Project) -> None:
    """Allow administrators and the project's own manager; reject everyone else."""
    if actor.role == "admin":
        return
    if actor.role == "manager" and project.manager_id == actor.id:
        return
    raise forbidden()


def can_view_project(db: Session, actor: User, project: Project) -> bool:
    """Admins see all, managers their own, employees projects they are/were assigned to."""
    if actor.role == "admin":
        return True
    if actor.role == "manager":
        return project.manager_id == actor.id
    return (
        db.scalar(
            select(MilestoneAssignment.id)
            .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
            .where(
                Milestone.project_id == project.id,
                MilestoneAssignment.employee_id == actor.id,
            )
            .limit(1)
        )
        is not None
    )


def ensure_can_view_project(db: Session, actor: User, project: Project) -> None:
    """Raise 403 unless the actor may view the project."""
    if not can_view_project(db, actor, project):
        raise forbidden()


def get_project_or_404(db: Session, project_id: int) -> Project:
    """Return a project or raise 404."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def get_milestone_or_404(db: Session, milestone_id: int) -> Milestone:
    """Return a milestone or raise 404."""
    milestone = db.get(Milestone, milestone_id)
    if milestone is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    return milestone

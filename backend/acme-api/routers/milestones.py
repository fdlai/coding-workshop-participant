"""Milestone and milestone-assignment endpoints."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.assignment import AssignmentCreate, AssignmentOut
from schemas.milestone import MilestoneOut, MilestoneStatusUpdate, MilestoneUpdate
from services import assignment_service, milestone_service
from services.access import ensure_can_view_project, get_milestone_or_404, get_project_or_404
from services.auth_service import get_current_user, require_roles
from services.scheduling_rules import utc_today


router = APIRouter(prefix="/milestones", tags=["milestones"])


@router.get("/{milestone_id}", response_model=MilestoneOut)
def get_milestone(
    milestone_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a milestone of a project the caller may view."""
    milestone = get_milestone_or_404(db, milestone_id)
    ensure_can_view_project(db, current_user, get_project_or_404(db, milestone.project_id))
    return milestone


@router.patch("/{milestone_id}", response_model=MilestoneOut)
def update_milestone(
    milestone_id: int,
    payload: MilestoneUpdate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
):
    """Edit a pending milestone (admin, or the owning manager)."""
    return milestone_service.update_milestone(db, current_user, milestone_id, payload)


@router.delete("/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_milestone(
    milestone_id: int,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
) -> None:
    """Delete a milestone with no assignments (admin, or the owning manager)."""
    milestone_service.delete_milestone(db, current_user, milestone_id)


@router.patch("/{milestone_id}/status", response_model=MilestoneOut)
def update_milestone_status(
    milestone_id: int,
    payload: MilestoneStatusUpdate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
):
    """Mark a milestone completed or cancelled (admin, or the owning manager)."""
    return milestone_service.set_milestone_status(db, current_user, milestone_id, payload.status)


@router.get("/{milestone_id}/assignments", response_model=list[AssignmentOut])
def list_milestone_assignments(
    milestone_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssignmentOut]:
    """List assignments (employees see only their own)."""
    milestone = get_milestone_or_404(db, milestone_id)
    return assignment_service.list_assignments(db, current_user, milestone, utc_today())


@router.post(
    "/{milestone_id}/assignments", response_model=AssignmentOut, status_code=status.HTTP_201_CREATED
)
def create_milestone_assignment(
    milestone_id: int,
    payload: AssignmentCreate,
    current_user: User = Depends(require_roles("admin", "manager")),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    """Schedule an employee into a milestone (admin, or the owning manager)."""
    return assignment_service.create_assignment(db, current_user, milestone_id, payload)

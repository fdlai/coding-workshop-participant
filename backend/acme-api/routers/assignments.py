"""Assignment mutation, schedule and availability endpoints."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.user import User
from schemas.assignment import (
    AssignmentOut,
    AssignmentTransfer,
    AssignmentUpdate,
    AvailabilityEntry,
    ScheduleItem,
    TransferResult,
)
from services import assignment_service
from services.auth_service import get_current_user, require_roles


router = APIRouter(tags=["assignments"])

require_scheduler = require_roles("admin", "manager")


@router.patch("/assignments/{assignment_id}", response_model=AssignmentOut)
def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    current_user: User = Depends(require_scheduler),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    """Adjust dates of an unfinished assignment."""
    return assignment_service.update_assignment(db, current_user, assignment_id, payload)


@router.post("/assignments/{assignment_id}/end", response_model=AssignmentOut)
def end_assignment(
    assignment_id: int,
    current_user: User = Depends(require_scheduler),
    db: Session = Depends(get_db),
) -> AssignmentOut:
    """End an assignment at the start of today (UTC), preserving history."""
    return assignment_service.end_assignment(db, current_user, assignment_id)


@router.post("/assignments/{assignment_id}/transfer", response_model=TransferResult)
def transfer_assignment(
    assignment_id: int,
    payload: AssignmentTransfer,
    current_user: User = Depends(require_scheduler),
    db: Session = Depends(get_db),
) -> TransferResult:
    """Atomically move an employee to another milestone."""
    source, destination = assignment_service.transfer_assignment(
        db, current_user, assignment_id, payload
    )
    return TransferResult(source=source, destination=destination)


@router.get("/employees/{employee_id}/schedule", response_model=list[ScheduleItem])
def get_employee_schedule(
    employee_id: int,
    start: date | None = None,
    end: date | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ScheduleItem]:
    """Return an employee's schedule (self, their managers' projects, or admin)."""
    return assignment_service.employee_schedule(
        db, current_user, employee_id, start=start, end=end
    )


@router.get("/availability", response_model=list[AvailabilityEntry])
def get_availability(
    start: date,
    end: date,
    manager_id: int | None = Query(default=None, gt=0),
    project_id: int | None = Query(default=None, gt=0),
    current_user: User = Depends(require_scheduler),
    db: Session = Depends(get_db),
) -> list[AvailabilityEntry]:
    """Return eligible employees and their busy periods for a date range."""
    return assignment_service.availability(
        db, current_user, start=start, end=end, manager_id=manager_id, project_id=project_id
    )

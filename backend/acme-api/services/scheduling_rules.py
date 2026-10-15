"""Core scheduling rules shared by assignments, projects, users and relationships.

Date conventions (all UTC):
  * Date ranges are inclusive on both ends.
  * An assignment's ``ended_at`` takes effect at the *beginning* of its UTC
    date, so the last worked day is the day before ``ended_at``.
  * A completed milestone's work stops at the end of its ``completed_at`` date.
  * The effective last day of an assignment is the earliest of those cutoffs
    and ``planned_end_date``. If it precedes ``start_date`` the assignment
    accrues zero days (for example a cancelled future assignment).
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import User
from services import clock

ONE_DAY = timedelta(days=1)


def as_utc(value: datetime) -> datetime:
    """Return an aware UTC datetime, treating naive values (e.g. SQLite) as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_today(now: datetime | None = None) -> date:
    """Return the current UTC calendar date."""
    return as_utc(now or clock.utc_now()).date()


def day_start(day: date) -> datetime:
    """Return midnight UTC at the beginning of the given date."""
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def effective_end_date(assignment: MilestoneAssignment, milestone: Milestone) -> date:
    """Return the last day work can accrue for an assignment (may precede its start)."""
    end = assignment.planned_end_date
    if assignment.ended_at is not None:
        end = min(end, as_utc(assignment.ended_at).date() - ONE_DAY)
    if milestone.completed_at is not None:
        end = min(end, as_utc(milestone.completed_at).date())
    return end


def effective_window(
    assignment: MilestoneAssignment, milestone: Milestone
) -> tuple[date, date] | None:
    """Return the inclusive worked/planned window, or None if it accrues no days."""
    end = effective_end_date(assignment, milestone)
    if end < assignment.start_date:
        return None
    return assignment.start_date, end


def ranges_overlap(a_start: date, a_end: date, b_start: date, b_end: date) -> bool:
    """Return True if two inclusive date ranges share at least one day."""
    return a_start <= b_end and b_start <= a_end


def assignment_state(assignment: MilestoneAssignment, milestone: Milestone, today: date) -> str:
    """Classify an assignment as cancelled, scheduled, active or completed."""
    window = effective_window(assignment, milestone)
    if window is None:
        return "cancelled" if assignment.ended_at is not None else "completed"
    start, end = window
    if start > today:
        return "scheduled"
    if end < today:
        return "completed"
    return "active"


def conflict(detail: str) -> HTTPException:
    """Build a 409 error."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def unprocessable(detail: str) -> HTTPException:
    """Build a 422 error."""
    return HTTPException(status_code=422, detail=detail)


def lock_employee(db: Session, employee_id: int) -> User | None:
    """Serialize scheduling and compensation changes for one employee.

    Takes a row lock (``SELECT ... FOR NO KEY UPDATE``) on the employee's user
    row so concurrent requests cannot both pass the overlap check and then
    both insert. The lock is held until the surrounding transaction commits or
    rolls back. ``key_share`` selects the weaker NO KEY UPDATE mode: it still
    conflicts with every other scheduling lock, but does not block unrelated
    inserts that merely reference the user (for example audit rows).

    ``populate_existing`` refreshes any already-loaded copy of the row, so the
    caller validates fresh state (e.g. ``is_active``) rather than a snapshot
    read before the lock was granted. SQLite (tests only) ignores the clause.
    """
    return db.scalar(
        select(User)
        .where(User.id == employee_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )


def find_conflicts(
    db: Session,
    employee_id: int,
    start: date,
    end: date,
    *,
    exclude_assignment_id: int | None = None,
) -> list[MilestoneAssignment]:
    """Return the employee's assignments, across all projects, overlapping [start, end]."""
    query = (
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .where(
            MilestoneAssignment.employee_id == employee_id,
            MilestoneAssignment.start_date <= end,
            MilestoneAssignment.planned_end_date >= start,
        )
    )
    if exclude_assignment_id is not None:
        query = query.where(MilestoneAssignment.id != exclude_assignment_id)

    found = []
    for assignment, milestone in db.execute(query):
        window = effective_window(assignment, milestone)
        if window and ranges_overlap(window[0], window[1], start, end):
            found.append(assignment)
    return found


def end_open_assignments(
    db: Session,
    *,
    today: date,
    employee_id: int | None = None,
    project_id: int | None = None,
    manager_id: int | None = None,
    milestone_id: int | None = None,
) -> list[dict[str, Any]]:
    """End active/future assignments at the start of ``today`` without deleting rows.

    Matches assignments (optionally filtered by employee, project, or the
    owning manager) whose effective last day is today or later. Each match
    gets ``ended_at`` set to midnight UTC of ``today``; assignments that have
    not started become cancelled (zero accrued days). Already-finished or
    already-ended assignments are never modified. Does not commit.
    """
    cutoff = day_start(today)
    query = (
        select(MilestoneAssignment, Milestone)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .join(Project, Project.id == Milestone.project_id)
        .where(MilestoneAssignment.planned_end_date >= today)
        .order_by(MilestoneAssignment.id)
    )
    if employee_id is not None:
        query = query.where(MilestoneAssignment.employee_id == employee_id)
    if project_id is not None:
        query = query.where(Project.id == project_id)
    if manager_id is not None:
        query = query.where(Project.manager_id == manager_id)
    if milestone_id is not None:
        query = query.where(MilestoneAssignment.milestone_id == milestone_id)

    ended: list[dict[str, Any]] = []
    for assignment, milestone in list(db.execute(query)):
        if effective_end_date(assignment, milestone) < today:
            continue
        previous = assignment.ended_at
        assignment.ended_at = cutoff
        ended.append(
            {
                "assignment_id": assignment.id,
                "milestone_id": assignment.milestone_id,
                "employee_id": assignment.employee_id,
                "previous_ended_at": previous.isoformat() if previous else None,
                "new_ended_at": cutoff.isoformat(),
            }
        )
    return ended

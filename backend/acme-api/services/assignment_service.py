"""Business logic for milestone assignments, transfers, schedules and availability."""

from datetime import date, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from schemas.assignment import (
    AssignmentCreate,
    AssignmentOut,
    AssignmentTransfer,
    AssignmentUpdate,
    AvailabilityEntry,
    BusyPeriod,
    ScheduleItem,
)
from schemas.user import UserSummary
from services import clock, cost_service
from services.access import (
    can_view_project,
    ensure_can_manage_project,
    forbidden,
    get_milestone_or_404,
    get_project_or_404,
)
from services.audit_service import record_audit
from services.project_service import ensure_not_archived, ensure_schedulable, lock_project
from services.scheduling_rules import (
    assignment_state,
    conflict,
    day_start,
    effective_end_date,
    effective_window,
    find_conflicts,
    lock_employee,
    ranges_overlap,
    unprocessable,
    utc_today,
)

MAX_RANGE_DAYS = 366


def to_assignment_out(
    assignment: MilestoneAssignment, milestone: Milestone, today: date, *, include_employee: bool = True
) -> AssignmentOut:
    """Serialize an assignment with its derived effective end date and state."""
    employee = assignment.employee if include_employee else None
    return AssignmentOut(
        id=assignment.id,
        milestone_id=assignment.milestone_id,
        employee_id=assignment.employee_id,
        start_date=assignment.start_date,
        planned_end_date=assignment.planned_end_date,
        ended_at=assignment.ended_at,
        effective_end_date=effective_end_date(assignment, milestone),
        state=assignment_state(assignment, milestone, today),
        employee=UserSummary.model_validate(employee) if employee is not None else None,
    )


def _snapshot(assignment: MilestoneAssignment) -> dict[str, Any]:
    return {
        "milestone_id": assignment.milestone_id,
        "employee_id": assignment.employee_id,
        "start_date": str(assignment.start_date),
        "planned_end_date": str(assignment.planned_end_date),
        "ended_at": assignment.ended_at.isoformat() if assignment.ended_at else None,
    }


def _get_assignment_or_404(db: Session, assignment_id: int) -> MilestoneAssignment:
    assignment = db.get(MilestoneAssignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _validate_period(milestone: Milestone, start: date, end: date, today: date) -> None:
    if end < start:
        raise unprocessable("Assignment start date must be on or before its end date")
    if start < today:
        raise unprocessable("Assignments cannot start in the past; accrued work is immutable")
    if start < milestone.start_date or end > milestone.end_date:
        raise unprocessable(
            f"Assignment must fall within the milestone dates "
            f"({milestone.start_date} to {milestone.end_date})"
        )


def _lock_for_change(
    db: Session, *, project_ids: list[int], employee_id: int, refresh: tuple[Any, ...] = ()
) -> User | None:
    """Take row locks in a fixed order, then refresh already-loaded objects.

    Lock order is always: projects (ascending id), then the employee. Every
    scheduling mutation follows it, which rules out lock-order deadlocks. After
    the locks are granted, the supplied objects are reloaded so that every later
    validation sees state committed by competing transactions (PostgreSQL
    READ COMMITTED gives each statement a fresh snapshot, but the ORM identity
    map would otherwise keep serving values read before the lock).
    """
    for project_id in sorted(set(project_ids)):
        lock_project(db, project_id)
    employee = lock_employee(db, employee_id)
    for obj in refresh:
        db.refresh(obj)
    return employee


def _require_eligible_employee(
    db: Session, employee: User | None, project: Project, start: date
) -> User:
    """Employee must be active, report to the project's manager and have work terms."""
    if employee is None or employee.role != "employee":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if not employee.is_active:
        raise conflict("Deactivated employees cannot receive new assignments")
    if db.get(EmployeeManager, (employee.id, project.manager_id)) is None:
        raise conflict("Employee is not organizationally assigned to the project's manager")
    if not cost_service.has_terms_effective_on(db, employee.id, start):
        raise conflict(
            "Employee has no work terms effective on the assignment start date; "
            "an administrator must record compensation terms first"
        )
    return employee


def _raise_if_conflicts(
    db: Session, employee_id: int, start: date, end: date, exclude_id: int | None = None
) -> None:
    clashes = find_conflicts(db, employee_id, start, end, exclude_assignment_id=exclude_id)
    if clashes:
        ids = sorted(c.id for c in clashes)
        raise conflict(f"Employee already has overlapping assignment(s) {ids} in the requested period")


def list_assignments(db: Session, actor: User, milestone: Milestone, today: date) -> list[AssignmentOut]:
    """List a milestone's assignments; employees see only their own rows."""
    project = get_project_or_404(db, milestone.project_id)
    if actor.role == "employee":
        if not can_view_project(db, actor, project):
            raise forbidden()
    else:
        ensure_can_manage_project(actor, project)
    query = select(MilestoneAssignment).where(MilestoneAssignment.milestone_id == milestone.id)
    if actor.role == "employee":
        query = query.where(MilestoneAssignment.employee_id == actor.id)
    rows = db.scalars(query.order_by(MilestoneAssignment.start_date, MilestoneAssignment.id))
    return [to_assignment_out(a, milestone, today) for a in rows]


def create_assignment(
    db: Session,
    actor: User,
    milestone_id: int,
    payload: AssignmentCreate,
    *,
    now: datetime | None = None,
) -> AssignmentOut:
    """Schedule an employee into a milestone, atomically with its audit record."""
    today = utc_today(now)
    try:
        milestone = get_milestone_or_404(db, milestone_id)
        project = get_project_or_404(db, milestone.project_id)
        ensure_can_manage_project(actor, project)
        employee = _lock_for_change(
            db,
            project_ids=[project.id],
            employee_id=payload.employee_id,
            refresh=(project, milestone),
        )
        ensure_can_manage_project(actor, project)
        ensure_schedulable(project)
        if milestone.status != "pending":
            raise conflict("Cannot schedule work on a completed milestone")
        _validate_period(milestone, payload.start_date, payload.planned_end_date, today)
        employee = _require_eligible_employee(db, employee, project, payload.start_date)
        _raise_if_conflicts(db, employee.id, payload.start_date, payload.planned_end_date)

        assignment = MilestoneAssignment(
            milestone_id=milestone.id,
            employee_id=employee.id,
            start_date=payload.start_date,
            planned_end_date=payload.planned_end_date,
        )
        db.add(assignment)
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="assignment.create",
            entity_type="assignment",
            entity_id=assignment.id,
            description=(
                f"Scheduled '{employee.username}' on milestone '{milestone.name}' "
                f"({payload.start_date} to {payload.planned_end_date})"
            ),
            changes={"after": _snapshot(assignment)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assignment)
    return to_assignment_out(assignment, milestone, today)


def update_assignment(
    db: Session,
    actor: User,
    assignment_id: int,
    payload: AssignmentUpdate,
    *,
    now: datetime | None = None,
) -> AssignmentOut:
    """Adjust the dates of an unfinished assignment without touching accrued days."""
    today = utc_today(now)
    try:
        assignment = _get_assignment_or_404(db, assignment_id)
        milestone = get_milestone_or_404(db, assignment.milestone_id)
        project = get_project_or_404(db, milestone.project_id)
        ensure_can_manage_project(actor, project)
        _lock_for_change(
            db,
            project_ids=[project.id],
            employee_id=assignment.employee_id,
            refresh=(project, milestone, assignment),
        )
        ensure_can_manage_project(actor, project)
        ensure_schedulable(project)
        if milestone.status != "pending":
            raise conflict("Assignments on completed milestones cannot be edited")
        if assignment.ended_at is not None:
            raise conflict("Ended assignments are historical and cannot be edited")
        if effective_end_date(assignment, milestone) < today:
            raise conflict("Finished assignments are historical and cannot be edited")

        changes = payload.model_dump(exclude_unset=True)
        new_start = changes.get("start_date", assignment.start_date)
        new_end = changes.get("planned_end_date", assignment.planned_end_date)
        if new_start != assignment.start_date and assignment.start_date <= today:
            raise unprocessable("The start date of an assignment that has begun cannot be changed")
        if new_start == assignment.start_date and new_end == assignment.planned_end_date:
            db.rollback()
            return to_assignment_out(assignment, milestone, today)
        if new_end < max(new_start, today):
            raise unprocessable("The end date cannot precede today; use the end action instead")
        if new_start < today:
            raise unprocessable("Assignments cannot start in the past; accrued work is immutable")
        if new_start < milestone.start_date or new_end > milestone.end_date:
            raise unprocessable(
                f"Assignment must fall within the milestone dates "
                f"({milestone.start_date} to {milestone.end_date})"
            )
        if new_start < assignment.start_date and not cost_service.has_terms_effective_on(
            db, assignment.employee_id, new_start
        ):
            raise conflict("Employee has no work terms effective on the new start date")

        _raise_if_conflicts(db, assignment.employee_id, new_start, new_end, exclude_id=assignment.id)

        before = _snapshot(assignment)
        assignment.start_date = new_start
        assignment.planned_end_date = new_end
        record_audit(
            db,
            actor_id=actor.id,
            action="assignment.update",
            entity_type="assignment",
            entity_id=assignment.id,
            description=f"Updated assignment {assignment.id} dates",
            changes={"before": before, "after": _snapshot(assignment)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assignment)
    return to_assignment_out(assignment, milestone, today)


def end_assignment(
    db: Session, actor: User, assignment_id: int, *, now: datetime | None = None
) -> AssignmentOut:
    """End an assignment at the start of today (UTC) while preserving the row.

    Work through yesterday still counts; today and later do not. An assignment
    that has not started becomes cancelled (``ended_at`` precedes ``start_date``).
    """
    today = utc_today(now)
    try:
        assignment = _get_assignment_or_404(db, assignment_id)
        milestone = get_milestone_or_404(db, assignment.milestone_id)
        project = get_project_or_404(db, milestone.project_id)
        ensure_can_manage_project(actor, project)
        _lock_for_change(
            db,
            project_ids=[project.id],
            employee_id=assignment.employee_id,
            refresh=(project, milestone, assignment),
        )
        ensure_can_manage_project(actor, project)
        ensure_not_archived(project)
        if assignment.ended_at is not None:
            raise conflict("Assignment has already been ended")
        if effective_end_date(assignment, milestone) < today:
            raise conflict("Assignment has already finished and is historical")

        before = _snapshot(assignment)
        assignment.ended_at = day_start(today)
        record_audit(
            db,
            actor_id=actor.id,
            action="assignment.end",
            entity_type="assignment",
            entity_id=assignment.id,
            description=f"Ended assignment {assignment.id} effective {today}",
            changes={"before": before, "after": _snapshot(assignment)},
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(assignment)
    return to_assignment_out(assignment, milestone, today)


def transfer_assignment(
    db: Session,
    actor: User,
    assignment_id: int,
    payload: AssignmentTransfer,
    *,
    now: datetime | None = None,
) -> tuple[AssignmentOut, AssignmentOut]:
    """Atomically move an employee to another milestone.

    The source assignment ends at the start of the transfer date (becoming
    cancelled if it had not started) and a new destination row is created
    starting that date. Conflicts are rechecked after the source is adjusted,
    and both changes plus the audit record commit together or not at all.
    """
    today = utc_today(now)
    try:
        source = _get_assignment_or_404(db, assignment_id)
        source_ms = get_milestone_or_404(db, source.milestone_id)
        source_project = get_project_or_404(db, source_ms.project_id)
        dest_ms = get_milestone_or_404(db, payload.target_milestone_id)
        dest_project = get_project_or_404(db, dest_ms.project_id)
        ensure_can_manage_project(actor, source_project)
        ensure_can_manage_project(actor, dest_project)
        employee = _lock_for_change(
            db,
            project_ids=[source_project.id, dest_project.id],
            employee_id=source.employee_id,
            refresh=(source_project, dest_project, source_ms, dest_ms, source),
        )
        ensure_can_manage_project(actor, source_project)
        ensure_can_manage_project(actor, dest_project)
        ensure_schedulable(source_project)
        ensure_schedulable(dest_project)
        if source_ms.status != "pending" or dest_ms.status != "pending":
            raise conflict("Transfers require pending source and destination milestones")
        if dest_ms.id == source_ms.id:
            raise unprocessable("Source and destination milestones must differ")
        if source.ended_at is not None:
            raise conflict("Ended assignments cannot be transferred")

        start = payload.start_date or today
        end = payload.planned_end_date or dest_ms.end_date
        _validate_period(dest_ms, start, end, today)
        source_end = effective_end_date(source, source_ms)
        if source_end < today or source_end < start:
            raise conflict("Source assignment has no remaining work on or after the transfer date")
        employee = _require_eligible_employee(db, employee, dest_project, start)

        before = _snapshot(source)
        source.ended_at = day_start(start)
        db.flush()
        _raise_if_conflicts(db, employee.id, start, end)

        destination = MilestoneAssignment(
            milestone_id=dest_ms.id,
            employee_id=employee.id,
            start_date=start,
            planned_end_date=end,
        )
        db.add(destination)
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="assignment.transfer",
            entity_type="assignment",
            entity_id=destination.id,
            description=(
                f"Transferred '{employee.username}' from milestone '{source_ms.name}' "
                f"to '{dest_ms.name}' effective {start}"
            ),
            changes={
                "source_before": before,
                "source_after": _snapshot(source),
                "destination": _snapshot(destination),
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(source)
    db.refresh(destination)
    return (
        to_assignment_out(source, source_ms, today),
        to_assignment_out(destination, dest_ms, today),
    )


def employee_schedule(
    db: Session,
    actor: User,
    employee_id: int,
    *,
    start: date | None,
    end: date | None,
    now: datetime | None = None,
) -> list[ScheduleItem]:
    """Return an employee's assignments (optionally within a range), scoped to the viewer.

    Admins and the employee see everything; managers see only assignments in
    their own projects.
    """
    today = utc_today(now)
    employee = db.get(User, employee_id)
    if employee is None or employee.role != "employee":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    if actor.role == "employee" and actor.id != employee_id:
        raise forbidden("Not authorized to view this schedule")
    if actor.role == "manager" and db.get(EmployeeManager, (employee_id, actor.id)) is None:
        raise forbidden("Not authorized to view this schedule")

    query = (
        select(MilestoneAssignment, Milestone, Project)
        .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
        .join(Project, Project.id == Milestone.project_id)
        .where(MilestoneAssignment.employee_id == employee_id)
        .order_by(MilestoneAssignment.start_date, MilestoneAssignment.id)
    )
    if actor.role == "manager":
        query = query.where(Project.manager_id == actor.id)

    items = []
    for assignment, milestone, project in db.execute(query):
        if start and end:
            window = effective_window(assignment, milestone)
            if window is None and assignment.ended_at is None:
                window = (assignment.start_date, assignment.planned_end_date)
            if window is None or not ranges_overlap(window[0], window[1], start, end):
                continue
        items.append(
            ScheduleItem(
                assignment=to_assignment_out(assignment, milestone, today, include_employee=False),
                project_id=project.id,
                project_name=project.name,
                milestone_name=milestone.name,
            )
        )
    return items


def availability(
    db: Session,
    actor: User,
    *,
    start: date,
    end: date,
    manager_id: int | None = None,
    project_id: int | None = None,
) -> list[AvailabilityEntry]:
    """Return active employees eligible for scheduling with their busy periods in [start, end]."""
    if end < start:
        raise unprocessable("end must be on or after start")
    if (end - start).days > MAX_RANGE_DAYS:
        raise unprocessable(f"Date range may not exceed {MAX_RANGE_DAYS} days")

    if project_id is not None:
        project = get_project_or_404(db, project_id)
        ensure_can_manage_project(actor, project)
        manager_id = project.manager_id
    elif actor.role == "manager":
        if manager_id not in (None, actor.id):
            raise forbidden("Managers can only view availability of their own employees")
        manager_id = actor.id

    query = select(User).where(User.role == "employee", User.is_active.is_(True))
    if manager_id is not None:
        query = query.join(EmployeeManager, EmployeeManager.employee_id == User.id).where(
            EmployeeManager.manager_id == manager_id
        )
    employees = list(db.scalars(query.order_by(User.last_name, User.first_name, User.id)))

    busy_by_employee: dict[int, list[BusyPeriod]] = {e.id: [] for e in employees}
    if employees:
        rows = db.execute(
            select(MilestoneAssignment, Milestone)
            .join(Milestone, Milestone.id == MilestoneAssignment.milestone_id)
            .where(
                MilestoneAssignment.employee_id.in_(list(busy_by_employee)),
                MilestoneAssignment.start_date <= end,
                MilestoneAssignment.planned_end_date >= start,
            )
            .order_by(MilestoneAssignment.start_date)
        )
        for assignment, milestone in rows:
            window = effective_window(assignment, milestone)
            if window and ranges_overlap(window[0], window[1], start, end):
                busy_by_employee[assignment.employee_id].append(
                    BusyPeriod(start_date=window[0], end_date=window[1])
                )
    return [
        AvailabilityEntry(
            employee=UserSummary.model_validate(e),
            is_available=not busy_by_employee[e.id],
            busy=busy_by_employee[e.id],
        )
        for e in employees
    ]

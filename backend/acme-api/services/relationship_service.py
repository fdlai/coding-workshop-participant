"""Business logic for employee-manager organizational relationships."""

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import EmployeeManager, User
from services import clock
from services.audit_service import record_audit
from services.scheduling_rules import end_open_assignments, lock_employee, utc_today
from services.user_service import get_user_or_404


def get_manager_or_404(db: Session, manager_id: int) -> User:
    """Return a user who has the manager role or raise 404."""
    manager = get_user_or_404(db, manager_id)
    if manager.role != "manager":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manager not found")
    return manager


def get_employee_or_404(db: Session, employee_id: int) -> User:
    """Return a user who has the employee role or raise 404."""
    employee = get_user_or_404(db, employee_id)
    if employee.role != "employee":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


def is_managed_by(db: Session, employee_id: int, manager_id: int) -> bool:
    """Return True if an EmployeeManager link exists."""
    return db.get(EmployeeManager, (employee_id, manager_id)) is not None


def list_employees_of(db: Session, manager_id: int) -> list[User]:
    """Return the employees assigned to a manager."""
    query = (
        select(User)
        .join(EmployeeManager, EmployeeManager.employee_id == User.id)
        .where(EmployeeManager.manager_id == manager_id)
        .order_by(User.last_name, User.first_name, User.id)
    )
    return list(db.scalars(query))


def list_managers_of(db: Session, employee_id: int) -> list[User]:
    """Return the managers an employee reports to."""
    query = (
        select(User)
        .join(EmployeeManager, EmployeeManager.manager_id == User.id)
        .where(EmployeeManager.employee_id == employee_id)
        .order_by(User.last_name, User.first_name, User.id)
    )
    return list(db.scalars(query))


def assign_employee(db: Session, actor: User, manager_id: int, employee_id: int) -> User:
    """Create a manager-employee relationship after validating both sides."""
    if manager_id == employee_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="A user cannot manage themselves"
        )
    manager = get_manager_or_404(db, manager_id)
    employee = get_employee_or_404(db, employee_id)
    if not manager.is_active or not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Both the manager and the employee must be active",
        )
    if is_managed_by(db, employee_id, manager_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee is already assigned to this manager",
        )

    try:
        db.add(EmployeeManager(employee_id=employee_id, manager_id=manager_id))
        db.flush()
        record_audit(
            db,
            actor_id=actor.id,
            action="employee_manager.assign",
            entity_type="employee_manager",
            entity_id=employee_id,
            description=f"Assigned '{employee.username}' to manager '{manager.username}'",
            changes={"manager_id": manager_id, "employee_id": employee_id},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Employee is already assigned to this manager",
        ) from exc
    except Exception:
        db.rollback()
        raise
    return employee


def remove_employee(
    db: Session,
    actor: User,
    manager_id: int,
    employee_id: int,
    *,
    now: datetime | None = None,
) -> list[int]:
    """Remove an employee from a manager and end affected assignments atomically.

    Assignments of the employee in projects owned by this manager that are
    still active or scheduled in the future get ``ended_at`` set to the start
    of the current day (UTC). No assignment row is deleted, and assignments
    under other managers' projects are untouched. An assignment whose
    ``ended_at`` precedes its ``start_date`` represents cancelled future work.
    Returns the ids of the assignments that were ended.
    """
    now = now or clock.utc_now()
    today = utc_today(now)

    link = db.get(EmployeeManager, (employee_id, manager_id))
    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee is not assigned to this manager",
        )
    manager = db.get(User, manager_id)
    employee = db.get(User, employee_id)

    try:
        lock_employee(db, employee_id)
        ended = end_open_assignments(
            db, today=today, employee_id=employee_id, manager_id=manager_id
        )

        db.delete(link)
        record_audit(
            db,
            actor_id=actor.id,
            action="employee_manager.remove",
            entity_type="employee_manager",
            entity_id=employee_id,
            description=(
                f"Removed '{employee.username}' from manager '{manager.username}'; "
                f"ended {len(ended)} active/future assignment(s)"
            ),
            changes={
                "manager_id": manager_id,
                "employee_id": employee_id,
                "ended_assignments": ended,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return [item["assignment_id"] for item in ended]

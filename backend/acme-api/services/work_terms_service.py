"""Administrator-only management of effective-dated employee compensation."""

from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.user import User
from models.work_terms import EmployeeWorkTerms
from schemas.work_terms import WorkTermsCreate, WorkTermsOut
from services import cost_service
from services.audit_service import record_audit
from services.scheduling_rules import conflict, lock_employee, utc_today


def to_out(row: EmployeeWorkTerms) -> WorkTermsOut:
    """Serialize a record together with its derived daily cost."""
    return WorkTermsOut(
        id=row.id,
        employee_id=row.employee_id,
        hourly_rate=row.hourly_rate,
        weekly_hours=row.weekly_hours,
        effective_from=row.effective_from,
        daily_cost=cost_service.money(cost_service.daily_cost(row.hourly_rate, row.weekly_hours)),
    )


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")


def list_work_terms(db: Session, employee_id: int) -> list[WorkTermsOut]:
    """Return the employee's full history, newest effective date first."""
    employee = db.get(User, employee_id)
    if employee is None or employee.role != "employee":
        raise _not_found()
    rows = db.scalars(
        select(EmployeeWorkTerms)
        .where(EmployeeWorkTerms.employee_id == employee_id)
        .order_by(EmployeeWorkTerms.effective_from.desc())
    )
    return [to_out(row) for row in rows]


def create_work_terms(
    db: Session,
    actor: User,
    employee_id: int,
    payload: WorkTermsCreate,
    *,
    now: datetime | None = None,
) -> WorkTermsOut:
    """Append a new terms record and its audit entry in one transaction.

    History is append-only: records are never updated or deleted. A record
    effective on or after today cannot change any accrued day. A record dated in
    the past is accepted only if the employee has no worked weekday on or after
    that date (for example initial terms for a new hire), because otherwise it
    would silently rewrite already accrued estimated costs.
    """
    today = utc_today(now)
    try:
        employee = lock_employee(db, employee_id)
        if employee is None or employee.role != "employee":
            raise _not_found()

        duplicate = db.scalar(
            select(EmployeeWorkTerms.id).where(
                EmployeeWorkTerms.employee_id == employee_id,
                EmployeeWorkTerms.effective_from == payload.effective_from,
            )
        )
        if duplicate is not None:
            raise conflict("Work terms already exist for this effective date; add a new date instead")
        if payload.effective_from < today:
            affected = cost_service.accrued_weekdays_since(db, employee_id, payload.effective_from, today)
            if affected:
                raise conflict(
                    "Backdated terms would change already accrued labor costs "
                    f"({affected} worked weekday(s) on or after {payload.effective_from}); "
                    "use an effective date of today or later"
                )

        row = EmployeeWorkTerms(
            employee_id=employee_id,
            hourly_rate=payload.hourly_rate,
            weekly_hours=payload.weekly_hours,
            effective_from=payload.effective_from,
        )
        db.add(row)
        db.flush()
        changes: dict[str, Any] = {
            "after": {
                "hourly_rate": str(row.hourly_rate),
                "weekly_hours": str(row.weekly_hours),
                "effective_from": str(row.effective_from),
            }
        }
        record_audit(
            db,
            actor_id=actor.id,
            action="work_terms.create",
            entity_type="employee_work_terms",
            entity_id=row.id,
            description=f"Recorded work terms for '{employee.username}' effective {row.effective_from}",
            changes=changes,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("Work terms already exist for this effective date") from None
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    return to_out(row)

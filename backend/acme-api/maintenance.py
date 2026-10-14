"""Direct-invocation maintenance actions that write data (currently ``db_seed``).

These run only from ``function.handler`` after its existing guards (non-HTTP event,
expected Aurora host and database). This module adds payload validation and an
explicit target confirmation. It never logs or returns the demo password.
"""

from collections.abc import Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import settings
from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from scripts.seed import seed_all

SEED_EVENT_KEYS = {"acme_maintenance_action", "confirm_target", "seed_demo_password"}
MIN_PASSWORD_LENGTH = 12


def expected_target() -> str:
    """Return the exact confirmation string, ``<database>@<host>``, for this environment."""
    return f"{settings.POSTGRES_NAME}@{settings.POSTGRES_HOST}"


def _validate_password(password: object) -> str:
    if not isinstance(password, str):
        raise ValueError("seed_demo_password is required")
    strong = (
        len(password) >= MIN_PASSWORD_LENGTH
        and any(c.islower() for c in password)
        and any(c.isupper() for c in password)
        and any(c.isdigit() for c in password)
    )
    if not strong:
        raise ValueError(
            f"seed_demo_password must be at least {MIN_PASSWORD_LENGTH} characters "
            "with upper-case, lower-case and a digit"
        )
    return password


def validate_seed_event(event: dict) -> str:
    """Check the payload and return the demo password. Raises ValueError on any problem."""
    unexpected = set(event) - SEED_EVENT_KEYS
    if unexpected:
        raise ValueError(f"Unexpected payload keys: {sorted(unexpected)}")
    if event.get("confirm_target") != expected_target():
        raise ValueError(f"confirm_target must equal '{expected_target()}'")
    return _validate_password(event.get("seed_demo_password"))


def run_seed(event: dict, session_factory: Callable[[], Session] | None = None) -> dict:
    """Seed demo data in a single transaction; commit only if every step succeeds."""
    password = validate_seed_event(event)
    if session_factory is None:
        from database import SessionLocal

        session_factory = SessionLocal

    with session_factory() as db:
        try:
            report = seed_all(db, password)
            db.commit()
        except Exception:
            db.rollback()
            raise
        totals = {
            "users": db.scalar(select(func.count(User.id))),
            "employee_managers": db.scalar(select(func.count()).select_from(EmployeeManager)),
            "projects": db.scalar(select(func.count(Project.id))),
            "milestones": db.scalar(select(func.count(Milestone.id))),
            "assignments": db.scalar(select(func.count(MilestoneAssignment.id))),
        }

    return {
        "status": "seed_complete",
        "database": settings.POSTGRES_NAME,
        "created": report.created,
        "skipped": report.skipped,
        "totals": totals,
        "demo_logins": ["demo.avery.brooks", "demo.morgan.hayes", "demo.liam.anderson"],
    }

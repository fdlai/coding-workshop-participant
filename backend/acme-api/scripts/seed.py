"""Safe, repeatable development seed utility.

Run explicitly from ``backend/acme-api``::

    $env:SEED_DEMO_PASSWORD = "<dev-only password>"
    python scripts/seed.py

The dataset itself (people, reporting lines, projects) lives in ``scripts/seed_data.py``;
this module turns it into database rows.

Safety properties:
  * Never runs on API startup; it only runs when you invoke it.
  * Refuses to run unless the target is database ``acme_db`` on localhost.
  * Prints the target host and database before making any change.
  * Additive only: it never updates or deletes existing rows.
  * All demo accounts use the ``demo.`` username prefix, so real users are
    never touched; re-running creates nothing new.
  * Refuses to run when ``APP_ENV`` is ``production`` unless
    ``SEED_ALLOW_PRODUCTION=yes`` is also set.
  * The demo password comes from the environment, never from source code, and every
    demo account shares it.
  * Audit rows it writes are labelled as synthetic seed data.
"""

import os
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

# Allow `python scripts/seed.py`, which otherwise cannot import the project packages.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from models.work_terms import EmployeeWorkTerms
from scripts.seed_data import (  # noqa: F401  (re-exported for tests and callers)
    ADMIN,
    ADMINS,
    EMPLOYEES,
    MANAGERS,
    SECOND_MANAGER,
    SHOWCASE_DEACTIVATED,
    SHOWCASE_EMPLOYEES,
    SHOWCASE_MANAGER,
    SHOWCASE_PROJECT,
    SHOWCASE_TERMS,
    _terms_plan,
    build_projects,
    reporting_lines,
)
from services.audit_service import record_audit
from services.auth_service import hash_password


DEMO_PREFIX = "demo."
DEMO_EMAIL_DOMAIN = "acme-demo.example"
SYNTHETIC_LABEL = "[Synthetic seed data] "

DEMO_PROJECTS = build_projects()


@dataclass
class SeedReport:
    """Counts of records created or already present."""

    created: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)

    def add(self, kind: str, created: bool) -> None:
        """Count a created or skipped record of the given kind."""
        bucket = self.created if created else self.skipped
        bucket[kind] = bucket.get(kind, 0) + 1


def demo_username(first: str, last: str) -> str:
    """Return the deterministic demo username for a person."""
    return f"{DEMO_PREFIX}{first}.{last}".lower()


def _midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def _audit(db: Session, today: date, when: date, minute: int = 0, **fields) -> None:
    """Stage a clearly labelled synthetic audit row dated on ``when`` (never in the future)."""
    fields["description"] = SYNTHETIC_LABEL + fields["description"]
    fields["changes"] = {**(fields.get("changes") or {}), "synthetic_seed": True}
    entry = record_audit(db, **fields)
    stamp = datetime.combine(min(when, today), time(9, 0), tzinfo=timezone.utc)
    entry.created_at = stamp + timedelta(minutes=minute)


def _ensure_user(
    db: Session,
    report: SeedReport,
    today: date,
    actor_id: int | None,
    order: int,
    *,
    first: str,
    last: str,
    title: str,
    role: str,
    password_hash: str,
) -> User:
    username = demo_username(first, last)
    existing = db.scalar(select(User).where(User.username == username))
    if existing is not None:
        report.add(f"users:{role}", False)
        return existing

    user = User(
        username=username,
        email=f"{username}@{DEMO_EMAIL_DOMAIN}",
        first_name=first,
        last_name=last,
        password_hash=password_hash,
        role=role,
        job_title=title,
        is_active=True,
    )
    db.add(user)
    db.flush()
    _audit(
        db,
        today,
        today - timedelta(days=420),
        order,
        actor_id=actor_id or user.id,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        description=f"Seeded demo {role} account '{username}'",
        changes={"after": {"username": username, "role": role}},
    )
    report.add(f"users:{role}", True)
    return user


def _ensure_link(
    db: Session,
    report: SeedReport,
    today: date,
    actor: User,
    employee: User,
    manager: User,
    audited: bool,
    order: int,
) -> None:
    if db.get(EmployeeManager, (employee.id, manager.id)) is not None:
        report.add("employee_managers", False)
        return
    db.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    db.flush()
    if audited:
        _audit(
            db,
            today,
            today - timedelta(days=380),
            order,
            actor_id=actor.id,
            action="employee_manager.assign",
            entity_type="employee_manager",
            entity_id=employee.id,
            description=f"Seeded '{employee.username}' under additional manager '{manager.username}'",
            changes={"manager_id": manager.id, "employee_id": employee.id},
        )
    report.add("employee_managers", True)


def seed_organization(
    db: Session,
    password: str,
    report: SeedReport | None = None,
    today: date | None = None,
) -> SeedReport:
    """Create the demo admins, managers, employees, and reporting lines.

    Every account shares ``password``. Flushes but does not commit; the caller owns
    the transaction.
    """
    report = report or SeedReport()
    today = today or datetime.now(timezone.utc).date()
    password_hash = hash_password(
        password
    )  # hashed once and shared by every demo account

    def make(actor_id, order, role, person):
        first, last, title = person
        return _ensure_user(
            db,
            report,
            today,
            actor_id,
            order,
            first=first,
            last=last,
            title=title,
            role=role,
            password_hash=password_hash,
        )

    admins = [make(None, i, "admin", p) for i, p in enumerate(ADMINS)]
    admin = admins[0]
    managers = [make(admin.id, 10 + i, "manager", p) for i, p in enumerate(MANAGERS)]
    employees = [make(admin.id, 30 + i, "employee", p) for i, p in enumerate(EMPLOYEES)]
    for order, (employee, manager, primary) in enumerate(reporting_lines()):
        _ensure_link(
            db,
            report,
            today,
            admin,
            employees[employee],
            managers[manager],
            not primary,
            order,
        )
    return report


def _demo_user(db: Session, first: str, last: str) -> User:
    user = db.scalar(select(User).where(User.username == demo_username(first, last)))
    if user is None:
        raise RuntimeError("Demo organization is missing; seed the organization first.")
    return user


def _project_exists(db: Session, name: str) -> bool:
    return db.scalar(select(Project.id).where(Project.name == name)) is not None


def _create_project(
    db: Session,
    report: SeedReport,
    today: date,
    day: Callable[[int], date],
    spec: dict,
    admin: User,
    manager: User,
    employees: list[User],
    order: int,
) -> Project:
    """Create one project with its milestones and assignments; ``day`` maps offsets to dates."""
    project = Project(
        name=spec["name"],
        description=spec.get("description")
        or f"Demonstration project: {spec['name'][6:]}.",
        manager_id=manager.id,
        created_by=admin.id,
        start_date=day(spec["start"]),
        estimated_end_date=day(spec["end"]),
        estimated_budget=Decimal(spec["budget"]),
        status=spec["status"],
        is_archived=spec["archived"],
        archived_at=_midnight(day(spec["end"])) if spec["archived"] else None,
    )
    db.add(project)
    db.flush()
    milestones = []
    for name, start, end, completed, *extra in spec["milestones"]:
        milestone = Milestone(
            project_id=project.id,
            name=name,
            description=extra[0] if extra else None,
            start_date=day(start),
            end_date=day(end),
            status="completed" if completed else "pending",
            completed_at=_midnight(day(end)) if completed else None,
        )
        db.add(milestone)
        milestones.append(milestone)
        report.add("milestones", True)
    db.flush()
    for emp_idx, ms_idx, start, end, ended in spec["assignments"]:
        db.add(
            MilestoneAssignment(
                milestone_id=milestones[ms_idx].id,
                employee_id=employees[emp_idx].id,
                start_date=day(start),
                planned_end_date=day(end),
                ended_at=_midnight(day(ended)) if ended is not None else None,
            )
        )
        report.add("assignments", True)
    db.flush()
    _audit(
        db,
        today,
        day(spec["start"] - 7),
        order,
        actor_id=admin.id,
        action="project.create",
        entity_type="project",
        entity_id=project.id,
        description=f"Seeded demo project '{project.name}'",
        changes={"after": {"name": project.name, "status": project.status}},
    )
    report.add("projects", True)
    return project


def _add_terms(
    db: Session,
    report: SeedReport,
    today: date,
    admin: User,
    employee: User,
    plan: list[tuple[int, Decimal, Decimal]],
    day: Callable[[int], date],
    order: int,
) -> None:
    """Add an employee's terms history unless they already have any; audit raises only."""
    if db.scalar(
        select(EmployeeWorkTerms.id).where(EmployeeWorkTerms.employee_id == employee.id)
    ) is not None:
        for _ in plan:
            report.add("work_terms", False)
        return
    for position, (offset, rate, hours) in enumerate(plan):
        effective = day(offset)
        row = EmployeeWorkTerms(
            employee_id=employee.id,
            hourly_rate=rate,
            weekly_hours=hours,
            effective_from=effective,
        )
        db.add(row)
        db.flush()
        if position > 0:
            _audit(
                db,
                today,
                effective,
                order,
                actor_id=admin.id,
                action="work_terms.create",
                entity_type="employee_work_terms",
                entity_id=row.id,
                description=f"Seeded compensation change for '{employee.username}'",
                changes={
                    "after": {
                        "hourly_rate": str(rate),
                        "weekly_hours": str(hours),
                        "effective_from": str(effective),
                    }
                },
            )
        report.add("work_terms", True)


def seed_projects(
    db: Session, report: SeedReport | None = None, today: date | None = None
) -> SeedReport:
    """Create demo projects, milestones, and assignments relative to ``today``.

    Idempotent by project name: an existing project (and everything under it) is left
    untouched. Requires the demo organization. Flushes but does not commit.
    """
    report = report or SeedReport()
    today = today or datetime.now(timezone.utc).date()
    admin = _demo_user(db, *ADMIN[:2])
    managers = [_demo_user(db, f, l) for f, l, _ in MANAGERS]
    employees = [_demo_user(db, f, l) for f, l, _ in EMPLOYEES]

    def day(offset: int) -> date:
        return today + timedelta(days=offset)

    for order, spec in enumerate(DEMO_PROJECTS):
        if _project_exists(db, spec["name"]):
            report.add("projects", False)
            continue
        _create_project(
            db, report, today, day, spec, admin, managers[spec["manager"]], employees, order
        )
    return report


def seed_showcase(
    db: Session, report: SeedReport | None = None, today: date | None = None
) -> SeedReport:
    """Create the labor-cost showcase project, its employees and their pay history.

    Dates are anchored to the Monday of ``today``'s week so every scenario spans whole
    weeks. Idempotent by project name: once the project exists nothing is added.
    Requires the demo organization. Flushes but does not commit.
    """
    report = report or SeedReport()
    today = today or datetime.now(timezone.utc).date()
    if _project_exists(db, SHOWCASE_PROJECT["name"]):
        report.add("projects", False)
        return report
    admin = _demo_user(db, *ADMIN[:2])
    manager = _demo_user(db, *MANAGERS[SHOWCASE_MANAGER][:2])
    monday = today - timedelta(days=today.weekday())

    def day(offset: int) -> date:
        return monday + timedelta(days=offset)

    employees = []
    for index, (first, last, title) in enumerate(SHOWCASE_EMPLOYEES):
        employee = _ensure_user(
            db,
            report,
            today,
            admin.id,
            200 + index,
            first=first,
            last=last,
            title=title,
            role="employee",
            password_hash=admin.password_hash,  # every demo account shares one password
        )
        _ensure_link(db, report, today, admin, employee, manager, False, 200 + index)
        _add_terms(db, report, today, admin, employee, SHOWCASE_TERMS[index], day, 200 + index)
        employees.append(employee)

    _create_project(
        db, report, today, day, SHOWCASE_PROJECT, admin, manager, employees, len(DEMO_PROJECTS)
    )

    for index, offset in SHOWCASE_DEACTIVATED.items():
        employee = employees[index]
        employee.is_active = False
        _audit(
            db,
            today,
            day(offset),
            200 + index,
            actor_id=admin.id,
            action="user.deactivate",
            entity_type="user",
            entity_id=employee.id,
            description=f"Deactivated account '{employee.username}'",
            changes={"before": {"is_active": True}, "after": {"is_active": False}},
        )
    db.flush()
    return report


def seed_work_terms(
    db: Session, report: SeedReport | None = None, today: date | None = None
) -> SeedReport:
    """Create effective-dated work terms for every demo employee.

    Idempotent per employee: an employee who already has any work terms is left
    untouched, so re-running on a later day never adds shifted duplicates. Only raises
    (terms after an employee's first) get an audit row. Requires the demo organization.
    Flushes but does not commit.
    """
    report = report or SeedReport()
    today = today or datetime.now(timezone.utc).date()
    admin = _demo_user(db, *ADMIN[:2])

    def day(offset: int) -> date:
        return today + timedelta(days=offset)

    for index, (first, last, _) in enumerate(EMPLOYEES):
        employee = _demo_user(db, first, last)
        _add_terms(db, report, today, admin, employee, _terms_plan(index), day, index)
    return report


def seed_all(db: Session, password: str) -> SeedReport:
    """Run every seeding step in order and return the combined report.

    Flushes but does not commit; the caller owns the transaction. Add new seed
    steps here so the CLI and the Lambda maintenance action both pick them up.
    """
    report = seed_organization(db, password)
    seed_work_terms(db, report)
    seed_projects(db, report)
    seed_showcase(db, report)
    return report


ALLOWED_DB_NAME = "acme_db"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _print_report(report: SeedReport) -> None:
    print(f"Created: {report.created or 'nothing'}")
    print(f"Already present (skipped): {report.skipped or 'nothing'}")


def check_target(host: str, name: str) -> None:
    """Exit unless the target is the local development database."""
    if (host or "").lower() not in LOCAL_HOSTS or name != ALLOWED_DB_NAME:
        raise SystemExit(
            f"Refusing to seed {name!r} on {host!r}: only {ALLOWED_DB_NAME!r} on localhost is allowed."
        )


def main() -> None:
    """Command-line entry point: seeds the configured local database."""
    from config import settings
    from database import SessionLocal  # imported lazily so tests never touch PostgreSQL

    if (
        os.getenv("APP_ENV", "").lower() == "production"
        and os.getenv("SEED_ALLOW_PRODUCTION") != "yes"
    ):
        raise SystemExit(
            "Refusing to seed: APP_ENV=production (set SEED_ALLOW_PRODUCTION=yes to override)."
        )
    check_target(settings.POSTGRES_HOST, settings.POSTGRES_NAME)
    password = os.getenv("SEED_DEMO_PASSWORD")
    if not password or len(password) < 8:
        raise SystemExit("SEED_DEMO_PASSWORD must be set (at least 8 characters).")

    print(
        f"Seeding database '{settings.POSTGRES_NAME}' on host '{settings.POSTGRES_HOST}'..."
    )
    with SessionLocal() as db:
        try:
            report = seed_all(db, password)
            db.commit()
        except Exception:
            db.rollback()
            raise
    _print_report(report)
    print(
        f"Demo logins: {demo_username(*ADMIN[:2])}, {demo_username(*MANAGERS[0][:2])}, "
        f"{demo_username(*EMPLOYEES[0][:2])} (password from SEED_DEMO_PASSWORD)."
    )
    print(f"Labor-cost showcase project: '{SHOWCASE_PROJECT['name']}'.")


if __name__ == "__main__":
    main()

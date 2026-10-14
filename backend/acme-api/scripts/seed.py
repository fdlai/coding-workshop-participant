"""Safe, repeatable development seed utility (organization step).

Run explicitly from ``backend/acme-api``::

    $env:SEED_DEMO_PASSWORD = "<dev-only password>"
    python -m scripts.seed            # dry run: reports what would be created
    python -m scripts.seed --apply    # creates missing demo records

Safety properties:
  * Never runs on API startup and defaults to a dry run.
  * Additive only: it never updates or deletes existing rows.
  * All demo accounts use the ``demo.`` username prefix, so real users are
    never touched; re-running creates nothing new.
  * Refuses to run when ``APP_ENV`` is ``production`` unless
    ``SEED_ALLOW_PRODUCTION=yes`` is also set.
  * The demo password comes from the environment, never from source code.

Seeds the organization, effective-dated work terms, and demo projects, milestones and
assignments.
"""

import argparse
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.assignment import MilestoneAssignment
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from models.work_terms import EmployeeWorkTerms
from services.audit_service import record_audit
from services.auth_service import hash_password


DEMO_PREFIX = "demo."
DEMO_EMAIL_DOMAIN = "acme-demo.example"

ADMIN = ("Avery", "Brooks", "Chief Operating Officer")
MANAGERS = [
    ("Morgan", "Hayes", "Engineering Manager"),
    ("Priya", "Natarajan", "Product Delivery Manager"),
    ("Daniel", "Okafor", "Infrastructure Manager"),
    ("Elena", "Rossi", "Design Manager"),
]
EMPLOYEES = [
    ("Liam", "Anderson", "Software Engineer"),
    ("Sofia", "Martinez", "Senior Software Engineer"),
    ("Noah", "Kim", "Frontend Developer"),
    ("Aisha", "Khan", "Backend Developer"),
    ("Ethan", "Walker", "DevOps Engineer"),
    ("Mia", "Nguyen", "QA Engineer"),
    ("Lucas", "Fischer", "Data Engineer"),
    ("Olivia", "Dubois", "UX Designer"),
    ("James", "Tanaka", "Software Engineer"),
    ("Hannah", "Cohen", "Business Analyst"),
    ("Mateo", "Silva", "Site Reliability Engineer"),
    ("Chloe", "Johansson", "Product Designer"),
    ("Ravi", "Patel", "Senior Backend Developer"),
    ("Grace", "Oyelaran", "QA Engineer"),
    ("Samuel", "Lindgren", "Frontend Developer"),
    ("Zoe", "Carter", "Technical Writer"),
    ("Omar", "Haddad", "Security Engineer"),
    ("Isabel", "Moreau", "Data Analyst"),
]
# Employees (by index) who also report to a second manager (by index).
SECOND_MANAGER = {1: 1, 3: 2, 4: 2, 7: 0, 11: 0, 12: 3, 14: 1}


@dataclass
class SeedReport:
    """Counts of records created (or that would be created in a dry run)."""

    created: dict[str, int] = field(default_factory=dict)
    skipped: dict[str, int] = field(default_factory=dict)

    def add(self, kind: str, created: bool) -> None:
        """Count a created or skipped record of the given kind."""
        bucket = self.created if created else self.skipped
        bucket[kind] = bucket.get(kind, 0) + 1


def demo_username(first: str, last: str) -> str:
    """Return the deterministic demo username for a person."""
    return f"{DEMO_PREFIX}{first}.{last}".lower()


def _ensure_user(
    db: Session, report: SeedReport, actor_id: int | None, *, first: str, last: str,
    title: str, role: str, password_hash: str,
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
    record_audit(
        db,
        actor_id=actor_id or user.id,
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        description=f"Seeded demo {role} account '{username}'",
        changes={"after": {"username": username, "role": role}},
    )
    report.add(f"users:{role}", True)
    return user


def _ensure_link(db: Session, report: SeedReport, actor: User, employee: User, manager: User) -> None:
    if db.get(EmployeeManager, (employee.id, manager.id)) is not None:
        report.add("employee_managers", False)
        return
    db.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    db.flush()
    record_audit(
        db,
        actor_id=actor.id,
        action="employee_manager.assign",
        entity_type="employee_manager",
        entity_id=employee.id,
        description=f"Seeded '{employee.username}' under manager '{manager.username}'",
        changes={"manager_id": manager.id, "employee_id": employee.id},
    )
    report.add("employee_managers", True)


def seed_organization(db: Session, password: str, report: SeedReport | None = None) -> SeedReport:
    """Create the demo admin, managers, employees, and reporting lines.

    Flushes but does not commit; the caller owns the transaction.
    """
    report = report or SeedReport()
    password_hash = hash_password(password)

    admin = _ensure_user(
        db, report, None, first=ADMIN[0], last=ADMIN[1], title=ADMIN[2],
        role="admin", password_hash=password_hash,
    )
    managers = [
        _ensure_user(db, report, admin.id, first=f, last=l, title=t, role="manager", password_hash=password_hash)
        for f, l, t in MANAGERS
    ]
    employees = [
        _ensure_user(db, report, admin.id, first=f, last=l, title=t, role="employee", password_hash=password_hash)
        for f, l, t in EMPLOYEES
    ]
    for index, employee in enumerate(employees):
        _ensure_link(db, report, admin, employee, managers[index % len(managers)])
        if index in SECOND_MANAGER:
            _ensure_link(db, report, admin, employee, managers[SECOND_MANAGER[index]])
    return report


def _demo_user(db: Session, first: str, last: str) -> User:
    user = db.scalar(select(User).where(User.username == demo_username(first, last)))
    if user is None:
        raise RuntimeError("Demo organization is missing; seed the organization first.")
    return user


def _midnight(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


# Each project uses only its own manager's primary employees (index % 4 == manager
# index) and no employee is double-booked, so every row passes the scheduling rules.
# Offsets are days relative to the seed date; assignments are (employee index, milestone
# index, start offset, end offset, ended_at offset or None).
DEMO_PROJECTS = [
    {
        "name": "Demo: Customer Portal Redesign", "manager": 0, "status": "active", "archived": False,
        "start": -60, "end": 120, "budget": "80000.00",
        "milestones": [("Discovery and UX research", -60, -31, True), ("Core build", -30, 30, False),
                       ("Beta hardening", 31, 90, False)],
        "assignments": [(0, 0, -60, -31, None), (0, 1, -30, 30, None), (4, 1, -20, 30, None),
                        (8, 2, 31, 90, None), (0, 2, 31, 60, None)],
    },
    {
        "name": "Demo: Data Platform Migration", "manager": 1, "status": "active", "archived": False,
        "start": -45, "end": 60, "budget": "120000.00",
        "milestones": [("Source inventory", -45, -1, True), ("Pipeline cutover", 0, 60, False)],
        "assignments": [(1, 0, -45, -1, None), (5, 1, 0, 40, None), (9, 1, 5, 60, None)],
    },
    {
        "name": "Demo: Legacy CRM Sunset", "manager": 2, "status": "completed", "archived": False,
        "start": -200, "end": -30, "budget": "90000.00",
        "milestones": [("Data export", -200, -120, True), ("Decommission", -119, -30, True)],
        "assignments": [(2, 0, -190, -125, None), (6, 1, -115, -40, None)],
    },
    {
        "name": "Demo: Mobile App Prototype", "manager": 3, "status": "abandoned", "archived": False,
        "start": -80, "end": 40, "budget": "60000.00",
        "milestones": [("Prototype build", -80, 40, False)],
        "assignments": [(3, 0, -50, 30, -25)],
    },
    {
        "name": "Demo: Intranet Refresh", "manager": 0, "status": "completed", "archived": True,
        "start": -320, "end": -240, "budget": "15000.00",
        "milestones": [("Content migration", -320, -240, True)],
        "assignments": [(12, 0, -300, -250, None)],
    },
]


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

    for spec in DEMO_PROJECTS:
        if db.scalar(select(Project.id).where(Project.name == spec["name"])) is not None:
            report.add("projects", False)
            continue
        day = lambda offset: today + timedelta(days=offset)  # noqa: E731
        project = Project(
            name=spec["name"],
            description=f"Demonstration project: {spec['name'][6:]}.",
            manager_id=managers[spec["manager"]].id,
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
        for name, start, end, completed in spec["milestones"]:
            milestone = Milestone(
                project_id=project.id, name=name, start_date=day(start), end_date=day(end),
                status="completed" if completed else "pending",
                completed_at=_midnight(day(end)) if completed else None,
            )
            db.add(milestone)
            milestones.append(milestone)
        db.flush()
        for emp_idx, ms_idx, start, end, ended in spec["assignments"]:
            db.add(MilestoneAssignment(
                milestone_id=milestones[ms_idx].id, employee_id=employees[emp_idx].id,
                start_date=day(start), planned_end_date=day(end),
                ended_at=_midnight(day(ended)) if ended is not None else None,
            ))
            report.add("assignments", True)
        db.flush()
        record_audit(
            db, actor_id=admin.id, action="project.create", entity_type="project",
            entity_id=project.id, description=f"Seeded demo project '{project.name}'",
            changes={"after": {"name": project.name, "status": project.status}},
        )
        report.add("projects", True)
        report.add("milestones", True)
    return report


def _terms_plan(index: int) -> list[tuple[int, Decimal, Decimal]]:
    """Return deterministic (effective offset in days, hourly rate, weekly hours) for an employee.

    The first term predates every seeded assignment; some employees have a past raise
    and some a scheduled future raise so historical rates are exercised.
    """
    rate = Decimal(45 + (index * 7) % 35)
    hours = Decimal("32") if index % 5 == 3 else Decimal("40")
    plan = [(-400, rate, hours)]
    if index % 3 == 0:
        plan.append((-100, rate + Decimal("4"), hours))
    if index % 4 == 1:
        plan.append((30, rate + Decimal("6"), hours))
    return plan


def seed_work_terms(
    db: Session, report: SeedReport | None = None, today: date | None = None
) -> SeedReport:
    """Create effective-dated work terms for every demo employee.

    Idempotent per (employee, effective date); existing rows are never changed.
    Requires the demo organization. Flushes but does not commit.
    """
    report = report or SeedReport()
    today = today or datetime.now(timezone.utc).date()
    admin = _demo_user(db, *ADMIN[:2])
    for index, (first, last, _) in enumerate(EMPLOYEES):
        employee = _demo_user(db, first, last)
        for offset, rate, hours in _terms_plan(index):
            effective = today + timedelta(days=offset)
            exists = db.scalar(
                select(EmployeeWorkTerms.id).where(
                    EmployeeWorkTerms.employee_id == employee.id,
                    EmployeeWorkTerms.effective_from == effective,
                )
            )
            if exists is not None:
                report.add("work_terms", False)
                continue
            row = EmployeeWorkTerms(
                employee_id=employee.id, hourly_rate=rate, weekly_hours=hours, effective_from=effective
            )
            db.add(row)
            db.flush()
            record_audit(
                db, actor_id=admin.id, action="work_terms.create", entity_type="employee_work_terms",
                entity_id=row.id, description=f"Seeded work terms for '{employee.username}'",
                changes={"after": {"hourly_rate": str(rate), "weekly_hours": str(hours),
                                   "effective_from": str(effective)}},
            )
            report.add("work_terms", True)
    return report


def _print_report(report: SeedReport, applied: bool) -> None:
    verb = "Created" if applied else "Would create"
    print(f"{verb}: {report.created or 'nothing'}")
    print(f"Already present (skipped): {report.skipped or 'nothing'}")


def main() -> None:
    """Command-line entry point."""
    from database import SessionLocal  # imported lazily so tests never touch PostgreSQL

    parser = argparse.ArgumentParser(description="Seed ACME demo data (additive and idempotent).")
    parser.add_argument("--apply", action="store_true", help="Persist changes (default is a dry run).")
    args = parser.parse_args()

    if os.getenv("APP_ENV", "").lower() == "production" and os.getenv("SEED_ALLOW_PRODUCTION") != "yes":
        raise SystemExit("Refusing to seed: APP_ENV=production (set SEED_ALLOW_PRODUCTION=yes to override).")
    password = os.getenv("SEED_DEMO_PASSWORD")
    if not password or len(password) < 8:
        raise SystemExit("SEED_DEMO_PASSWORD must be set (at least 8 characters).")

    with SessionLocal() as db:
        try:
            report = seed_organization(db, password)
            seed_work_terms(db, report)
            seed_projects(db, report)
            if args.apply:
                db.commit()
            else:
                db.rollback()
        except Exception:
            db.rollback()
            raise
    _print_report(report, args.apply)
    if args.apply:
        print(f"Demo logins: {demo_username(*ADMIN[:2])}, {demo_username(*MANAGERS[0][:2])}, "
              f"{demo_username(*EMPLOYEES[0][:2])} (password from SEED_DEMO_PASSWORD).")


if __name__ == "__main__":
    main()

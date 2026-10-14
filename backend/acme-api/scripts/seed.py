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

Later phases add projects, milestones, assignments, and compensation here.
"""

import argparse
import os
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.user import EmployeeManager, User
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

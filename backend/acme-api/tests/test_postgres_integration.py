"""PostgreSQL-only integration checks for behavior SQLite cannot prove.

Skipped unless ``TEST_DATABASE_URL`` points at a disposable ``*_test`` PostgreSQL database
(see ``tests/conftest.py``; ``bin/test-backend.sh --postgres`` sets it up). Covers:

* Alembic migrations run cleanly to head on an empty database and match the models.
* Timezone-aware timestamps round-trip as the same instant whatever the session time zone.
* ``Numeric`` columns keep exact Decimal precision (and round / overflow like PostgreSQL).
* Unique, primary-key, foreign-key and NOT NULL constraints are enforced by the database.
"""

import os
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import close_all_sessions

from database import Base
from models.assignment import MilestoneAssignment
from models.project import Project
from models.user import EmployeeManager, User
from models.work_terms import EmployeeWorkTerms
from services.scheduling_rules import as_utc, day_start
from tests.conftest import (
    IS_POSTGRES,
    TEST_DATABASE_URL,
    TestingSessionLocal,
    assert_safe_test_database_url,
    engine,
    make_milestone,
    make_project,
    make_terms,
    make_user,
)

pytestmark = pytest.mark.skipif(
    not IS_POSTGRES, reason="set TEST_DATABASE_URL to a disposable *_test PostgreSQL database"
)

APP_DIR = Path(__file__).resolve().parents[1]


# --- Alembic migrations ---------------------------------------------------------------


def _alembic_env() -> dict[str, str]:
    """Environment that points the app settings (and so migrations/env.py) at the test DB."""
    url = make_url(TEST_DATABASE_URL)
    assert_safe_test_database_url(TEST_DATABASE_URL)
    env = dict(os.environ)
    env.pop("IS_LOCAL", None)  # local Postgres: no sslmode=require
    env.update(
        POSTGRES_HOST=url.host or "localhost",
        POSTGRES_PORT=str(url.port or 5432),
        POSTGRES_NAME=url.database,
        POSTGRES_USER=url.username or "",
        POSTGRES_PASS=url.password or "",
    )
    return env


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, *args], cwd=APP_DIR, env=_alembic_env(), capture_output=True, text=True, timeout=120
    )


def _reset_schema() -> None:
    close_all_sessions()
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


@pytest.fixture
def empty_database():
    """An empty test database before and after the test (no ``setup_db`` tables)."""
    _reset_schema()
    yield
    _reset_schema()


def test_migration_subprocess_targets_the_test_database(empty_database):
    probe = _run("-c", "from database import engine; print(engine.url.database)")
    assert probe.returncode == 0, probe.stderr
    assert probe.stdout.strip() == make_url(TEST_DATABASE_URL).database


def test_alembic_upgrade_head_matches_models_and_downgrades_cleanly(empty_database):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from alembic.script import ScriptDirectory
    from alembic.config import Config

    upgrade = _run("-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stderr

    tables = set(inspect(engine).get_table_names())
    assert tables == set(Base.metadata.tables) | {"alembic_version"}

    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []
        heads = ScriptDirectory.from_config(Config(str(APP_DIR / "alembic.ini"))).get_heads()
        assert context.get_current_heads() == tuple(heads)

    # Upgrading again is a no-op.
    again = _run("-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    assert again.returncode == 0, again.stderr

    downgrade = _run("-m", "alembic", "-c", "alembic.ini", "downgrade", "base")
    assert downgrade.returncode == 0, downgrade.stderr
    assert set(inspect(engine).get_table_names()) == {"alembic_version"}


def test_migrated_schema_enforces_constraints(empty_database):
    upgrade = _run("-m", "alembic", "-c", "alembic.ini", "upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stderr
    inspector = inspect(engine)
    user_uniques = {tuple(c["column_names"]) for c in inspector.get_unique_constraints("users")}
    assert {("username",), ("email",)} <= user_uniques
    terms_uniques = {tuple(c["column_names"]) for c in inspector.get_unique_constraints("employee_work_terms")}
    assert ("employee_id", "effective_from") in terms_uniques
    fks = {
        (fk["constrained_columns"][0], fk["referred_table"])
        for fk in inspector.get_foreign_keys("milestone_assignments")
    }
    assert {("milestone_id", "milestones"), ("employee_id", "users")} <= fks


# --- timestamps -----------------------------------------------------------------------


def test_timestamp_columns_are_timestamptz(setup_db):
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                "SELECT table_name, column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND column_name IN "
                "('created_at', 'updated_at', 'ended_at', 'completed_at', 'archived_at')"
            )
        ).all()
    assert rows, "expected timestamp columns"
    assert {data_type for _, _, data_type in rows} == {"timestamp with time zone"}


@pytest.mark.parametrize("session_tz", ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"])
def test_aware_timestamps_round_trip_as_same_instant(db, session_tz):
    db.execute(text(f"SET TIME ZONE '{session_tz}'"))
    ist = timezone(timedelta(hours=5, minutes=30))
    created = datetime(2030, 6, 12, 23, 30, 15, 123456, tzinfo=ist)
    user = make_user(db, "tzuser", "employee")
    user.created_at = created
    db.commit()
    user_id = user.id
    db.expunge_all()

    with TestingSessionLocal() as other:
        other.execute(text(f"SET TIME ZONE '{session_tz}'"))
        loaded = other.get(User, user_id).created_at
    assert loaded.tzinfo is not None
    assert loaded == created  # same instant, microseconds preserved
    assert as_utc(loaded) == datetime(2030, 6, 12, 18, 0, 15, 123456, tzinfo=timezone.utc)


@pytest.mark.parametrize("session_tz", ["America/New_York", "Pacific/Kiritimati"])
def test_day_start_cutoffs_keep_their_utc_date(db, session_tz):
    """Assignment ``ended_at`` cutoffs are midnight UTC; the app must read them back via as_utc."""
    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "tzmgr", "manager")
    emp = make_user(db, "tzemp", "employee")
    project = make_project(db, mgr, admin)
    milestone = make_milestone(db, project, date(2030, 6, 1), date(2030, 6, 30))
    row = MilestoneAssignment(
        milestone_id=milestone.id,
        employee_id=emp.id,
        start_date=date(2030, 6, 3),
        planned_end_date=date(2030, 6, 28),
        ended_at=day_start(date(2030, 6, 12)),
    )
    db.add(row)
    db.commit()
    row_id = row.id

    with TestingSessionLocal() as other:
        other.execute(text(f"SET TIME ZONE '{session_tz}'"))
        ended_at = other.get(MilestoneAssignment, row_id).ended_at
    assert as_utc(ended_at) == datetime(2030, 6, 12, tzinfo=timezone.utc)
    assert as_utc(ended_at).date() == date(2030, 6, 12)


# --- Numeric / Decimal precision -------------------------------------------------------


def test_budget_and_rates_keep_exact_decimal_precision(db):
    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "decmgr", "manager")
    emp = make_user(db, "decemp", "employee")
    project = make_project(db, mgr, admin, estimated_budget=Decimal("999999999999.99"))
    make_terms(db, emp, rate="9999999999.99", hours="37.50")
    make_terms(db, emp, rate="0.01", hours="0.25", effective_from=date(2030, 2, 1))
    project_id, emp_id = project.id, emp.id
    db.expunge_all()

    with TestingSessionLocal() as other:
        budget = other.get(Project, project_id).estimated_budget
        terms = other.scalars(
            select(EmployeeWorkTerms).where(EmployeeWorkTerms.employee_id == emp_id).order_by(EmployeeWorkTerms.effective_from)
        ).all()
        total = other.scalar(select(func.sum(EmployeeWorkTerms.hourly_rate * EmployeeWorkTerms.weekly_hours)))

    assert isinstance(budget, Decimal) and budget == Decimal("999999999999.99")
    assert [(t.hourly_rate, t.weekly_hours) for t in terms] == [
        (Decimal("9999999999.99"), Decimal("37.50")),
        (Decimal("0.01"), Decimal("0.25")),
    ]
    assert str(terms[0].hourly_rate) == "9999999999.99"
    # Database-side arithmetic stays exact (no binary floating point).
    assert total == Decimal("9999999999.99") * Decimal("37.50") + Decimal("0.01") * Decimal("0.25")


def test_numeric_scale_rounds_half_away_from_zero(db):
    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "rndmgr", "manager")
    project = make_project(db, mgr, admin, estimated_budget=Decimal("10.005"))
    db.expire(project)
    assert project.estimated_budget == Decimal("10.01")


def test_numeric_overflow_is_rejected(db):
    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "ovfmgr", "manager")
    with pytest.raises(DataError):
        make_project(db, mgr, admin, estimated_budget=Decimal("1000000000000.00"))  # 13 integer digits
    db.rollback()
    emp = make_user(db, "ovfemp", "employee")
    with pytest.raises(DataError):
        make_terms(db, emp, rate="40.00", hours="1000.00")  # Numeric(5, 2)
    db.rollback()


def test_budget_api_returns_exact_decimal_strings(client, db, frozen_clock):
    from tests.conftest import login_headers

    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "apimgr", "manager")
    project = make_project(db, mgr, admin, estimated_budget=Decimal("123456789.01"))
    response = client.get(f"/api/v1/projects/{project.id}/budget", headers=login_headers(client, "adminuser"))
    assert response.status_code == 200, response.text
    assert Decimal(str(response.json()["estimated_budget"])) == Decimal("123456789.01")


# --- constraints ----------------------------------------------------------------------


def test_duplicate_username_and_email_are_rejected_by_database(db):
    make_user(db, "dupe", "employee", email="dupe@example.com")
    with pytest.raises(IntegrityError, match="username"):
        make_user(db, "dupe", "employee", email="other@example.com")
    db.rollback()
    with pytest.raises(IntegrityError, match="email"):
        make_user(db, "dupe2", "employee", email="dupe@example.com")
    db.rollback()
    assert db.query(User).filter(User.username.like("dupe%")).count() == 1


def test_work_terms_unique_per_employee_and_effective_date(db):
    emp = make_user(db, "termsemp", "employee")
    other = make_user(db, "termsemp2", "employee")
    make_terms(db, emp, effective_from=date(2030, 1, 1))
    make_terms(db, other, effective_from=date(2030, 1, 1))  # different employee: fine
    make_terms(db, emp, effective_from=date(2030, 1, 2))  # different date: fine
    with pytest.raises(IntegrityError):
        make_terms(db, emp, rate="99.00", effective_from=date(2030, 1, 1))
    db.rollback()
    assert db.query(EmployeeWorkTerms).filter_by(employee_id=emp.id).count() == 2


def test_employee_manager_primary_key_prevents_duplicates(db):
    emp = make_user(db, "pkemp", "employee")
    mgr = make_user(db, "pkmgr", "manager")
    db.add(EmployeeManager(employee_id=emp.id, manager_id=mgr.id))
    db.commit()
    db.add(EmployeeManager(employee_id=emp.id, manager_id=mgr.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_foreign_keys_are_enforced(db):
    emp = make_user(db, "fkemp", "employee")
    db.add(
        MilestoneAssignment(
            milestone_id=987654, employee_id=emp.id, start_date=date(2030, 1, 1), planned_end_date=date(2030, 1, 2)
        )
    )
    with pytest.raises(IntegrityError, match="milestone"):
        db.commit()
    db.rollback()

    db.add(EmployeeWorkTerms(employee_id=987654, hourly_rate=Decimal("1"), weekly_hours=Decimal("1"), effective_from=date(2030, 1, 1)))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_referenced_user_cannot_be_deleted(db):
    admin = db.query(User).filter_by(username="adminuser").one()
    mgr = make_user(db, "delmgr", "manager")
    make_project(db, mgr, admin)
    with pytest.raises(IntegrityError):
        db.execute(text("DELETE FROM users WHERE id = :id"), {"id": mgr.id})
        db.commit()
    db.rollback()


def test_not_null_constraints_are_enforced(db):
    db.add(User(username="nonull", email="nonull@example.com", first_name=None, last_name="X", password_hash="x", role="employee"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_identity_sequences_restart_for_each_test(db):
    """setup_db drops and recreates tables, so ids are predictable across tests on PostgreSQL too."""
    assert db.query(User).filter_by(username="adminuser").one().id == 1

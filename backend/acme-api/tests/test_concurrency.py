"""Row-locking checks for scheduling concurrency.

* The compile test runs everywhere and proves the lock statement is a PostgreSQL
  ``FOR NO KEY UPDATE`` (SQLite silently ignores row locks, so it cannot prove
  serialization).
* The threaded test is opt-in. It needs a *dedicated, disposable* PostgreSQL
  database whose name contains "test" and is never ``acme_db``:

      $env:ACME_TEST_POSTGRES_URL = "postgresql+psycopg://user:pw@localhost:5432/acme_concurrency_test"
      python -m pytest backend/acme-api/tests/test_concurrency.py -q

  It creates the schema in that database and drops it afterwards.
"""

import os
import threading
import time
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from database import Base
from models.assignment import MilestoneAssignment
from models.user import EmployeeManager, User
from schemas.assignment import AssignmentCreate
from services import assignment_service
from services.audit_service import record_audit
from tests.conftest import make_milestone, make_project, make_terms, make_user

PG_URL = os.environ.get("ACME_TEST_POSTGRES_URL")


def test_employee_lock_statement_is_for_no_key_update():
    stmt = select(User).where(User.id == 1).with_for_update(key_share=True)
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    assert sql.rstrip().endswith("FOR NO KEY UPDATE")


def test_lock_helpers_request_row_locks(monkeypatch):
    """lock_employee and lock_project must emit locking SELECTs (checked via compiled SQL)."""
    from services import project_service, scheduling_rules

    captured = []

    class FakeDb:
        def scalar(self, stmt):
            captured.append(str(stmt.compile(dialect=postgresql.dialect())))
            return object()

    scheduling_rules.lock_employee(FakeDb(), 1)
    project_service.lock_project(FakeDb(), 1)
    assert "FOR NO KEY UPDATE" in captured[0]
    assert "FOR UPDATE" in captured[1]


def _guard(url: str) -> None:
    name = make_url(url).database or ""
    if "test" not in name.lower() or name.lower() == "acme_db":
        pytest.fail(f"Refusing to run against database {name!r}: name must contain 'test' and not be acme_db")


@pytest.mark.skipif(not PG_URL, reason="set ACME_TEST_POSTGRES_URL to a disposable *test* PostgreSQL database")
def test_concurrent_creates_for_same_employee_are_serialized(monkeypatch):
    _guard(PG_URL)
    engine = create_engine(PG_URL)
    Session = sessionmaker(bind=engine, autoflush=False)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        with Session() as s:
            admin = make_user(s, "adm", "admin")
            mgr = make_user(s, "mg", "manager")
            emp = make_user(s, "em", "employee")
            s.add(EmployeeManager(employee_id=emp.id, manager_id=mgr.id))
            s.commit()
            make_terms(s, emp, effective_from=date(2000, 1, 1))
            project = make_project(s, mgr, admin, name="P", start_date=date(2030, 1, 1))
            m1 = make_milestone(s, project, date(2030, 6, 1), date(2030, 6, 30), name="A")
            project2 = make_project(s, mgr, admin, name="Q", start_date=date(2030, 1, 1))
            m2 = make_milestone(s, project2, date(2030, 6, 1), date(2030, 6, 30), name="B")
            ids = (mgr.id, emp.id, m1.id, m2.id)

        now = datetime(2030, 5, 1, 12, tzinfo=timezone.utc)
        real_audit = record_audit

        def slow_audit(*a, **k):
            time.sleep(0.5)  # widen the window between conflict check and commit
            return real_audit(*a, **k)

        monkeypatch.setattr("services.assignment_service.record_audit", slow_audit)
        barrier = threading.Barrier(2)
        results = []

        def worker(milestone_id):
            with Session() as s:
                actor = s.get(User, ids[0])
                payload = AssignmentCreate(
                    employee_id=ids[1], start_date=date(2030, 6, 10), planned_end_date=date(2030, 6, 20)
                )
                barrier.wait()
                try:
                    assignment_service.create_assignment(s, actor, milestone_id, payload, now=now)
                    results.append("ok")
                except HTTPException as exc:
                    results.append(exc.status_code)

        threads = [threading.Thread(target=worker, args=(m,)) for m in (ids[2], ids[3])]
        for t in threads:
            t.start()
        for t in threads:
            t.join(30)

        assert sorted(results, key=str) == [409, "ok"], results
        with Session() as s:
            assert s.query(MilestoneAssignment).count() == 1
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()

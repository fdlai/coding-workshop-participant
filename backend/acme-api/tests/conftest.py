"""Shared, isolated test fixtures. Never touches the real application database.

By default every test runs on in-memory SQLite. Set ``TEST_DATABASE_URL`` to run the
whole suite against a disposable PostgreSQL database instead, e.g.::

    TEST_DATABASE_URL=postgresql+psycopg://postgres:pw@localhost:5432/acme_test

The URL is refused unless it is PostgreSQL and its database name ends with ``_test``
(and differs from the application's ``POSTGRES_NAME``), so ``acme_db`` is never used.
"""

import os
from datetime import date, datetime, timezone
from decimal import Decimal

os.environ.setdefault("JWT_SECRET_KEY", "test-auth-secret-key-1234567890")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import close_all_sessions, sessionmaker
from sqlalchemy.pool import StaticPool

from config import settings
from database import Base, get_db
from main import app
from models.milestone import Milestone
from models.project import Project
from models.user import EmployeeManager, User
from models.work_terms import EmployeeWorkTerms
from services.auth_service import hash_password


TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()


def assert_safe_test_database_url(url: str) -> str:
    """Return the database name of ``url`` or raise if it is not clearly a disposable test DB."""
    parsed = make_url(url)
    name = parsed.database or ""
    if parsed.get_backend_name() != "postgresql":
        raise RuntimeError(f"TEST_DATABASE_URL must be a PostgreSQL URL, got {parsed.get_backend_name()!r}")
    if not name.endswith("_test") or name == settings.POSTGRES_NAME or name == "acme_db":
        raise RuntimeError(
            f"Refusing to run tests against database {name!r}: TEST_DATABASE_URL must name a "
            "disposable database ending in '_test' (never the application database)."
        )
    return name


if TEST_DATABASE_URL:
    assert_safe_test_database_url(TEST_DATABASE_URL)
    engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
else:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
IS_POSTGRES = engine.dialect.name == "postgresql"
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password123!"


def override_get_db():
    """Yield a session bound to the in-memory test engine."""
    database = TestingSessionLocal()
    try:
        yield database
    finally:
        database.close()


app.dependency_overrides[get_db] = override_get_db


def make_user(session, username: str, role: str, **overrides) -> User:
    """Insert a user directly into the test database."""
    user = User(
        username=username,
        email=overrides.pop("email", f"{username}@example.com"),
        first_name=overrides.pop("first_name", username.title()),
        last_name=overrides.pop("last_name", "Tester"),
        password_hash=hash_password(PASSWORD),
        role=role,
        job_title=overrides.pop("job_title", None),
        is_active=overrides.pop("is_active", True),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        **overrides,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(scope="function")
def setup_db():
    """Create tables, seed a default admin, and drop everything afterwards."""
    if IS_POSTGRES:
        # A previous interrupted run may have left tables (and id sequences) behind.
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    make_user(session, "adminuser", "admin", email="admin@example.com", job_title="Administrator")
    session.close()
    yield
    # Sessions a test left open would hold PostgreSQL locks and block DROP TABLE.
    close_all_sessions()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db(setup_db):
    """Provide a session for arranging and inspecting test data."""
    session = TestingSessionLocal()
    yield session
    session.close()


FROZEN_NOW = datetime(2030, 6, 12, 15, 45, tzinfo=timezone.utc)


@pytest.fixture()
def frozen_clock(monkeypatch):
    """Freeze the application clock at 2030-06-12 15:45 UTC."""
    monkeypatch.setattr("services.clock.utc_now", lambda: FROZEN_NOW)
    return FROZEN_NOW


def link_employee(session, employee, manager) -> None:
    """Create an organizational employee-manager relationship."""
    session.add(EmployeeManager(employee_id=employee.id, manager_id=manager.id))
    session.commit()


def make_project(session, manager, admin, **overrides) -> Project:
    """Insert a project directly into the test database."""
    project = Project(
        name=overrides.pop("name", "Project"),
        manager_id=manager.id,
        created_by=admin.id,
        start_date=overrides.pop("start_date", date(2030, 1, 1)),
        estimated_end_date=overrides.pop("estimated_end_date", date(2030, 12, 31)),
        estimated_budget=overrides.pop("estimated_budget", Decimal("100000.00")),
        **overrides,
    )
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def make_milestone(session, project, start: date, end: date, **overrides) -> Milestone:
    """Insert a milestone directly into the test database."""
    milestone = Milestone(
        project_id=project.id,
        name=overrides.pop("name", f"M {start}"),
        start_date=start,
        end_date=end,
        **overrides,
    )
    session.add(milestone)
    session.commit()
    session.refresh(milestone)
    return milestone


def make_terms(session, employee, rate="40.00", hours="40", effective_from=date(2030, 1, 1)) -> EmployeeWorkTerms:
    """Insert a work-terms record directly into the test database."""
    row = EmployeeWorkTerms(
        employee_id=employee.id,
        hourly_rate=Decimal(rate),
        weekly_hours=Decimal(hours),
        effective_from=effective_from,
    )
    session.add(row)
    session.commit()
    return row


@pytest.fixture()
def world(db, frozen_clock):
    """Admin, manager, two linked employees, an unlinked employee, a project and milestone.

    Frozen "today" is 2030-06-12 (a Wednesday). Both linked employees have 40h/week at
    $40/h (daily cost $320) effective 2030-01-01. The milestone spans 2030-06-01..08-31.
    """
    ns = type("World", (), {})()
    ns.admin = db.query(User).filter_by(username="adminuser").one()
    ns.manager = make_user(db, "mgr", "manager")
    ns.other_manager = make_user(db, "mgr2", "manager")
    ns.emp = make_user(db, "emp", "employee")
    ns.emp2 = make_user(db, "emp2", "employee")
    ns.stranger = make_user(db, "stranger", "employee")
    link_employee(db, ns.emp, ns.manager)
    link_employee(db, ns.emp2, ns.manager)
    make_terms(db, ns.emp)
    make_terms(db, ns.emp2)
    make_terms(db, ns.stranger)
    ns.project = make_project(db, ns.manager, ns.admin, name="Alpha")
    ns.milestone = make_milestone(db, ns.project, date(2030, 6, 1), date(2030, 8, 31), name="M1")
    ns.milestone2 = make_milestone(db, ns.project, date(2030, 9, 1), date(2030, 10, 31), name="M2")
    return ns


@pytest.fixture()
def client(setup_db):
    """Provide a test client for the FastAPI app."""
    return TestClient(app)


def login_headers(client: TestClient, username: str) -> dict[str, str]:
    """Log in and return bearer authorization headers."""
    response = client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}

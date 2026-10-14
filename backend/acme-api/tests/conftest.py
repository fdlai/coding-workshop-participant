"""Shared, isolated test fixtures (in-memory SQLite only; never the real database)."""

import os
from datetime import datetime, timezone

os.environ.setdefault("JWT_SECRET_KEY", "test-auth-secret-key-1234567890")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base, get_db
from main import app
from models.user import User
from services.auth_service import hash_password


engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
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
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    make_user(session, "adminuser", "admin", email="admin@example.com", job_title="Administrator")
    session.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db(setup_db):
    """Provide a session for arranging and inspecting test data."""
    session = TestingSessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client(setup_db):
    """Provide a test client for the FastAPI app."""
    return TestClient(app)


def login_headers(client: TestClient, username: str) -> dict[str, str]:
    """Log in and return bearer authorization headers."""
    response = client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}

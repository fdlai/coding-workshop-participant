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


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    database = TestingSessionLocal()
    try:
        yield database
    finally:
        database.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    user = User(
        username="adminuser",
        email="admin@example.com",
        first_name="Admin",
        last_name="User",
        password_hash=hash_password("Password123!"),
        role="admin",
        job_title="Administrator",
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(user)
    session.commit()
    session.close()
    yield
    Base.metadata.drop_all(bind=engine)


def test_login_returns_token(setup_db):
    client = TestClient(app)
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "adminuser", "password": "Password123!"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["expires_in"] > 0


def test_me_endpoint_requires_authentication(setup_db):
    client = TestClient(app)
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401


def test_me_endpoint_returns_current_user(setup_db):
    client = TestClient(app)
    login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "adminuser", "password": "Password123!"},
    )
    token = login_response.json()["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["username"] == "adminuser"
    assert payload["role"] == "admin"


def test_initial_admin_bootstrap_rejects_existing_admin(setup_db):
    from services.bootstrap import ensure_initial_admin

    session = TestingSessionLocal()
    with pytest.raises(ValueError, match="already exists"):
        ensure_initial_admin(
            session,
            username="anotheradmin",
            email="another@example.com",
            password="Password123!",
        )
    session.close()

import pytest
from fastapi.testclient import TestClient

from main import app
from tests.conftest import TestingSessionLocal


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
